import type { Record_ } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// The command stack.
//
// This is the piece that has to exist BEFORE the features that need it, and it's
// the reason it's landing first rather than last.
//
// Undo cannot be bolted onto an app that mutates state ad hoc. If a cell edit is
// `setState(...)` plus a `fetch(...)`, then undo has to reconstruct the previous
// value from somewhere — and there is nowhere, because nobody kept it. Every
// mutation ends up needing a bespoke inverse, written by someone who has forgotten
// what the forward path did.
//
// So every mutation is a Command: it knows how to do itself, and it captured
// enough state at construction time to undo itself. Undo is then trivial and
// uniform, and it works for operations nobody thought about when the stack was
// written.
//
// ── The rules ──
//
//   1. A command captures its BEFORE state when it is CONSTRUCTED, not when it is
//      executed. Between construction and execution, someone else's realtime
//      update could land.
//
//   2. `do()` and `undo()` must be symmetric. undo(do(x)) === x, for the parts of
//      the world this command touched.
//
//   3. A command that fails does not go on the stack. An undo entry for something
//      that never happened is worse than no undo entry.
//
//   4. A NEW command clears the redo stack. This is what every editor does: you
//       cannot undo, type something else, and then redo into a world that no
//       longer exists.
// ════════════════════════════════════════════════════════════════════════════

export interface Command {
  /** Shown in the toast: "Undid: paste 12 cells". */
  label: string;
  do(): Promise<void>;
  undo(): Promise<void>;
}

type Values = globalThis.Record<string, unknown>;

/**
 * The API surface a command needs. Passed in rather than imported, so commands
 * are pure and testable — you can drive the whole stack with a fake.
 */
export interface CommandContext {
  /** Write. Returns what the write RECOMPUTED — computed keys only, never scalars.
   *  Empty when the table has no computed fields, which is most tables. */
  patch(patches: { id: string; values: Values }[]): Promise<{ id: string; values: Values }[]>;
  insert(rows: Values[]): Promise<Record_[]>;
  remove(ids: string[]): Promise<void>;
  restore(ids: string[]): Promise<void>;
  setOrder(id: string, sortOrder: number): Promise<void>;
  /** Apply the change to local state, without touching the server. */
  applyLocal(fn: (records: Record_[]) => Record_[]): void;
}

// ─── Cell edits ─────────────────────────────────────────────────────────────

/**
 * One or many cells. Paste, fill and a single keystroke all become this — there
 * is no separate "paste command", because a paste IS a set of cell edits and
 * pretending otherwise means writing undo twice.
 */
export function editCells(
  ctx: CommandContext,
  edits: { id: string; values: Values }[],
  before: { id: string; values: Values }[],
  label: string
): Command {
  return {
    label,
    async do() {
      ctx.applyLocal((records) => applyPatches(records, edits));
      applyComputed(ctx, await ctx.patch(edits));
    },
    async undo() {
      ctx.applyLocal((records) => applyPatches(records, before));
      // Undo recomputes too. Put a formula's input back and the formula must go
      // back with it — otherwise undo leaves the row in a state it was never in.
      applyComputed(ctx, await ctx.patch(before));
    },
  };
}

/**
 * Merge what the write recomputed.
 *
 * Only ever COMPUTED keys reach here — swamp_computed_values returns nothing else
 * — and that is what makes this safe to apply late. Two things would break if the
 * server echoed scalars back:
 *
 *   • Undo. The stack re-applies captured `before` scalars; a slow response from
 *     the previous write could land afterwards and put the new value back.
 *   • Typing. A response arriving mid-keystroke would overwrite what the user is
 *     in the middle of writing with what the server had a moment ago.
 *
 * A computed key has neither problem: the user cannot type one, and the last write
 * to land is by definition the most recent truth about it.
 */
function applyComputed(ctx: CommandContext, computed: { id: string; values: Values }[]) {
  if (!computed.length) return;
  ctx.applyLocal((records) => applyPatches(records, computed));
}

function applyPatches(records: Record_[], patches: { id: string; values: Values }[]): Record_[] {
  const byId = new Map(patches.map((p) => [p.id, p.values]));
  return records.map((r) => {
    const values = byId.get(r.id);
    return values ? { ...r, data: { ...r.data, ...values } } : r;
  });
}

/**
 * Capture the current value of every cell an edit is about to touch.
 *
 * Note it captures `undefined` for a key the record doesn't have — and that's
 * correct. Undoing a write into a previously-empty cell must leave it empty, not
 * leave it holding an empty string, or "clear this cell then undo" would leave
 * behind a subtly different record.
 */
export function captureBefore(
  records: Record_[],
  edits: { id: string; values: Values }[]
): { id: string; values: Values }[] {
  const byId = new Map(records.map((r) => [r.id, r]));

  return edits.map((e) => {
    const record = byId.get(e.id);
    const values: Values = {};
    for (const key of Object.keys(e.values)) {
      values[key] = record?.data[key] ?? null;
    }
    return { id: e.id, values };
  });
}

// ─── Rows ───────────────────────────────────────────────────────────────────

export function addRows(ctx: CommandContext, rows: Values[], label: string): Command {
  // The ids don't exist until the server assigns them, so the command remembers
  // what it created and undoes exactly that. A command that deleted "the last N
  // rows" would delete someone else's rows if they inserted in between.
  let created: Record_[] = [];

  return {
    label,
    async do() {
      if (created.length) {
        // Redo after an undo: the rows were soft-deleted, so bring them back
        // rather than inserting new ones. Re-inserting would give them new ids and
        // break any command further up the stack that references them.
        await ctx.restore(created.map((r) => r.id));
        ctx.applyLocal((records) => [...records, ...created]);
        return;
      }
      created = await ctx.insert(rows);
      ctx.applyLocal((records) => [...records, ...created]);
    },
    async undo() {
      const ids = created.map((r) => r.id);
      ctx.applyLocal((records) => records.filter((r) => !ids.includes(r.id)));
      await ctx.remove(ids);
    },
  };
}

/**
 * Delete rows.
 *
 * Deletion is SOFT, which is what makes this undoable at all: the rows are still
 * there, just tombstoned, so undo is an update rather than a resurrection. A hard
 * delete would mean re-inserting the captured records — with new ids, breaking
 * every command below it on the stack that referenced the old ones.
 */
export function deleteRows(ctx: CommandContext, records: Record_[]): Command {
  const ids = records.map((r) => r.id);
  const snapshot = records;

  return {
    label: `delete ${ids.length} ${ids.length === 1 ? "row" : "rows"}`,
    async do() {
      ctx.applyLocal((rs) => rs.filter((r) => !ids.includes(r.id)));
      await ctx.remove(ids);
    },
    async undo() {
      await ctx.restore(ids);
      // Put them back where they were. Appending would silently reorder the table.
      ctx.applyLocal((rs) =>
        [...rs, ...snapshot].sort((a, b) => a.sortOrder - b.sortOrder)
      );
    },
  };
}

export function moveRow(
  ctx: CommandContext,
  id: string,
  fromOrder: number,
  toOrder: number
): Command {
  return {
    label: "move row",
    async do() {
      ctx.applyLocal((rs) => reorder(rs, id, toOrder));
      await ctx.setOrder(id, toOrder);
    },
    async undo() {
      ctx.applyLocal((rs) => reorder(rs, id, fromOrder));
      await ctx.setOrder(id, fromOrder);
    },
  };
}

function reorder(records: Record_[], id: string, sortOrder: number): Record_[] {
  return records
    .map((r) => (r.id === id ? { ...r, sortOrder } : r))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// ─── The stack ──────────────────────────────────────────────────────────────

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  /** Cap the history. An unbounded stack in a long editing session is a leak. */
  constructor(private readonly limit = 100) {}

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * The tail of the operation queue. Every run/undo/redo waits for it.
   *
   * ── Why this exists ──
   *
   * Because "type something, immediately press Cmd+Z" used to answer "Nothing to
   * undo" and keep the edit.
   *
   * Each command applies its change LOCALLY first and only then awaits the server,
   * so the new value is on screen roughly instantly — while `run()` is still
   * suspended at `await command.do()` and has not yet pushed anything. For the
   * width of one round-trip the screen showed an edit that the undo stack did not
   * know about, and undo is exactly the reflex people reach for in that window.
   *
   * Pushing the command BEFORE awaiting would close that gap and open a worse one:
   * undo would then fire its reverting write while the original write was still in
   * flight, and which of the two landed last would decide the row. Ordering these
   * operations is the point of a command stack, so they queue rather than race.
   *
   * ponytail: one queue for the whole grid, so an undo waits behind an unrelated
   * in-flight edit. Per-record queues if that ever feels slow — it won't, because
   * these are one round-trip each and a human issues them one at a time.
   */
  private tail: Promise<unknown> = Promise.resolve();

  /** Run `fn` after everything already queued, whether or not that failed. */
  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    // The queue must survive a failed command: park the rejection here so the next
    // operation still runs, and let the real caller see it via `next`.
    this.tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Run a command and push it.
   *
   * If do() throws, the command does NOT go on the stack — an undo entry for
   * something that never happened is worse than no undo entry at all.
   */
  run(command: Command): Promise<void> {
    return this.queue(async () => {
      await command.do();

      this.undoStack.push(command);
      if (this.undoStack.length > this.limit) this.undoStack.shift();

      // A new action invalidates the redo future. Every editor does this: you can't
      // undo, type something else, then redo into a world that no longer exists.
      this.redoStack = [];
    });
  }

  undo(): Promise<string | null> {
    return this.queue(async () => {
      const command = this.undoStack.pop();
      if (!command) return null;

      await command.undo();
      this.redoStack.push(command);
      return command.label;
    });
  }

  redo(): Promise<string | null> {
    return this.queue(async () => {
      const command = this.redoStack.pop();
      if (!command) return null;

      await command.do();
      this.undoStack.push(command);
      return command.label;
    });
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

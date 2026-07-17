import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandStack,
  addRows,
  captureBefore,
  deleteRows,
  editCells,
  moveRow,
  type CommandContext,
} from "@/features/tables/commands";
import type { Record_ } from "@/features/tables/types";

// ════════════════════════════════════════════════════════════════════════════
// The command stack.
//
// Commands take their CommandContext as an argument rather than importing fetch,
// which is the whole reason undo is testable at all: the stack can be driven end
// to end against a fake, with no browser and no database.
// ════════════════════════════════════════════════════════════════════════════

function record(id: string, data: Record<string, unknown>, sortOrder = 1): Record_ {
  return {
    id,
    data,
    sortOrder,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    createdBy: null,
    updatedBy: null,
  };
}

/** A fake server. Holds records, and records what was asked of it.
 *
 *  `computeFrom` makes it behave like a table WITH a computed field: after every
 *  write it derives `fld_total` the way Postgres would and hands it back, exactly
 *  as swamp_computed_values does. Without it the fake is a table with no computed
 *  fields — which is most tables, and the path where patch returns []. */
function fakeContext(
  initial: Record_[],
  computeFrom?: (data: Record<string, unknown>) => Record<string, unknown>
) {
  let records = [...initial];
  let nextId = 100;

  const calls = {
    patch: [] as { id: string; values: Record<string, unknown> }[][],
    insert: 0,
    remove: 0,
    restore: 0,
    setOrder: [] as { id: string; sortOrder: number }[],
  };

  const ctx: CommandContext = {
    applyLocal: (fn) => {
      records = fn(records);
    },
    async patch(patches) {
      calls.patch.push(patches);
      if (!computeFrom) return [];

      // The server recomputes from the row as it now stands — NOT from the patch.
      // That is what makes this a real test of the ordering: the value handed back
      // depends on what actually landed.
      return patches.map((p) => {
        const row = records.find((r) => r.id === p.id);
        return { id: p.id, values: computeFrom(row?.data ?? {}) };
      });
    },
    async insert(rows) {
      calls.insert++;
      return rows.map((data) => record(`rec_${nextId++}`, data));
    },
    async remove() {
      calls.remove++;
    },
    async restore() {
      calls.restore++;
    },
    async setOrder(id, sortOrder) {
      calls.setOrder.push({ id, sortOrder });
    },
  };

  return { ctx, calls, get records() { return records; } };
}

describe("captureBefore", () => {
  it("captures the previous value of every cell an edit will touch", () => {
    const records = [record("a", { fld_x: "old", fld_y: 1 })];

    const before = captureBefore(records, [{ id: "a", values: { fld_x: "new" } }]);

    expect(before).toEqual([{ id: "a", values: { fld_x: "old" } }]);
  });

  it("captures null for a key the record does not have", () => {
    // This matters more than it looks. Writing into a previously-EMPTY cell and
    // then undoing must leave it empty — not holding an empty string, and not
    // holding the key with an undefined value. Otherwise "type, then undo" leaves
    // a subtly different record than you started with.
    const records = [record("a", {})];

    const before = captureBefore(records, [{ id: "a", values: { fld_x: "new" } }]);

    expect(before).toEqual([{ id: "a", values: { fld_x: null } }]);
  });
});

describe("editCells", () => {
  it("applies, and undo restores the previous value exactly", async () => {
    const fake = fakeContext([record("a", { fld_x: "old" })]);
    const edits = [{ id: "a", values: { fld_x: "new" } }];
    const before = captureBefore(fake.records, edits);

    const command = editCells(fake.ctx, edits, before, "edit");

    await command.do();
    expect(fake.records[0].data.fld_x).toBe("new");

    await command.undo();
    expect(fake.records[0].data.fld_x).toBe("old");
  });

  it("does not disturb other keys on the same record", async () => {
    const fake = fakeContext([record("a", { fld_x: "old", fld_keep: "keep me" })]);
    const edits = [{ id: "a", values: { fld_x: "new" } }];
    const before = captureBefore(fake.records, edits);

    const command = editCells(fake.ctx, edits, before, "edit");
    await command.do();
    await command.undo();

    expect(fake.records[0].data.fld_keep).toBe("keep me");
  });
});

describe("addRows", () => {
  it("undo removes exactly the rows it created", async () => {
    // Not "the last N rows" — someone else may have inserted in between, and
    // deleting by position would take their rows instead.
    const fake = fakeContext([record("a", {})]);
    const command = addRows(fake.ctx, [{ fld_x: "1" }], "add");

    await command.do();
    expect(fake.records).toHaveLength(2);

    await command.undo();
    expect(fake.records).toHaveLength(1);
    expect(fake.records[0].id).toBe("a");
  });

  it("redo RESTORES rather than re-inserting, so ids stay stable", async () => {
    // If redo inserted fresh rows they'd get NEW ids, and any command further up
    // the stack that referenced the old ones would be pointing at nothing.
    const fake = fakeContext([]);
    const command = addRows(fake.ctx, [{ fld_x: "1" }], "add");

    await command.do();
    const createdId = fake.records[0].id;

    await command.undo();
    await command.do(); // redo

    expect(fake.records[0].id).toBe(createdId);
    expect(fake.calls.insert).toBe(1); // inserted once, restored once
    expect(fake.calls.restore).toBe(1);
  });
});

describe("deleteRows", () => {
  it("undo puts the rows back where they were, not at the end", async () => {
    const fake = fakeContext([
      record("a", { n: 1 }, 1),
      record("b", { n: 2 }, 2),
      record("c", { n: 3 }, 3),
    ]);

    const command = deleteRows(fake.ctx, [fake.records[1]]);

    await command.do();
    expect(fake.records.map((r) => r.id)).toEqual(["a", "c"]);

    await command.undo();
    // Appending would silently reorder the table — "b" must come back between
    // "a" and "c", not after them.
    expect(fake.records.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("undo restores rather than re-inserting — soft delete is what makes this work", async () => {
    const fake = fakeContext([record("a", {})]);
    const command = deleteRows(fake.ctx, [fake.records[0]]);

    await command.do();
    await command.undo();

    expect(fake.calls.restore).toBe(1);
    expect(fake.calls.insert).toBe(0);
    expect(fake.records[0].id).toBe("a"); // same id, so the stack stays coherent
  });
});

describe("moveRow", () => {
  it("undo returns the row to its original order", async () => {
    const fake = fakeContext([record("a", {}, 1), record("b", {}, 2)]);
    const command = moveRow(fake.ctx, "b", 2, 0.5);

    await command.do();
    expect(fake.records.map((r) => r.id)).toEqual(["b", "a"]);

    await command.undo();
    expect(fake.records.map((r) => r.id)).toEqual(["a", "b"]);
    expect(fake.calls.setOrder).toEqual([
      { id: "b", sortOrder: 0.5 },
      { id: "b", sortOrder: 2 },
    ]);
  });
});

describe("CommandStack", () => {
  let fake: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fake = fakeContext([record("a", { fld_x: "0" })]);
  });

  const edit = (value: string) => {
    const edits = [{ id: "a", values: { fld_x: value } }];
    return editCells(fake.ctx, edits, captureBefore(fake.records, edits), `set ${value}`);
  };

  it("undoes and redoes in order", async () => {
    const stack = new CommandStack();

    await stack.run(edit("1"));
    await stack.run(edit("2"));
    expect(fake.records[0].data.fld_x).toBe("2");

    await stack.undo();
    expect(fake.records[0].data.fld_x).toBe("1");

    await stack.undo();
    expect(fake.records[0].data.fld_x).toBe("0");

    await stack.redo();
    expect(fake.records[0].data.fld_x).toBe("1");
  });

  it("a new command clears the redo stack", async () => {
    // Every editor does this. You cannot undo, type something else, and then redo
    // into a future that no longer exists.
    const stack = new CommandStack();

    await stack.run(edit("1"));
    await stack.undo();
    expect(stack.canRedo).toBe(true);

    await stack.run(edit("9"));
    expect(stack.canRedo).toBe(false);
  });

  it("a command that FAILS does not go on the stack", async () => {
    // An undo entry for something that never happened is worse than no undo entry:
    // pressing undo would "revert" a change the server never accepted, and now the
    // client and the server disagree.
    const stack = new CommandStack();
    const failing = {
      label: "boom",
      do: vi.fn().mockRejectedValue(new Error("server said no")),
      undo: vi.fn(),
    };

    await expect(stack.run(failing)).rejects.toThrow("server said no");
    expect(stack.canUndo).toBe(false);
  });

  it("reports nothing to undo when empty", async () => {
    const stack = new CommandStack();
    expect(await stack.undo()).toBeNull();
    expect(await stack.redo()).toBeNull();
  });

  // The window between "the edit is on screen" and "the edit is on the stack".
  //
  // A command applies its change locally and THEN awaits the server, so the new
  // value renders about instantly while run() is still suspended. Undo pressed in
  // that gap used to find an empty stack and answer "Nothing to undo" — with the
  // edit still sitting there. That is the exact moment people reach for undo.
  it("undo pressed before the write lands still undoes it", async () => {
    const stack = new CommandStack();

    let release!: () => void;
    const inFlight = new Promise<void>((r) => (release = r));

    const slow = {
      label: "slow edit",
      do: vi.fn(async () => {
        fake.records[0].data.fld_x = "typed";
        await inFlight; // the server, taking its time
      }),
      undo: vi.fn(async () => {
        fake.records[0].data.fld_x = "0";
      }),
    };

    const running = stack.run(slow);
    await Promise.resolve(); // let do() get as far as its await

    // On screen already, and the stack has not been told yet.
    expect(fake.records[0].data.fld_x).toBe("typed");

    const undoing = stack.undo(); // the user, not waiting
    release();

    await running;
    const label = await undoing;

    expect(label).toBe("slow edit");
    expect(slow.undo).toHaveBeenCalledOnce();
    expect(fake.records[0].data.fld_x).toBe("0");
  });

  it("a queued undo does not overtake the write it is undoing", async () => {
    // The reason this queues rather than just pushing the command earlier: undo must
    // not send its reverting write while the original write is still in flight, or
    // the row is decided by whichever happens to land second.
    const stack = new CommandStack();
    const order: string[] = [];

    let release!: () => void;
    const inFlight = new Promise<void>((r) => (release = r));

    const slow = {
      label: "slow",
      do: vi.fn(async () => {
        order.push("do:start");
        await inFlight;
        order.push("do:end");
      }),
      undo: vi.fn(async () => {
        order.push("undo");
      }),
    };

    const running = stack.run(slow);
    await Promise.resolve();
    const undoing = stack.undo();
    release();
    await Promise.all([running, undoing]);

    expect(order).toEqual(["do:start", "do:end", "undo"]);
  });

  it("a failed command does not wedge the queue behind it", async () => {
    // The queue outlives a rejection, or one server error would silently kill undo
    // for the rest of the session.
    const stack = new CommandStack();

    await expect(
      stack.run({
        label: "boom",
        do: vi.fn().mockRejectedValue(new Error("server said no")),
        undo: vi.fn(),
      })
    ).rejects.toThrow("server said no");

    await stack.run(edit("1"));
    expect(fake.records[0].data.fld_x).toBe("1");
    expect(await stack.undo()).toBe("set 1");
  });

  it("caps the history so a long session doesn't leak", async () => {
    const stack = new CommandStack(3);

    for (const v of ["1", "2", "3", "4", "5"]) await stack.run(edit(v));

    let undos = 0;
    while (stack.canUndo) {
      await stack.undo();
      undos++;
    }
    expect(undos).toBe(3);
  });
});

// ─── Computed fields follow the stack ───────────────────────────────────────

describe("computed fields after a write", () => {
  // A formula's value lives nowhere on disk — the query engine derives it at read
  // time. So after a write the client cannot know it and must be told. The rule
  // that makes this safe is that the server sends back COMPUTED KEYS ONLY: it may
  // never echo a scalar, or a slow response would land on top of newer typing, or
  // on top of an undo.
  const doubled = (data: Record<string, unknown>) => ({
    fld_total: Number(data.fld_n ?? 0) * 2,
  });

  it("merges what the write recomputed", async () => {
    const fake = fakeContext(
      [record("rec_1", { fld_n: 1, fld_total: 2 })],
      doubled
    );

    await editCells(fake.ctx, [{ id: "rec_1", values: { fld_n: 5 } }],
      [{ id: "rec_1", values: { fld_n: 1 } }], "edit").do();

    expect(fake.records[0].data.fld_n).toBe(5);
    expect(fake.records[0].data.fld_total).toBe(10);
  });

  it("undo puts the computed value back too", async () => {
    // The trap. Undo re-applies the captured scalar; if the computed value did not
    // come back with it, undo would leave the row in a state it was never in —
    // fld_n: 1 with a total of 10.
    const fake = fakeContext(
      [record("rec_1", { fld_n: 1, fld_total: 2 })],
      doubled
    );

    const cmd = editCells(fake.ctx, [{ id: "rec_1", values: { fld_n: 5 } }],
      [{ id: "rec_1", values: { fld_n: 1 } }], "edit");

    await cmd.do();
    expect(fake.records[0].data.fld_total).toBe(10);

    await cmd.undo();
    expect(fake.records[0].data.fld_n).toBe(1);
    expect(fake.records[0].data.fld_total).toBe(2);
  });

  it("survives edit, edit, undo, undo", async () => {
    const fake = fakeContext(
      [record("rec_1", { fld_n: 1, fld_total: 2 })],
      doubled
    );

    const first = editCells(fake.ctx, [{ id: "rec_1", values: { fld_n: 5 } }],
      [{ id: "rec_1", values: { fld_n: 1 } }], "a");
    const second = editCells(fake.ctx, [{ id: "rec_1", values: { fld_n: 9 } }],
      [{ id: "rec_1", values: { fld_n: 5 } }], "b");

    await first.do();
    await second.do();
    expect(fake.records[0].data).toMatchObject({ fld_n: 9, fld_total: 18 });

    await second.undo();
    expect(fake.records[0].data).toMatchObject({ fld_n: 5, fld_total: 10 });

    await first.undo();
    expect(fake.records[0].data).toMatchObject({ fld_n: 1, fld_total: 2 });
  });

  it("a table with no computed fields gets nothing back, and nothing breaks", async () => {
    const fake = fakeContext([record("rec_1", { fld_n: 1 })]);

    await editCells(fake.ctx, [{ id: "rec_1", values: { fld_n: 5 } }],
      [{ id: "rec_1", values: { fld_n: 1 } }], "edit").do();

    expect(fake.records[0].data).toEqual({ fld_n: 5 });
  });
});

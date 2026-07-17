"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CommandStack,
  addRows,
  captureBefore,
  deleteRows,
  editCells,
  moveRow,
  type CommandContext,
} from "./commands";
import { coercePasted, fillSeries, fromTSV, toTSV } from "./clipboard";
import { isReadOnlyField, type Field, type Record_ } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Grid interaction: the active cell, the selected range, the keyboard, the
// clipboard, and undo.
//
// All of it goes through the command stack. There is no path from a keystroke to
// a fetch() that doesn't produce an undoable command — that's the invariant, and
// it's the reason the stack was built before any of this.
// ════════════════════════════════════════════════════════════════════════════

export interface CellRef {
  row: number;
  col: number;
}

export interface Range {
  from: CellRef;
  to: CellRef;
}

const normalize = (r: Range) => ({
  top: Math.min(r.from.row, r.to.row),
  bottom: Math.max(r.from.row, r.to.row),
  left: Math.min(r.from.col, r.to.col),
  right: Math.max(r.from.col, r.to.col),
});

export function inRange(range: Range | null, row: number, col: number): boolean {
  if (!range) return false;
  const { top, bottom, left, right } = normalize(range);
  return row >= top && row <= bottom && col >= left && col <= right;
}

export interface UseGridArgs {
  fields: Field[]; // visible fields, in view order
  records: Record_[];
  tableId: string;
  applyLocal: (fn: (records: Record_[]) => Record_[]) => void;
  onRecordsChanged: () => void;
}

export function useGrid({
  fields,
  records,
  tableId,
  applyLocal,
  onRecordsChanged,
}: UseGridArgs) {
  const [active, setActive] = React.useState<CellRef | null>(null);
  const [range, setRange] = React.useState<Range | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [dragFill, setDragFill] = React.useState<Range | null>(null);

  const stack = React.useRef(new CommandStack()).current;
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);

  // ── The command context ──
  //
  // Commands are pure: they take this and never import a fetch. That means the
  // whole stack can be driven by a fake in a unit test, which is the only way to
  // test undo without a browser.
  const ctx: CommandContext = React.useMemo(
    () => ({
      applyLocal,

      async patch(patches) {
        const res = await fetch(`/api/tables/${tableId}/records`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patches }),
        });

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            body?.errors?.[0]?.error ?? body?.error ?? "Could not save"
          );
        }

        // What the write recomputed. Empty for a table with no computed fields,
        // which is most of them.
        return body?.computed ?? [];
      },

      async insert(rows) {
        const res = await fetch(`/api/tables/${tableId}/records`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: rows }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.errors?.[0]?.error ?? body?.error ?? "Could not add");
        return body.records as Record_[];
      },

      async remove(ids) {
        const res = await fetch(`/api/tables/${tableId}/records`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error("Could not delete");
      },

      async restore(ids) {
        const res = await fetch(`/api/tables/${tableId}/records/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error("Could not restore");
      },

      async setOrder(id, sortOrder) {
        const res = await fetch(`/api/tables/${tableId}/records/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: id, sortOrder }),
        });
        if (!res.ok) throw new Error("Could not move the row");
      },
    }),
    [tableId, applyLocal]
  );

  /**
   * Run a command, and roll back the optimistic local change if the server says no.
   *
   * A failed write that leaves the new value on screen is the worst outcome: the
   * user saw it stick, and it didn't.
   */
  const run = React.useCallback(
    async (command: Parameters<CommandStack["run"]>[0]) => {
      try {
        await stack.run(command);
        // The write landed. `body.computed` reconciled the edited rows, but a rollup
        // or formula on a DIFFERENT row can depend on this one — the server knows,
        // the client can't. onRecordsChanged lets the workspace refetch when (and
        // only when) the table has computed fields.
        onRecordsChanged();
      } catch (e) {
        toast.error((e as Error).message);
        // The command applied its local change before the request failed. Undo it
        // locally only — the server never took it, so there's nothing to reverse
        // there.
        await command.undo().catch(() => {});
      }
      forceRender();
    },
    [stack, onRecordsChanged]
  );

  const undo = React.useCallback(async () => {
    const label = await stack.undo();
    forceRender();
    if (label) {
      onRecordsChanged();
      toast.success(`Undid: ${label}`);
    } else toast("Nothing to undo");
  }, [stack, onRecordsChanged]);

  const redo = React.useCallback(async () => {
    const label = await stack.redo();
    forceRender();
    if (label) {
      onRecordsChanged();
      toast.success(`Redid: ${label}`);
    } else toast("Nothing to redo");
  }, [stack, onRecordsChanged]);

  // ── Editing ──

  const setCell = React.useCallback(
    (row: number, col: number, value: unknown) => {
      const record = records[row];
      const field = fields[col];
      if (!record || !field || isReadOnlyField(field.type)) return;

      const edits = [{ id: record.id, values: { [field.key]: value } }];
      const before = captureBefore(records, edits);

      void run(editCells(ctx, edits, before, `edit ${field.name}`));
    },
    [records, fields, ctx, run]
  );

  /** Write a rectangular block. Paste, fill and clear all funnel through here. */
  const setBlock = React.useCallback(
    (top: number, left: number, block: unknown[][], label: string) => {
      const edits: { id: string; values: Record<string, unknown> }[] = [];
      const newRows: Record<string, unknown>[] = [];

      block.forEach((rowValues, dr) => {
        const rowIndex = top + dr;
        const values: Record<string, unknown> = {};

        rowValues.forEach((value, dc) => {
          const field = fields[left + dc];
          if (!field || isReadOnlyField(field.type)) return;
          values[field.key] = value;
        });

        if (!Object.keys(values).length) return;

        const record = records[rowIndex];
        if (record) edits.push({ id: record.id, values });
        // Pasting past the last row EXTENDS the table. Excel does this and people
        // rely on it — a paste that silently truncates loses data with no warning.
        else newRows.push(values);
      });

      const commands: Promise<void>[] = [];

      if (edits.length) {
        const before = captureBefore(records, edits);
        commands.push(run(editCells(ctx, edits, before, label)));
      }
      if (newRows.length) {
        commands.push(
          run(addRows(ctx, newRows, `${label} (+${newRows.length} rows)`))
        );
      }

      void Promise.all(commands);
    },
    [records, fields, ctx, run]
  );

  // ── Clipboard ──

  const copy = React.useCallback(async () => {
    if (!range && !active) return;

    const r = range ?? { from: active!, to: active! };
    const { top, bottom, left, right } = normalize(r);

    const block: unknown[][] = [];
    for (let row = top; row <= bottom; row++) {
      const line: unknown[] = [];
      for (let col = left; col <= right; col++) {
        line.push(records[row]?.data[fields[col]?.key]);
      }
      block.push(line);
    }

    await navigator.clipboard.writeText(toTSV(block));
    const cells = (bottom - top + 1) * (right - left + 1);
    toast.success(`Copied ${cells} ${cells === 1 ? "cell" : "cells"}`);
  }, [range, active, records, fields]);

  const paste = React.useCallback(
    async (text: string) => {
      if (!active) return;

      const parsed = fromTSV(text);
      if (!parsed.length) return;

      const block = parsed.map((row) =>
        row.map((value, dc) => {
          const field = fields[active.col + dc];
          return field ? coercePasted(field.type, value) : value;
        })
      );

      const cells = block.reduce((n, r) => n + r.length, 0);
      setBlock(active.row, active.col, block, `paste ${cells} cells`);
    },
    [active, fields, setBlock]
  );

  const clearRange = React.useCallback(() => {
    if (!range && !active) return;

    const r = range ?? { from: active!, to: active! };
    const { top, bottom, left, right } = normalize(r);

    const block: unknown[][] = [];
    for (let row = top; row <= bottom; row++) {
      block.push(Array.from({ length: right - left + 1 }, () => null));
    }

    setBlock(top, left, block, "clear cells");
  }, [range, active, setBlock]);

  // ── Fill handle ──

  const commitFill = React.useCallback(
    (target: Range) => {
      if (!range) return;

      const src = normalize(range);
      const dst = normalize(target);

      // Vertical fill only. Horizontal fill across columns of different types is
      // rarely what anyone means, and getting it wrong is worse than not offering it.
      if (dst.bottom <= src.bottom) return;

      const block: unknown[][] = [];
      const count = dst.bottom - src.bottom;

      for (let col = src.left; col <= src.right; col++) {
        const key = fields[col]?.key;
        const source = [];
        for (let row = src.top; row <= src.bottom; row++) {
          source.push(records[row]?.data[key]);
        }

        const filled = fillSeries(source, count);
        filled.forEach((value, i) => {
          block[i] ??= [];
          block[i][col - src.left] = value;
        });
      }

      setBlock(src.bottom + 1, src.left, block, `fill ${count} cells`);
    },
    [range, records, fields, setBlock]
  );

  // ── Rows ──

  const addRecord = React.useCallback(
    (values: Record<string, unknown> = {}) => {
      void run(addRows(ctx, [values], "add row"));
    },
    [ctx, run]
  );

  const deleteRecords = React.useCallback(
    (ids: string[]) => {
      const targets = records.filter((r) => ids.includes(r.id));
      if (!targets.length) return;
      void run(deleteRows(ctx, targets));
    },
    [records, ctx, run]
  );

  /**
   * Drop a row between two others.
   *
   * Fractional order: the new position is the midpoint of its neighbours, so ONE
   * row is written. No renumbering, no lock contention with someone dragging a
   * different row at the same time.
   */
  const moveRecord = React.useCallback(
    (fromIndex: number, toIndex: number) => {
      const record = records[fromIndex];
      if (!record || fromIndex === toIndex) return;

      const before = toIndex > fromIndex ? records[toIndex] : records[toIndex - 1];
      const after = toIndex > fromIndex ? records[toIndex + 1] : records[toIndex];

      const lo = before?.sortOrder ?? (after ? after.sortOrder - 1 : 0);
      const hi = after?.sortOrder ?? lo + 1;

      void run(moveRow(ctx, record.id, record.sortOrder, (lo + hi) / 2));
    },
    [records, ctx, run]
  );

  // ── Keyboard ──

  const move = React.useCallback(
    (dr: number, dc: number, extend = false) => {
      if (!active) return;

      // Step from the MOVING end of the selection, not the anchor.
      //
      // `active` is the anchor and deliberately doesn't move while extending, so
      // stepping from it made every shift+Down recompute the same cell —
      // active.row + 1, forever. The selection reached two cells and stopped dead.
      // Nothing here was off by one; the second press onwards did nothing at all.
      const base = extend ? (range?.to ?? active) : active;

      const row = Math.max(0, Math.min(records.length - 1, base.row + dr));
      const col = Math.max(0, Math.min(fields.length - 1, base.col + dc));

      if (extend) {
        setRange({ from: range?.from ?? active, to: { row, col } });
      } else {
        setActive({ row, col });
        setRange(null);
      }
    },
    [active, range, records.length, fields.length]
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // Undo/redo work whether or not a cell is active — you might have just
      // deleted the row you were standing on.
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redo();
        return;
      }

      if (!active) return;

      // While a cell editor is open the keyboard belongs to it. Only Escape and
      // Enter are ours, and the editor handles those itself.
      if (editing) return;

      if (meta && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void copy();
        return;
      }
      if (meta && e.key === "a") {
        e.preventDefault();
        setRange({
          from: { row: 0, col: 0 },
          to: { row: records.length - 1, col: fields.length - 1 },
        });
        return;
      }

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          move(-1, 0, e.shiftKey);
          return;
        case "ArrowDown":
          e.preventDefault();
          move(1, 0, e.shiftKey);
          return;
        case "ArrowLeft":
          e.preventDefault();
          move(0, -1, e.shiftKey);
          return;
        case "ArrowRight":
          e.preventDefault();
          move(0, 1, e.shiftKey);
          return;

        case "Tab": {
          e.preventDefault();
          // Tab WRAPS: past the last column, drop to the start of the next row.
          // A Tab that just stops at the right edge makes data entry miserable.
          const forward = !e.shiftKey;
          let { row, col } = active;

          if (forward) {
            col++;
            if (col >= fields.length) {
              col = 0;
              row = Math.min(records.length - 1, row + 1);
            }
          } else {
            col--;
            if (col < 0) {
              col = fields.length - 1;
              row = Math.max(0, row - 1);
            }
          }

          setActive({ row, col });
          setRange(null);
          return;
        }

        case "Enter":
          e.preventDefault();
          setEditing(true);
          return;

        case "Escape":
          e.preventDefault();
          setRange(null);
          return;

        case "Backspace":
        case "Delete":
          e.preventDefault();
          clearRange();
          return;

        case " ": {
          const field = fields[active.col];
          if (field?.type === "boolean") {
            e.preventDefault();
            const current = records[active.row]?.data[field.key];
            setCell(active.row, active.col, !(current === true || current === "true"));
          }
          return;
        }
      }

      // Type-to-replace: any printable character starts editing, and the editor
      // opens with that character rather than the old value. This is what makes a
      // grid feel like a spreadsheet instead of a form.
      if (!meta && !e.altKey && e.key.length === 1) {
        setEditing(true);
      }
    },
    [
      active,
      editing,
      fields,
      records,
      move,
      copy,
      clearRange,
      setCell,
      undo,
      redo,
    ]
  );

  return {
    active,
    setActive,
    range,
    setRange,
    editing,
    setEditing,
    dragFill,
    setDragFill,

    onKeyDown,
    paste,
    copy,
    setCell,
    commitFill,

    addRecord,
    deleteRecords,
    moveRecord,

    undo,
    redo,
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
  };
}

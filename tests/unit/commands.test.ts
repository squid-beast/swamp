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

/** A fake server. Holds records, and records what was asked of it. */
function fakeContext(initial: Record_[]) {
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

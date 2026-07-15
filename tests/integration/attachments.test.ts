import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Attachments — and specifically, the garbage.
//
// The easy half of an attachment feature is uploading a file. The half that gets
// skipped is what happens when somebody deletes it from the cell: nothing points
// at the object any more, nothing can find it, and you pay for it for the rest of
// the product's life.
//
// `file_references` only helps if something maintains it on EVERY write, and the
// only thing that sees every write is a trigger. So that's what's under test.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let mallory: TestUser;

let baseId: string;
let tableId: string;
let fileFieldId: string;

const file = (path: string) => ({
  id: path.split("-").pop(),
  name: "quote.pdf",
  size: 1234,
  mime: "application/pdf",
  path,
});

async function reference(path: string) {
  const { data } = await alice.db
    .from("file_references")
    .select("orphaned_at, record_id")
    .eq("path", path)
    .single();

  return data as { orphaned_at: string | null; record_id: string | null };
}

beforeAll(async () => {
  alice = await createUser();
  mallory = await createUser();

  const workspaceId = await workspaceOf(alice);

  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "Files" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;

  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "Docs" }).select().single()
  ) as { id: string };
  tableId = table.id;

  const fields = must(
    await alice.db
      .from("fields")
      .insert([
        { table_id: tableId, base_id: baseId, name: "Name",  key: "fld_name",  type: "text",       is_primary: true,  sort_order: 1 },
        { table_id: tableId, base_id: baseId, name: "Files", key: "fld_files", type: "attachment", is_primary: false, sort_order: 2 },
      ])
      .select()
  ) as { id: string; key: string }[];

  fileFieldId = fields.find((f) => f.key === "fld_files")!.id;
});

afterAll(async () => {
  await deleteUser(alice);
  await deleteUser(mallory);
});

describe("the reference count", () => {
  it("is claimed when a record points at the file", async () => {
    const path = `${baseId}/${tableId}/aaaa-quote.pdf`;

    // The row is written BEFORE the upload — see requestUpload. An upload that
    // succeeded while the client crashed would otherwise leave a file in storage
    // that nothing in the database has ever heard of: unreferenced, unfindable, and
    // paid for forever.
    must(
      await alice.db.from("file_references").insert({
        base_id: baseId, table_id: tableId, field_id: fileFieldId,
        path, name: "quote.pdf", size: 1234, mime: "application/pdf",
      })
    );

    expect((await reference(path)).record_id).toBeNull();

    const record = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_files: [file(path)] } })
        .select()
        .single()
    ) as { id: string };

    const ref = await reference(path);
    expect(ref.record_id).toBe(record.id);
    expect(ref.orphaned_at).toBeNull();
  });

  it("is ORPHANED when the cell stops pointing at it", async () => {
    const path = `${baseId}/${tableId}/bbbb-old.pdf`;

    must(
      await alice.db.from("file_references").insert({
        base_id: baseId, table_id: tableId, field_id: fileFieldId,
        path, name: "old.pdf", size: 1, mime: "application/pdf",
      })
    );

    const record = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_files: [file(path)] } })
        .select()
        .single()
    ) as { id: string };

    expect((await reference(path)).orphaned_at).toBeNull();

    await alice.db.from("records").update({ data: { fld_files: [] } }).eq("id", record.id);

    // Marked, not deleted. The grace period exists because ⌘Z is right there, and
    // deleting the object at the moment of un-reference means undo brings the cell
    // back and silently loses the file.
    expect((await reference(path)).orphaned_at).not.toBeNull();
  });

  it("is UN-orphaned when the file comes back", async () => {
    const path = `${baseId}/${tableId}/cccc-undo.pdf`;

    must(
      await alice.db.from("file_references").insert({
        base_id: baseId, table_id: tableId, field_id: fileFieldId,
        path, name: "undo.pdf", size: 1, mime: "application/pdf",
      })
    );

    const record = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_files: [file(path)] } })
        .select()
        .single()
    ) as { id: string };

    await alice.db.from("records").update({ data: { fld_files: [] } }).eq("id", record.id);
    expect((await reference(path)).orphaned_at).not.toBeNull();

    // Undo. Which is a plain patch — the command stack has no idea attachments are
    // special, and it shouldn't have to.
    await alice.db
      .from("records")
      .update({ data: { fld_files: [file(path)] } })
      .eq("id", record.id);

    expect((await reference(path)).orphaned_at).toBeNull();
  });

  it("orphans everything on a record when the record is deleted", async () => {
    const path = `${baseId}/${tableId}/dddd-gone.pdf`;

    must(
      await alice.db.from("file_references").insert({
        base_id: baseId, table_id: tableId, field_id: fileFieldId,
        path, name: "gone.pdf", size: 1, mime: "application/pdf",
      })
    );

    const record = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_files: [file(path)] } })
        .select()
        .single()
    ) as { id: string };

    await alice.db
      .from("records")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", record.id);

    expect((await reference(path)).orphaned_at).not.toBeNull();

    // ...and restoring it takes them back. A soft delete you can undo, whose files
    // you cannot, is not a soft delete.
    await alice.db.from("records").update({ deleted_at: null }).eq("id", record.id);
    expect((await reference(path)).orphaned_at).toBeNull();
  });
});

describe("who can see a file", () => {
  it("a stranger cannot read the reference table", async () => {
    const { data } = await mallory.db.from("file_references").select("path");
    expect(data ?? []).toHaveLength(0);
  });

  it("anon cannot read it at all", async () => {
    const { error } = await anon().from("file_references").select("path").limit(1);
    expect(error).not.toBeNull();
  });

  it("the storage path carries the base id, because the policy reads it", async () => {
    // `<baseId>/<tableId>/<uuid>-<name>` — swamp_storage_base() takes the first
    // segment and hands it to swamp_can(). This is why the SERVER chooses the path
    // and the client never does: a client-chosen path is a client-chosen base id.
    const { data } = await alice.db.rpc("swamp_storage_base", {
      p_name: `${baseId}/${tableId}/x-file.pdf`,
    });

    expect(data).toBe(baseId);

    // A path that doesn't start with a uuid resolves to NULL — and swamp_can(NULL)
    // is false, so it denies rather than defaulting open.
    const { data: junk } = await alice.db.rpc("swamp_storage_base", {
      p_name: "../../etc/passwd",
    });

    expect(junk).toBeNull();
  });
});

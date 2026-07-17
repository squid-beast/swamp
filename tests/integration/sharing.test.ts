import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Public shared views.
//
// This is the only part of SWAMP an ANONYMOUS user can reach, which makes it the
// only part where a mistake is a data breach rather than a bug.
//
// The tests below are adversarial on purpose. Every one of them is a thing a
// stranger with a share link would actually try:
//
//   • read a table you didn't share
//   • read a column the view hides
//   • FILTER by a column the view hides, and read the answer off the row count
//   • remove the view's filter to see the rows it excludes
//   • write to a shared grid
//   • post a field the form doesn't display
// ════════════════════════════════════════════════════════════════════════════

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** A client with NO session at all — a stranger with a link. */
function anonClient(): SupabaseClient {
  return createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let alice: TestUser;
let anon: SupabaseClient;

let baseId: string;
let tableId: string;
let gridViewId: string;
let formViewId: string;
let secretFieldId: string;

let openShare: string;
let lockedShare: string;
let formShare: string;

const PASSWORD = "hunter2";

beforeAll(async () => {
  alice = await createUser();
  anon = anonClient();

  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "Share" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;

  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "Leads" }).select().single()
  ) as { id: string };
  tableId = table.id;

  const fields = must(
    await alice.db
      .from("fields")
      .insert([
        { table_id: tableId, base_id: baseId, name: "Name",   key: "fld_name",   type: "text",     is_primary: true,  sort_order: 1 },
        { table_id: tableId, base_id: baseId, name: "Status", key: "fld_status", type: "status",   is_primary: false, sort_order: 2 },
        // The column the view will hide. Everything below is about making sure a
        // visitor can't learn what's in it — not by reading, and not by asking.
        { table_id: tableId, base_id: baseId, name: "Salary", key: "fld_salary", type: "currency", is_primary: false, sort_order: 3 },
      ])
      .select()
  ) as { id: string; key: string }[];

  secretFieldId = fields.find((f) => f.key === "fld_salary")!.id;
  const statusFieldId = fields.find((f) => f.key === "fld_status")!.id;

  must(
    await alice.db.from("records").insert([
      { table_id: tableId, base_id: baseId, sort_order: 1, data: { fld_name: "Public A",  fld_status: "public",  fld_salary: "100000" } },
      { table_id: tableId, base_id: baseId, sort_order: 2, data: { fld_name: "Public B",  fld_status: "public",  fld_salary: "50000"  } },
      { table_id: tableId, base_id: baseId, sort_order: 3, data: { fld_name: "Private C", fld_status: "private", fld_salary: "900000" } },
    ])
  );

  // ── The shared grid: hides Salary, filters to status = public ──
  const gridView = must(
    await alice.db
      .from("views")
      .insert({ table_id: tableId, base_id: baseId, name: "Public", type: "grid", is_default: true })
      .select()
      .single()
  ) as { id: string };
  gridViewId = gridView.id;

  must(
    await alice.db
      .from("view_fields")
      .insert({ view_id: gridViewId, field_id: secretFieldId, base_id: baseId, show: false, sort_order: 3 })
  );

  must(
    await alice.db.from("filters").insert({
      base_id: baseId, view_id: gridViewId, is_group: false,
      field_id: statusFieldId, op: "eq", value: "public", sort_order: 0,
    })
  );

  // ── A form ──
  const formView = must(
    await alice.db
      .from("views")
      .insert({ table_id: tableId, base_id: baseId, name: "Contact", type: "form" })
      .select()
      .single()
  ) as { id: string };
  formViewId = formView.id;

  // The form shows Name only. Status and Salary are off it.
  must(
    await alice.db.from("view_fields").insert([
      { view_id: formViewId, field_id: secretFieldId,  base_id: baseId, show: false, sort_order: 3 },
      { view_id: formViewId, field_id: statusFieldId,  base_id: baseId, show: false, sort_order: 2 },
    ])
  );

  // ── Share links ──
  openShare = must(
    await alice.db.rpc("swamp_share_view", { p_view_id: gridViewId, p_password: null })
  ) as unknown as string;

  formShare = must(
    await alice.db.rpc("swamp_share_view", { p_view_id: formViewId, p_password: null })
  ) as unknown as string;

  // A second, password-protected share of the same view. Re-sharing rotates the
  // id, so make it last and keep its own handle.
  const locked = must(
    await alice.db
      .from("views")
      .insert({ table_id: tableId, base_id: baseId, name: "Locked", type: "grid" })
      .select()
      .single()
  ) as { id: string };

  lockedShare = must(
    await alice.db.rpc("swamp_share_view", { p_view_id: locked.id, p_password: PASSWORD })
  ) as unknown as string;
});

afterAll(async () => {
  await deleteUser(alice);
});

// ─── The baseline ───────────────────────────────────────────────────────────

describe("an anonymous visitor with a link", () => {
  it("can read the view", async () => {
    const { data, error } = await anon.rpc("swamp_shared_records", {
      p_share_id: openShare,
      p_password: null,
      p_spec: {},
    });

    expect(error).toBeNull();
    const records = (data as { records: { data: Record<string, unknown> }[] }).records;

    // The view's filter is status = public, so Private C is not here.
    expect(records.map((r) => r.data.fld_name)).toEqual(["Public A", "Public B"]);
  });

  it("does NOT receive the hidden column", async () => {
    const { data } = await anon.rpc("swamp_shared_records", {
      p_share_id: openShare, p_password: null, p_spec: {},
    });

    const records = (data as { records: { data: Record<string, unknown> }[] }).records;
    for (const r of records) {
      expect(r.data).not.toHaveProperty("fld_salary");
    }
  });

  it("is not told the hidden field exists", async () => {
    const { data } = await anon.rpc("swamp_shared_meta", {
      p_share_id: openShare, p_password: null,
    });

    const fields = (data as { fields: { key: string }[] }).fields;
    expect(fields.map((f) => f.key)).toEqual(["fld_name", "fld_status"]);
  });
});

// ─── The attacks ────────────────────────────────────────────────────────────

describe("things a stranger will actually try", () => {
  it("CANNOT filter by a hidden column — the blind oracle is closed", async () => {
    // THE test. Stripping hidden keys from the RESULT is not enough: a visitor
    // could filter `salary > 100000`, count the rows, and binary-search a value
    // they were never shown. So the query engine is scoped to the view's visible
    // fields, and a hidden column is not merely absent from the payload — it does
    // not exist as far as the query is concerned.
    const { error } = await anon.rpc("swamp_shared_records", {
      p_share_id: openShare,
      p_password: null,
      p_spec: { filter: { field: "fld_salary", op: "gt", value: 100000 } },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/unknown field/i);
  });

  it("CANNOT sort by a hidden column either", async () => {
    const { error } = await anon.rpc("swamp_shared_records", {
      p_share_id: openShare,
      p_password: null,
      p_spec: { sort: [{ field: "fld_salary", dir: "desc" }] },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/unknown field/i);
  });

  it("CANNOT widen the view's filter to see excluded rows", async () => {
    // The visitor sends a filter that would match everything. The view's own
    // filter is AND-ed with it, not replaced — so Private C stays invisible.
    // Replacing the filter is the bug that turns "a shared view of public deals"
    // into "a shared view of every deal".
    const { data } = await anon.rpc("swamp_shared_records", {
      p_share_id: openShare,
      p_password: null,
      p_spec: { filter: { field: "fld_name", op: "notempty" } },
    });

    const records = (data as { records: { data: Record<string, unknown> }[] }).records;
    expect(records.map((r) => r.data.fld_name)).not.toContain("Private C");
  });

  it("CANNOT read the underlying table directly", async () => {
    // The functions are the only door. Since Phase 6, anon has no GRANT on `records`
    // at all — so this isn't "RLS returns an empty set", it's "permission denied,
    // data is null". Before Phase 6 the grant existed and RLS returned []; the
    // lockdown made it stricter. Either way: anon gets zero rows.
    const { data, error } = await anon.from("records").select("*").eq("table_id", tableId);
    expect(data ?? []).toHaveLength(0);
    expect(error).not.toBeNull();
  });

  it("CANNOT query the table through the normal engine", async () => {
    const { error } = await anon.rpc("swamp_query_records", {
      p_table_id: tableId,
      p_spec: {},
    });
    // SECURITY INVOKER: RLS applies, anon sees no fields, the query dies.
    expect(error).not.toBeNull();
  });

  it("CANNOT write to a shared GRID", async () => {
    // Sharing a view to be read is not sharing it to be written.
    const { error } = await anon
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, data: { fld_name: "Injected" } });

    expect(error).not.toBeNull();
  });

  it("CANNOT submit to a shared view that isn't a form", async () => {
    const { error } = await anon.rpc("swamp_submit_form", {
      p_share_id: openShare,
      p_password: null,
      p_values: { fld_name: "Injected" },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not a form/i);
  });

  it("gets a 404-shaped error for a link that doesn't exist", async () => {
    const { error } = await anon.rpc("swamp_shared_meta", {
      p_share_id: "totally-made-up",
      p_password: null,
    });
    expect(error).not.toBeNull();
  });
});

// ─── Passwords ──────────────────────────────────────────────────────────────

describe("password-protected links", () => {
  it("refuses without the password", async () => {
    const { error } = await anon.rpc("swamp_shared_meta", {
      p_share_id: lockedShare, p_password: null,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/password/i);
  });

  it("refuses the wrong password", async () => {
    const { error } = await anon.rpc("swamp_shared_meta", {
      p_share_id: lockedShare, p_password: "wrong",
    });
    expect(error).not.toBeNull();
  });

  it("accepts the right one", async () => {
    const { data, error } = await anon.rpc("swamp_shared_meta", {
      p_share_id: lockedShare, p_password: PASSWORD,
    });

    expect(error).toBeNull();
    expect((data as { table: { name: string } }).table.name).toBe("Leads");
  });

  it("stores a HASH, never the password", async () => {
    const { data } = await alice.db
      .from("views")
      .select("share_password_hash")
      .eq("share_id", lockedShare)
      .single();

    const hash = data!.share_password_hash as string;
    expect(hash).not.toContain(PASSWORD);
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt
  });
});

// ─── Forms ──────────────────────────────────────────────────────────────────

describe("form submission", () => {
  it("accepts a submission into the fields the form shows", async () => {
    const { data, error } = await anon.rpc("swamp_submit_form", {
      p_share_id: formShare,
      p_password: null,
      p_values: { fld_name: "From the form" },
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const { data: rows } = await alice.db
      .from("records")
      .select("data")
      .eq("table_id", tableId)
      .eq("id", data as string);

    expect((rows![0].data as Record<string, unknown>).fld_name).toBe("From the form");
  });

  it("IGNORES a field the form does not display", async () => {
    // The attack: POST a key the form never showed you. Here, Salary — hidden on
    // the form — and Status, which the owner controls internally.
    const { data: id } = await anon.rpc("swamp_submit_form", {
      p_share_id: formShare,
      p_password: null,
      p_values: {
        fld_name: "Sneaky",
        fld_salary: "999999",
        fld_status: "private",
      },
    });

    const { data: rows } = await alice.db
      .from("records")
      .select("data")
      .eq("id", id as string);

    const stored = rows![0].data as Record<string, unknown>;

    expect(stored.fld_name).toBe("Sneaky");
    expect(stored).not.toHaveProperty("fld_salary");
    expect(stored).not.toHaveProperty("fld_status");
  });
});

// ─── Revocation ─────────────────────────────────────────────────────────────

describe("revoking a link", () => {
  it("makes it stop working immediately", async () => {
    const view = must(
      await alice.db
        .from("views")
        .insert({ table_id: tableId, base_id: baseId, name: "Temp", type: "grid" })
        .select()
        .single()
    ) as { id: string };

    const share = must(
      await alice.db.rpc("swamp_share_view", { p_view_id: view.id, p_password: null })
    ) as unknown as string;

    const before = await anon.rpc("swamp_shared_meta", { p_share_id: share, p_password: null });
    expect(before.error).toBeNull();

    must(await alice.db.rpc("swamp_unshare_view", { p_view_id: view.id }));

    const after = await anon.rpc("swamp_shared_meta", { p_share_id: share, p_password: null });
    expect(after.error).not.toBeNull();
  });
});

// ─── The `user` field must not be reachable from a public form ──────────────

describe("user fields on a public form", () => {
  // swamp_submit_form builds its allow-list by EXCLUSION, so any field type not
  // named in that NOT IN list is writable by a stranger. `user` stores a uuid and
  // means "a person here is responsible" — an anonymous submitter must not get to
  // set one. They cannot even pick sensibly: the roster is private
  // (swamp_visible_profiles is granted to `authenticated` only), so the value would
  // be an unvalidated uuid from an untrusted source, landing in a column about
  // people.
  //
  // The filter in form-runtime.tsx drops it from the rendered form. That is a
  // courtesy, not a boundary — this is the boundary.
  let userFieldId: string;

  beforeAll(async () => {
    const f = must(
      await alice.db
        .from("fields")
        .insert({
          table_id: tableId,
          base_id: baseId,
          name: "Owner",
          key: "fld_owner",
          type: "user",
          sort_order: 9,
        })
        .select()
        .single()
    ) as { id: string };
    userFieldId = f.id;

    // Show it on the form. The point is that the server refuses it EVEN THEN —
    // "it isn't displayed" must not be what's protecting us.
    must(
      await alice.db.from("view_fields").insert({
        view_id: formViewId,
        field_id: userFieldId,
        base_id: baseId,
        show: true,
        sort_order: 9,
      })
    );
  });

  it("drops a user value posted by an anonymous submitter", async () => {
    const id = must(
      await anon.rpc("swamp_submit_form", {
        p_share_id: formShare,
        p_password: null,
        p_values: { fld_name: "Walk-in", fld_owner: alice.id },
      })
    ) as unknown as string;

    const { data } = await alice.db.from("records").select("data").eq("id", id).single();

    // The name they were asked for landed; the owner they were not asked for did not.
    expect((data!.data as Record<string, unknown>).fld_name).toBe("Walk-in");
    expect((data!.data as Record<string, unknown>).fld_owner).toBeUndefined();
  });

  it("an editor CAN still set it through the app", async () => {
    // The field is not read-only — it is only unreachable from the anonymous path.
    // Without this, "the server drops it" would be indistinguishable from "the
    // field doesn't work".
    const rec = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_owner: alice.id } })
        .select()
        .single()
    ) as { data: Record<string, unknown> };

    expect(rec.data.fld_owner).toBe(alice.id);
  });
});

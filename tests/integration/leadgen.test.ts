import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anon, createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Lead-gen hardening — the public ingress, tried the way the internet will try it.
//
// SWAMP's lead-gen story is two doors:
//   • a public FORM an anonymous visitor submits
//   • a scoped TOKEN another server POSTs a lead through
//
// This suite proves the hardening added for that: a rate limit that actually
// counts, a token that can be PINNED to one table and reach nothing else, and the
// end-to-end path from a form submission to a webhook delivery.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
const pub = () => anon();

let baseId: string;
let leadsTableId: string;
let secretTableId: string;
let formViewId: string;

async function mintPinned(
  scopes: string[],
  tableIds: string[]
): Promise<string> {
  const { data, error } = await alice.db.rpc("swamp_create_token", {
    p_base_id: baseId,
    p_name: "lead-ingest",
    p_scopes: scopes,
    p_expires_at: null,
    p_table_ids: tableIds,
  });
  if (error) throw new Error(error.message);
  return (data as { token: string }).token;
}

/** A fresh Leads-shaped table (Name + Email) so a test's record counts are its
 *  own and never entangled with the form/webhook fixtures above. */
async function newLeadsTable(name: string): Promise<string> {
  const t = must(
    await alice.db.from("tables").insert({ base_id: baseId, name }).select().single()
  ) as { id: string };
  must(
    await alice.db.from("fields").insert([
      { table_id: t.id, base_id: baseId, name: "Name",  key: "fld_name",  type: "text",  is_primary: true,  sort_order: 1 },
      { table_id: t.id, base_id: baseId, name: "Email", key: "fld_email", type: "email", is_primary: false, sort_order: 2 },
    ])
  );
  return t.id;
}

/** How many live records in a table carry this exact email — the assertion the
 *  retry-safety and upsert tests turn on. */
async function countByEmail(tableId: string, email: string): Promise<number> {
  const { data, error } = await alice.db
    .from("records")
    .select("id")
    .eq("table_id", tableId)
    .is("deleted_at", null)
    .eq("data->>fld_email", email);
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

beforeAll(async () => {
  alice = await createUser();
  const workspaceId = await workspaceOf(alice);

  const base = must(
    await alice.db.from("bases").insert({ workspace_id: workspaceId, name: "LeadGen" }).select().single()
  ) as { id: string };
  baseId = base.id;

  const leads = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "Leads" }).select().single()
  ) as { id: string };
  leadsTableId = leads.id;

  const secret = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "Internal" }).select().single()
  ) as { id: string };
  secretTableId = secret.id;

  const leadFields = must(
    await alice.db.from("fields").insert([
      { table_id: leadsTableId, base_id: baseId, name: "Name",  key: "fld_name",  type: "text",  is_primary: true,  sort_order: 1 },
      { table_id: leadsTableId, base_id: baseId, name: "Email", key: "fld_email", type: "email", is_primary: false, sort_order: 2 },
    ]).select()
  ) as { id: string; key: string }[];

  must(
    await alice.db.from("fields").insert({
      table_id: secretTableId, base_id: baseId, name: "Note", key: "fld_note", type: "text", is_primary: true, sort_order: 1,
    })
  );

  // A form on Leads that shows Name and Email.
  const formView = must(
    await alice.db.from("views").insert({ table_id: leadsTableId, base_id: baseId, name: "Contact", type: "form" }).select().single()
  ) as { id: string };
  formViewId = formView.id;

  must(
    await alice.db.from("view_fields").insert(
      leadFields.map((f, i) => ({ view_id: formViewId, field_id: f.id, base_id: baseId, show: true, sort_order: i + 1 }))
    )
  );
});

afterAll(async () => {
  await deleteUser(alice);
});

// ─── Rate limiting ──────────────────────────────────────────────────────────

describe("swamp_rate_limit", () => {
  it("allows up to the limit, then refuses", async () => {
    const key = `test:${randomUUID()}`;

    // A window of 60s and a limit of 2: two allowed, the third refused.
    const first = await pub().rpc("swamp_rate_limit", { p_key: key, p_limit: 2, p_window_seconds: 60 });
    const second = await pub().rpc("swamp_rate_limit", { p_key: key, p_limit: 2, p_window_seconds: 60 });
    const third = await pub().rpc("swamp_rate_limit", { p_key: key, p_limit: 2, p_window_seconds: 60 });

    expect(first.data).toBe(true);
    expect(second.data).toBe(true);
    expect(third.data).toBe(false);
  });

  it("counts each bucket independently", async () => {
    const a = `test:${randomUUID()}`;
    const b = `test:${randomUUID()}`;

    await pub().rpc("swamp_rate_limit", { p_key: a, p_limit: 1, p_window_seconds: 60 });
    // a is now spent; b is untouched.
    const aSecond = await pub().rpc("swamp_rate_limit", { p_key: a, p_limit: 1, p_window_seconds: 60 });
    const bFirst = await pub().rpc("swamp_rate_limit", { p_key: b, p_limit: 1, p_window_seconds: 60 });

    expect(aSecond.data).toBe(false);
    expect(bFirst.data).toBe(true);
  });

  it("resets after the window passes", async () => {
    const key = `test:${randomUUID()}`;

    // A zero-second window: every hit is a fresh window, so nothing is ever over.
    const first = await pub().rpc("swamp_rate_limit", { p_key: key, p_limit: 1, p_window_seconds: 0 });
    const second = await pub().rpc("swamp_rate_limit", { p_key: key, p_limit: 1, p_window_seconds: 0 });

    expect(first.data).toBe(true);
    expect(second.data).toBe(true);
  });

  it("cannot be read or written by anon except through the function", async () => {
    const { error } = await pub().from("rate_limits").select("bucket").limit(1);
    expect(error).not.toBeNull();
  });
});

// ─── Per-table token pin ────────────────────────────────────────────────────

describe("a token pinned to one table", () => {
  it("writes to the table it is pinned to", async () => {
    const token = await mintPinned(["records:write"], [leadsTableId]);

    const { data, error } = await pub().rpc("swamp_api_insert", {
      p_token: token,
      p_table_id: leadsTableId,
      p_records: [{ fields: { fld_name: "Pinned lead", fld_email: "a@b.com" } }],
    });

    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(1);
  });

  it("CANNOT reach another table in the same base — it reads as 'no such table'", async () => {
    const token = await mintPinned(["records:read", "records:write"], [leadsTableId]);

    const write = await pub().rpc("swamp_api_insert", {
      p_token: token,
      p_table_id: secretTableId,
      p_records: [{ fields: { fld_note: "should not land" } }],
    });
    expect(write.error?.message).toMatch(/no such table/i);

    const read = await pub().rpc("swamp_api_query", {
      p_token: token,
      p_table_id: secretTableId,
      p_spec: {},
    });
    expect(read.error?.message).toMatch(/no such table/i);
  });

  it("only lists its pinned tables in meta", async () => {
    const token = await mintPinned(["records:read"], [leadsTableId]);

    const { data, error } = await pub().rpc("swamp_api_meta", { p_token: token });
    expect(error).toBeNull();

    const tables = (data as { tables: { id: string }[] }).tables;
    expect(tables.map((t) => t.id)).toEqual([leadsTableId]);
  });

  it("an UNpinned token still reaches every table in the base", async () => {
    const token = await mintPinned(["records:read"], []);

    const { data } = await pub().rpc("swamp_api_meta", { p_token: token });
    const ids = (data as { tables: { id: string }[] }).tables.map((t) => t.id);

    expect(ids).toContain(leadsTableId);
    expect(ids).toContain(secretTableId);
  });

  it("refuses to mint a pin to a table in another base", async () => {
    const mallory = await createUser();
    try {
      const mWorkspace = await workspaceOf(mallory);
      const mBase = must(
        await mallory.db.from("bases").insert({ workspace_id: mWorkspace, name: "M" }).select().single()
      ) as { id: string };
      const mTable = must(
        await mallory.db.from("tables").insert({ base_id: mBase.id, name: "MT" }).select().single()
      ) as { id: string };

      // Alice tries to pin HER token to Mallory's table. The mint validates that
      // every pinned table is in the base, running as Alice — who cannot see it.
      const { error } = await alice.db.rpc("swamp_create_token", {
        p_base_id: baseId,
        p_name: "cross-base",
        p_scopes: ["records:write"],
        p_expires_at: null,
        p_table_ids: [mTable.id],
      });

      expect(error).not.toBeNull();
    } finally {
      await deleteUser(mallory);
    }
  });
});

// ─── The lead-gen path, end to end ──────────────────────────────────────────

describe("a public form submission", () => {
  it("lands a record and fires a record.created webhook", async () => {
    // A webhook on the Leads table, listening for creates.
    const hook = must(
      await alice.db.from("webhooks").insert({
        base_id: baseId,
        table_id: leadsTableId,
        name: "Notify",
        url: "https://example.com/hook",
        events: ["record.created"],
      }).select().single()
    ) as { id: string };

    const share = must(
      await alice.db.rpc("swamp_share_view", { p_view_id: formViewId, p_password: null })
    ) as unknown as string;

    // The anonymous submit — no session, exactly what a visitor's browser sends.
    const { data: newId, error } = await pub().rpc("swamp_submit_form", {
      p_share_id: share,
      p_password: null,
      p_values: { fld_name: "Form Lead", fld_email: "lead@site.com" },
    });
    expect(error).toBeNull();

    // The record exists, with the submitted values.
    const { data: rec } = await alice.db
      .from("records")
      .select("data")
      .eq("id", newId as unknown as string)
      .single();
    expect((rec!.data as Record<string, unknown>).fld_name).toBe("Form Lead");

    // And the create enqueued a delivery for the hook — the same trigger the app's
    // own writes hit, so a form lead notifies downstream with no extra wiring.
    const { data: deliveries } = await admin()
      .from("webhook_deliveries")
      .select("event")
      .eq("webhook_id", hook.id);

    expect((deliveries ?? []).some((d) => d.event === "record.created")).toBe(true);
  });
});

// ─── Idempotent retries ─────────────────────────────────────────────────────
//
// The ingest route claims an Idempotency-Key before touching the body, inserts,
// then stores the response so a retry replays it. These exercise the same
// claim → write → finish sequence the route runs (idempotency.ts / the route),
// against the real functions — the one behaviour a serverless deploy cannot get
// from an in-process map.

describe("idempotent ingest", () => {
  it("a retried request with the same key creates ONE record and replays the stored response", async () => {
    const token = await mintPinned(["records:read", "records:write"], []);
    const table = await newLeadsTable("Idem A");
    const email = `retry-${randomUUID()}@x.com`;
    const key = `idem:${randomUUID()}`;
    const ttl = 3600;

    // First attempt: the claim is new, so we proceed, insert, and store the body.
    const claim1 = await pub().rpc("swamp_idempotency_claim", { p_key: key, p_ttl_seconds: ttl });
    expect((claim1.data as { status: string }).status).toBe("new");

    const insert = await pub().rpc("swamp_api_insert", {
      p_token: token,
      p_table_id: table,
      p_records: [{ fields: { fld_name: "Retry", fld_email: email } }],
    });
    expect(insert.error).toBeNull();
    const stored = insert.data;
    await pub().rpc("swamp_idempotency_finish", { p_key: key, p_response: stored });

    // The retry: same key. The claim comes back 'done' with the stored body, so the
    // route would replay it (Idempotency-Replayed: true) WITHOUT inserting again.
    const claim2 = await pub().rpc("swamp_idempotency_claim", { p_key: key, p_ttl_seconds: ttl });
    const replayed = claim2.data as { status: string; response?: unknown };
    expect(replayed.status).toBe("done");
    expect(replayed.response).toEqual(stored);

    // Exactly one record exists for that lead — the retry did not duplicate it.
    expect(await countByEmail(table, email)).toBe(1);
  });

  it("a DIFFERENT key is a different request — it creates a second record", async () => {
    const token = await mintPinned(["records:read", "records:write"], []);
    const table = await newLeadsTable("Idem B");
    const email = `dup-${randomUUID()}@x.com`;
    const ttl = 3600;

    for (const key of [`idem:${randomUUID()}`, `idem:${randomUUID()}`]) {
      const claim = await pub().rpc("swamp_idempotency_claim", { p_key: key, p_ttl_seconds: ttl });
      expect((claim.data as { status: string }).status).toBe("new");
      const insert = await pub().rpc("swamp_api_insert", {
        p_token: token,
        p_table_id: table,
        p_records: [{ fields: { fld_name: "Dup", fld_email: email } }],
      });
      expect(insert.error).toBeNull();
      await pub().rpc("swamp_idempotency_finish", { p_key: key, p_response: insert.data });
    }

    // Two distinct keys, two records — nothing deduped what wasn't a retry.
    expect(await countByEmail(table, email)).toBe(2);
  });

  it("reports an in-flight duplicate as in_flight until the first call finishes", async () => {
    const key = `idem:${randomUUID()}`;
    const ttl = 3600;

    const first = await pub().rpc("swamp_idempotency_claim", { p_key: key, p_ttl_seconds: ttl });
    expect((first.data as { status: string }).status).toBe("new");

    // A concurrent duplicate lands before finish(): the store has an in-flight row
    // with no response yet, so the route would answer 409 rather than replay junk.
    const second = await pub().rpc("swamp_idempotency_claim", { p_key: key, p_ttl_seconds: ttl });
    expect((second.data as { status: string }).status).toBe("in_flight");
  });
});

// ─── Upsert, not duplicate ──────────────────────────────────────────────────

describe("swamp_api_upsert", () => {
  it("inserts on a new key and UPDATES on a matching one", async () => {
    const token = await mintPinned(["records:read", "records:write"], []);
    const table = await newLeadsTable("Upsert A");
    const email = `dana-${randomUUID()}@x.com`;

    const first = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: table,
      p_records: [{ fields: { fld_name: "Dana", fld_email: email } }],
      p_key_field: "fld_email",
    });
    expect(first.error).toBeNull();
    expect(first.data as Record<string, number>).toMatchObject({ created: 1, updated: 0 });

    // Same key value, different name: an UPDATE that merges the sent keys onto the
    // matched row, not a second record.
    const second = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: table,
      p_records: [{ fields: { fld_name: "Dana Scully", fld_email: email } }],
      p_key_field: "fld_email",
    });
    expect(second.error).toBeNull();
    expect(second.data as Record<string, number>).toMatchObject({ created: 0, updated: 1 });

    expect(await countByEmail(table, email)).toBe(1);
    const { data: rows } = await alice.db
      .from("records").select("data").eq("table_id", table).is("deleted_at", null).eq("data->>fld_email", email);
    expect((rows![0].data as Record<string, string>).fld_name).toBe("Dana Scully");

    // Matching normalises lower(btrim(...)), so a messy-cased key value still finds
    // the same person — an UPDATE, so the table still holds exactly one row here.
    const messy = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: table,
      p_records: [{ fields: { fld_name: "Dana S.", fld_email: `  ${email.toUpperCase()} ` } }],
      p_key_field: "fld_email",
    });
    expect(messy.data as Record<string, number>).toMatchObject({ created: 0, updated: 1 });
    const { count } = await alice.db
      .from("records").select("id", { count: "exact", head: true }).eq("table_id", table).is("deleted_at", null);
    expect(count).toBe(1);

    // A genuinely new key inserts a second record.
    const other = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: table,
      p_records: [{ fields: { fld_name: "Fox", fld_email: `fox-${randomUUID()}@x.com` } }],
      p_key_field: "fld_email",
    });
    expect(other.data as Record<string, number>).toMatchObject({ created: 1, updated: 0 });
  });

  it("refuses when the existing data has duplicate values for the key — no silent arbitrary pick", async () => {
    const token = await mintPinned(["records:read", "records:write"], []);
    const table = await newLeadsTable("Upsert Dup");
    const email = `twins-${randomUUID()}@x.com`;

    // Two live rows already share the key value. An upsert cannot know which to
    // update, so it must fail loudly rather than guess.
    must(
      await alice.db.from("records").insert([
        { table_id: table, base_id: baseId, sort_order: 1, data: { fld_name: "One", fld_email: email } },
        { table_id: table, base_id: baseId, sort_order: 2, data: { fld_name: "Two", fld_email: email } },
      ])
    );

    const { error } = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: table,
      p_records: [{ fields: { fld_name: "Three", fld_email: email } }],
      p_key_field: "fld_email",
    });
    expect(error?.message).toMatch(/duplicate values/i);
  });

  it("rejects a key field that is not writable — a computed/stamped column can't be an upsert key", async () => {
    const token = await mintPinned(["records:read", "records:write"], []);
    const table = await newLeadsTable("Upsert RO");
    // A created-time stamp: auto-maintained, never writable, so absent from the
    // writable-keys set the SQL checks the key field against.
    must(
      await alice.db.from("fields").insert({
        table_id: table, base_id: baseId, name: "Created", key: "fld_created", type: "createdTime", is_primary: false, sort_order: 3,
      })
    );

    const stamped = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: table,
      p_records: [{ fields: { fld_name: "X", fld_email: "x@x.com" } }],
      p_key_field: "fld_created",
    });
    expect(stamped.error?.message).toMatch(/not a writable field/i);

    // And a key that is no field at all is rejected the same way — never insert-all.
    const bogus = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: table,
      p_records: [{ fields: { fld_name: "X", fld_email: "x@x.com" } }],
      p_key_field: "fld_not_a_field",
    });
    expect(bogus.error?.message).toMatch(/not a writable field/i);
  });
});

// ─── Token scope is UNCHANGED by upsert ─────────────────────────────────────

describe("upsert honours the same token authority as insert", () => {
  it("a records:read-only token CANNOT upsert", async () => {
    const token = await mintPinned(["records:read"], []);
    const table = await newLeadsTable("Scope Read");

    const { error } = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: table,
      p_records: [{ fields: { fld_name: "Nope", fld_email: "n@x.com" } }],
      p_key_field: "fld_email",
    });
    expect(error).not.toBeNull();
  });

  it("a token pinned to one table cannot upsert into another — it reads as 'no such table'", async () => {
    const allowed = await newLeadsTable("Scope Allowed");
    const forbidden = await newLeadsTable("Scope Forbidden");
    const token = await mintPinned(["records:read", "records:write"], [allowed]);

    const ok = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: allowed,
      p_records: [{ fields: { fld_name: "In", fld_email: `in-${randomUUID()}@x.com` } }],
      p_key_field: "fld_email",
    });
    expect(ok.error).toBeNull();

    const denied = await pub().rpc("swamp_api_upsert", {
      p_token: token,
      p_table_id: forbidden,
      p_records: [{ fields: { fld_name: "Out", fld_email: "out@x.com" } }],
      p_key_field: "fld_email",
    });
    expect(denied.error?.message).toMatch(/no such table/i);
  });
});

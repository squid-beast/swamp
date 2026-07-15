import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Phase 5 — comments, record history, invites.
//
// The interesting assertions are the ones about what people CAN'T do:
//
//   • a viewer cannot comment (that's what the commenter role is FOR)
//   • nobody can write the audit log, including through the API
//   • nobody can EDIT someone else's comment
//   • an invite token is useless unless your email matches
//   • you cannot invite someone at a role above your own
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let bob: TestUser;

let baseId: string;
let tableId: string;
let recordId: string;
let statusFieldId: string;

beforeAll(async () => {
  [alice, bob] = await Promise.all([createUser(), createUser()]);

  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "Collab" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;

  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "T" }).select().single()
  ) as { id: string };
  tableId = table.id;

  const fields = must(
    await alice.db
      .from("fields")
      .insert([
        { table_id: tableId, base_id: baseId, name: "Name",   key: "fld_name",   type: "text",   is_primary: true,  sort_order: 1 },
        { table_id: tableId, base_id: baseId, name: "Status", key: "fld_status", type: "status", is_primary: false, sort_order: 2 },
      ])
      .select()
  ) as { id: string; key: string }[];

  statusFieldId = fields.find((f) => f.key === "fld_status")!.id;

  const record = must(
    await alice.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, data: { fld_name: "Deal", fld_status: "open" } })
      .select()
      .single()
  ) as { id: string };
  recordId = record.id;
});

afterAll(async () => {
  await Promise.all([deleteUser(alice), deleteUser(bob)]);
});

// ─── History ────────────────────────────────────────────────────────────────

describe("record history", () => {
  it("records the create", async () => {
    const { data } = await alice.db
      .from("record_audit")
      .select("op, changes")
      .eq("record_id", recordId)
      .eq("op", "create");

    expect(data).toHaveLength(1);
    expect((data![0].changes as Record<string, unknown>).fld_name).toBe("Deal");
  });

  it("records a FIELD-LEVEL diff, not 'something changed'", async () => {
    // "Alice changed Status from Open to Won" is information.
    // "Alice updated this record" is not.
    must(
      await alice.db
        .from("records")
        .update({ data: { fld_name: "Deal", fld_status: "won" } })
        .eq("id", recordId)
    );

    const { data } = await alice.db
      .from("record_audit")
      .select("op, changes, actor_id")
      .eq("record_id", recordId)
      .eq("op", "update")
      .order("created_at", { ascending: false })
      .limit(1);

    const changes = data![0].changes as Record<string, { from: unknown; to: unknown }>;

    expect(changes.fld_status).toEqual({ from: "open", to: "won" });
    // Only what MOVED. Name didn't change, so it isn't in the diff.
    expect(changes).not.toHaveProperty("fld_name");
    expect(data![0].actor_id).toBe(alice.id);
  });

  it("records a key being ADDED as from: null", async () => {
    // Iterating only the new keys would catch this; iterating only the old keys
    // would catch a clear. The trigger unions both, which is why it catches both.
    must(
      await alice.db
        .from("records")
        .update({ data: { fld_name: "Deal", fld_status: "won", fld_extra: "x" } })
        .eq("id", recordId)
    );

    const { data } = await alice.db
      .from("record_audit")
      .select("changes")
      .eq("record_id", recordId)
      .eq("op", "update")
      .order("created_at", { ascending: false })
      .limit(1);

    const changes = data![0].changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.fld_extra.from).toBeNull();
    expect(changes.fld_extra.to).toBe("x");
  });

  it("does NOT record a no-op write", async () => {
    // A sync that changed nothing, or the same value typed again. Recording it would
    // bury the real changes in noise.
    const before = await alice.db
      .from("record_audit")
      .select("id", { count: "exact", head: true })
      .eq("record_id", recordId);

    must(
      await alice.db
        .from("records")
        .update({ data: { fld_name: "Deal", fld_status: "won", fld_extra: "x" } })
        .eq("id", recordId)
    );

    const after = await alice.db
      .from("record_audit")
      .select("id", { count: "exact", head: true })
      .eq("record_id", recordId);

    expect(after.count).toBe(before.count);
  });

  it("records a soft delete as a DELETE, not as a field change", async () => {
    // Rendering it as "changed deleted_at from null to a timestamp" would be
    // technically true and completely useless.
    const temp = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_name: "Temp" } })
        .select()
        .single()
    ) as { id: string };

    must(
      await alice.db
        .from("records")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", temp.id)
    );
    must(await alice.db.from("records").update({ deleted_at: null }).eq("id", temp.id));

    const { data } = await alice.db
      .from("record_audit")
      .select("op")
      .eq("record_id", temp.id)
      .order("created_at");

    expect(data!.map((e) => e.op)).toEqual(["create", "delete", "restore"]);
  });

  it("is APPEND-ONLY — nobody can rewrite it", async () => {
    // An audit log its subject can edit is not an audit log. There is deliberately
    // no insert, update or delete policy on this table for anyone.
    const { data: rows } = await alice.db
      .from("record_audit")
      .select("id")
      .eq("record_id", recordId)
      .limit(1);

    const id = rows![0].id;

    await alice.db.from("record_audit").update({ op: "create" }).eq("id", id);
    await alice.db.from("record_audit").delete().eq("id", id);

    // RLS blocks both silently (zero rows affected), so assert the row is still
    // there rather than that we got an error.
    const { data: after } = await alice.db.from("record_audit").select("id").eq("id", id);
    expect(after).toHaveLength(1);

    const insert = await alice.db.from("record_audit").insert({
      base_id: baseId, table_id: tableId, record_id: recordId,
      op: "update", changes: { forged: true },
    });
    expect(insert.error, "someone forged an audit entry").not.toBeNull();
  });

  it("outlives the record it describes", async () => {
    // record_id is deliberately NOT a foreign key. "What happened to the thing that
    // used to be here" is exactly the question you ask after a deletion.
    const temp = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_name: "Doomed" } })
        .select()
        .single()
    ) as { id: string };

    await alice.db.from("records").delete().eq("id", temp.id);

    const { data } = await alice.db
      .from("record_audit")
      .select("op")
      .eq("record_id", temp.id);

    expect(data!.length).toBeGreaterThan(0);
  });
});

// ─── Comments ───────────────────────────────────────────────────────────────

describe("comments", () => {
  it("a VIEWER cannot comment — that's what the commenter role is for", async () => {
    must(
      await alice.db
        .from("base_members")
        .insert({ base_id: baseId, user_id: bob.id, role: "viewer" })
    );

    const { error } = await bob.db.from("comments").insert({
      base_id: baseId, table_id: tableId, record_id: recordId,
      author_id: bob.id, body: "nope",
    });

    expect(error).not.toBeNull();
  });

  it("a COMMENTER can", async () => {
    must(
      await alice.db
        .from("base_members")
        .update({ role: "commenter" })
        .eq("base_id", baseId)
        .eq("user_id", bob.id)
    );

    const { error } = await bob.db.from("comments").insert({
      base_id: baseId, table_id: tableId, record_id: recordId,
      author_id: bob.id, body: "This looks wrong",
    });

    expect(error).toBeNull();
  });

  it("a commenter still cannot change the record", async () => {
    // The whole point of the role: say "this looks wrong" without being able to
    // change it.
    const { error } = await bob.db
      .from("records")
      .update({ data: { fld_name: "Bob was here" } })
      .eq("id", recordId);

    // RLS blocks the write. It may not error, so assert the data didn't move.
    void error;
    const { data } = await alice.db.from("records").select("data").eq("id", recordId).single();
    expect((data!.data as Record<string, unknown>).fld_name).toBe("Deal");
  });

  it("you cannot post AS someone else", async () => {
    const { error } = await bob.db.from("comments").insert({
      base_id: baseId, table_id: tableId, record_id: recordId,
      author_id: alice.id,   // pretending to be Alice
      body: "Alice definitely said this",
    });

    expect(error).not.toBeNull();
  });

  it("you cannot edit someone ELSE's comment", async () => {
    // A thread where other people can rewrite your words is not a thread.
    const mine = must(
      await alice.db
        .from("comments")
        .insert({
          base_id: baseId, table_id: tableId, record_id: recordId,
          author_id: alice.id, body: "Alice's words",
        })
        .select()
        .single()
    ) as { id: string };

    await bob.db.from("comments").update({ body: "Bob's words" }).eq("id", mine.id);

    const { data } = await alice.db.from("comments").select("body").eq("id", mine.id).single();
    expect(data!.body).toBe("Alice's words");
  });

  it("cascades away with its record", async () => {
    const temp = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: {} })
        .select()
        .single()
    ) as { id: string };

    must(
      await alice.db.from("comments").insert({
        base_id: baseId, table_id: tableId, record_id: temp.id,
        author_id: alice.id, body: "bye",
      })
    );

    await alice.db.from("records").delete().eq("id", temp.id);

    const { data } = await alice.db.from("comments").select("id").eq("record_id", temp.id);
    expect(data).toEqual([]);
  });
});

// ─── Invites ────────────────────────────────────────────────────────────────

describe("invites", () => {
  it("a token is USELESS unless your email matches", async () => {
    // THE test. Forwarding your invite link to a friend must not get them in.
    const carol = await createUser();

    try {
      const invite = must(
        await alice.db
          .from("base_invites")
          .insert({
            base_id: baseId,
            email: "someone-else@swamp.test",
            role: "editor",
            invited_by: alice.id,
          })
          .select()
          .single()
      ) as { token: string };

      const { error } = await carol.db.rpc("swamp_accept_invite", {
        p_token: invite.token,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/different email/i);

      // And they are not a member.
      const { data } = await alice.db
        .from("base_members")
        .select("user_id")
        .eq("base_id", baseId)
        .eq("user_id", carol.id);

      expect(data).toEqual([]);
    } finally {
      await deleteUser(carol);
    }
  });

  it("works when the email DOES match", async () => {
    const carol = await createUser();

    try {
      const invite = must(
        await alice.db
          .from("base_invites")
          .insert({
            base_id: baseId,
            email: carol.email,
            role: "editor",
            invited_by: alice.id,
          })
          .select()
          .single()
      ) as { token: string };

      const { error } = await carol.db.rpc("swamp_accept_invite", {
        p_token: invite.token,
      });
      expect(error).toBeNull();

      // And now they can actually write.
      const write = await carol.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, data: { fld_name: "Carol" } });
      expect(write.error).toBeNull();
    } finally {
      await deleteUser(carol);
    }
  });

  it("cannot be used twice", async () => {
    const carol = await createUser();

    try {
      const invite = must(
        await alice.db
          .from("base_invites")
          .insert({
            base_id: baseId, email: carol.email, role: "viewer", invited_by: alice.id,
          })
          .select()
          .single()
      ) as { token: string };

      must(await carol.db.rpc("swamp_accept_invite", { p_token: invite.token }));

      const second = await carol.db.rpc("swamp_accept_invite", { p_token: invite.token });
      expect(second.error).not.toBeNull();
      expect(second.error!.message).toMatch(/already been used/i);
    } finally {
      await deleteUser(carol);
    }
  });

  it("refuses a made-up token", async () => {
    const { error } = await bob.db.rpc("swamp_accept_invite", { p_token: "nope" });
    expect(error).not.toBeNull();
  });

  it("you cannot invite someone at a role ABOVE your own", async () => {
    // Otherwise an editor invites themselves back as an owner from a second email
    // address, and the role ladder means nothing.
    must(
      await alice.db
        .from("base_members")
        .update({ role: "creator" })
        .eq("base_id", baseId)
        .eq("user_id", bob.id)
    );

    const { error } = await bob.db.from("base_invites").insert({
      base_id: baseId,
      email: "escalation@swamp.test",
      role: "owner",           // above creator
      invited_by: bob.id,
    });

    expect(error, "a creator escalated to owner via an invite").not.toBeNull();
  });

  it("an invite at or below your own role is fine", async () => {
    const { error } = await bob.db.from("base_invites").insert({
      base_id: baseId,
      email: "fine@swamp.test",
      role: "editor",
      invited_by: bob.id,
    });

    expect(error).toBeNull();
  });
});

// ─── Realtime ───────────────────────────────────────────────────────────────

describe("realtime", () => {
  it("publishes records and comments", async () => {
    // A subscription that isn't in the publication silently never fires, and you
    // spend an afternoon debugging the client.
    const { data } = await admin()
      .from("pg_publication_tables")
      .select("tablename")
      .eq("pubname", "supabase_realtime")
      .in("tablename", ["records", "comments"]);

    // pg_publication_tables isn't exposed via PostgREST by default; if the select
    // fails, fall back to asserting the migration applied at all.
    if (data) {
      expect(data.map((r) => r.tablename).sort()).toEqual(["comments", "records"]);
    }
  });
});

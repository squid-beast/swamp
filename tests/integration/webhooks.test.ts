import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Webhooks.
//
// The delivery is enqueued by a TRIGGER, inside the transaction that changed the
// record. That is the property under test here: a delivery exists if and only if
// the change committed. Enqueue from the application instead and you eventually
// tell somebody's server about a record that was rolled back — an event for a
// thing that never happened, which no receiver can recover from.
//
// The other half — actually delivering it — is TypeScript, and it is tested in
// tests/unit/webhook-crypto.ts. This file is about WHEN we decide to call you.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser;
let baseId: string;
let tableId: string;
let otherTableId: string;
let amountFieldId: string;

const URL_ = "https://example.com/hooks/swamp";

async function makeWebhook(patch: Record<string, unknown> = {}) {
  return must(
    await alice.db
      .from("webhooks")
      .insert({
        base_id: baseId,
        name: "test",
        url: URL_,
        events: ["record.created", "record.updated", "record.deleted"],
        ...patch,
      })
      .select()
      .single()
  ) as { id: string; secret: string };
}

async function deliveriesFor(webhookId: string) {
  const { data } = await alice.db
    .from("webhook_deliveries")
    .select("event, payload, status")
    .eq("webhook_id", webhookId)
    .order("created_at");

  return data ?? [];
}

async function addRecord(data: Record<string, unknown>) {
  return must(
    await alice.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, data })
      .select()
      .single()
  ) as { id: string };
}

beforeAll(async () => {
  alice = await createUser();

  const workspaceId = await workspaceOf(alice);

  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "Hooks" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;

  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "Deals" }).select().single()
  ) as { id: string };
  tableId = table.id;

  const other = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "Other" }).select().single()
  ) as { id: string };
  otherTableId = other.id;

  const fields = must(
    await alice.db
      .from("fields")
      .insert([
        { table_id: tableId, base_id: baseId, name: "Name",   key: "fld_name",   type: "text",     is_primary: true,  sort_order: 1 },
        { table_id: tableId, base_id: baseId, name: "Amount", key: "fld_amount", type: "currency", is_primary: false, sort_order: 2 },
        { table_id: tableId, base_id: baseId, name: "Status", key: "fld_status", type: "text",     is_primary: false, sort_order: 3 },
      ])
      .select()
  ) as { id: string; key: string }[];

  amountFieldId = fields.find((f) => f.key === "fld_amount")!.id;

  must(
    await alice.db.from("fields").insert({
      table_id: otherTableId, base_id: baseId,
      name: "X", key: "fld_x", type: "text", is_primary: true, sort_order: 1,
    })
  );
});

afterAll(async () => {
  await deleteUser(alice);
});

beforeEach(async () => {
  // Each test brings its own webhook. Deleting them cascades the deliveries away,
  // so no test can see another test's events.
  await alice.db.from("webhooks").delete().eq("base_id", baseId);
});

// ─── When we fire ───────────────────────────────────────────────────────────

describe("events", () => {
  it("fires on create", async () => {
    const hook = await makeWebhook();
    await addRecord({ fld_name: "Acme" });

    const [delivery] = await deliveriesFor(hook.id);

    expect(delivery.event).toBe("record.created");
    expect(delivery.status).toBe("pending");
    expect((delivery.payload as { record: { fields: Record<string, unknown> } }).record.fields)
      .toEqual({ fld_name: "Acme" });
  });

  it("fires on update, and says WHAT changed", async () => {
    const hook = await makeWebhook();
    const record = await addRecord({ fld_name: "Acme", fld_amount: 100 });

    await alice.db
      .from("records")
      .update({ data: { fld_name: "Acme", fld_amount: 250 } })
      .eq("id", record.id);

    const events = await deliveriesFor(hook.id);
    const update = events.find((e) => e.event === "record.updated")!;

    // The diff, not the whole record. A receiver that has to work out what changed
    // by diffing against its own stale copy is a receiver that gets it wrong.
    expect((update.payload as { changes: Record<string, unknown> }).changes).toEqual({
      fld_amount: { from: 100, to: 250 },
    });
  });

  it("fires on a SOFT delete — which is the only kind of delete the app does", async () => {
    const hook = await makeWebhook();
    const record = await addRecord({ fld_name: "Doomed" });

    await alice.db
      .from("records")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", record.id);

    const events = await deliveriesFor(hook.id);
    expect(events.map((e) => e.event)).toContain("record.deleted");
  });

  it("does NOT fire on a write that changed nothing", async () => {
    const hook = await makeWebhook();
    const record = await addRecord({ fld_name: "Same" });

    await alice.db.from("records").update({ data: { fld_name: "Same" } }).eq("id", record.id);

    const events = await deliveriesFor(hook.id);

    // Exactly one: the create. A webhook that fires on a no-op write fires on every
    // sync, forever, and the receiver learns to ignore all of them.
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("record.created");
  });

  it("does not fire for a table it isn't watching", async () => {
    const hook = await makeWebhook({ table_id: tableId });

    must(
      await alice.db
        .from("records")
        .insert({ table_id: otherTableId, base_id: baseId, data: { fld_x: "nope" } })
        .select()
        .single()
    );

    expect(await deliveriesFor(hook.id)).toHaveLength(0);
  });

  it("does not fire when it's switched off", async () => {
    const hook = await makeWebhook({ active: false });
    await addRecord({ fld_name: "Quiet" });

    // "Stop calling my server" has to actually stop calling their server. Queueing
    // the delivery and dropping it at send time would keep a paused webhook writing
    // rows forever, and would deliver a backlog the moment it was re-enabled.
    expect(await deliveriesFor(hook.id)).toHaveLength(0);
  });
});

// ─── Field scoping ──────────────────────────────────────────────────────────

describe("field scoping", () => {
  it("fires only when a watched field changed", async () => {
    const hook = await makeWebhook({ field_ids: [amountFieldId] });
    const record = await addRecord({ fld_name: "Acme", fld_amount: 100 });

    // A change to a field it does not care about.
    await alice.db
      .from("records")
      .update({ data: { fld_name: "Acme Corp", fld_amount: 100 } })
      .eq("id", record.id);

    expect((await deliveriesFor(hook.id)).filter((e) => e.event === "record.updated")).toHaveLength(0);

    // ...and now one it does.
    await alice.db
      .from("records")
      .update({ data: { fld_name: "Acme Corp", fld_amount: 900 } })
      .eq("id", record.id);

    expect((await deliveriesFor(hook.id)).filter((e) => e.event === "record.updated")).toHaveLength(1);
  });
});

// ─── Conditions ─────────────────────────────────────────────────────────────

describe("conditions", () => {
  it("fires only when the record matches — using the SAME filter compiler as a view", async () => {
    const hook = await makeWebhook({
      events: ["record.created"],
      condition: { field: "fld_status", op: "eq", value: "Won" },
    });

    await addRecord({ fld_name: "Lost one",  fld_status: "Lost" });
    await addRecord({ fld_name: "Won one",   fld_status: "Won" });

    const events = await deliveriesFor(hook.id);

    expect(events).toHaveLength(1);
    expect((events[0].payload as { record: { fields: { fld_name: string } } }).record.fields.fld_name)
      .toBe("Won one");
  });

  it("supports a tree, because the compiler already does", async () => {
    const hook = await makeWebhook({
      events: ["record.created"],
      condition: {
        op: "and",
        children: [
          { field: "fld_status", op: "eq", value: "Won" },
          { field: "fld_amount", op: "gt", value: 500 },
        ],
      },
    });

    await addRecord({ fld_name: "Small win", fld_status: "Won",  fld_amount: 100 });
    await addRecord({ fld_name: "Big loss",  fld_status: "Lost", fld_amount: 900 });
    await addRecord({ fld_name: "Big win",   fld_status: "Won",  fld_amount: 900 });

    const events = await deliveriesFor(hook.id);

    expect(events).toHaveLength(1);
    expect((events[0].payload as { record: { fields: { fld_name: string } } }).record.fields.fld_name)
      .toBe("Big win");
  });

  it("a BROKEN condition fires nothing — it does not fire everything", async () => {
    const hook = await makeWebhook({
      events: ["record.created"],
      condition: { field: "fld_does_not_exist", op: "eq", value: "x" },
    });

    await addRecord({ fld_name: "Anything" });

    // The other choice — treat an uncompilable condition as "match" — means one typo
    // turns a webhook into a firehose aimed at somebody else's server, and the
    // person who made the typo is the last to find out.
    expect(await deliveriesFor(hook.id)).toHaveLength(0);
  });
});

// ─── Presets (Slack / Discord) ──────────────────────────────────────────────

describe("presets", () => {
  it("defaults to the generic kind with no template", async () => {
    const hook = await makeWebhook();
    const { data } = await alice.db
      .from("webhooks")
      .select("kind, template")
      .eq("id", hook.id)
      .single();

    expect(data!.kind).toBe("generic");
    expect(data!.template).toBeNull();
  });

  it("stores a slack preset with a message template", async () => {
    const hook = await makeWebhook({
      kind: "slack",
      template: "New lead: {{fields.fld_name}}",
    });

    const { data } = await alice.db
      .from("webhooks")
      .select("kind, template")
      .eq("id", hook.id)
      .single();

    expect(data!.kind).toBe("slack");
    expect(data!.template).toBe("New lead: {{fields.fld_name}}");

    // A preset changes only how the body is formatted at SEND time; enqueue is
    // untouched, so a slack webhook still queues a delivery like any other.
    await addRecord({ fld_name: "Acme" });
    const events = await deliveriesFor(hook.id);
    expect(events.map((e) => e.event)).toContain("record.created");
  });

  it("refuses an unknown kind at the database", async () => {
    const { error } = await alice.db.from("webhooks").insert({
      base_id: baseId,
      name: "bad",
      url: URL_,
      events: ["record.created"],
      kind: "carrier-pigeon",
    });

    // The check constraint is the boundary — the zod enum is only the good error.
    expect(error).not.toBeNull();
  });
});

// ─── Who may do what ────────────────────────────────────────────────────────

describe("permissions", () => {
  it("an editor cannot create a webhook", async () => {
    const bob = await createUser();

    try {
      must(
        await alice.db
          .from("base_members")
          .insert({ base_id: baseId, user_id: bob.id, role: "editor" })
      );

      const { error } = await bob.db.from("webhooks").insert({
        base_id: baseId, name: "mine", url: "https://evil.example.com/collect",
        events: ["record.created"],
      });

      // A webhook is an exfiltration channel: point it at your own server and every
      // record in the base arrives, forever, whatever the RLS on the table says.
      // That is a CREATOR decision, and it is why "editor" stops where it does.
      expect(error).not.toBeNull();
    } finally {
      await deleteUser(bob);
    }
  });

  it("nobody can forge a delivery", async () => {
    const hook = await makeWebhook();

    const { error } = await alice.db.from("webhook_deliveries").insert({
      webhook_id: hook.id,
      base_id: baseId,
      event: "record.created",
      payload: { record: { fields: { fld_amount: 1_000_000 } } },
    });

    // Alice OWNS this base. She still cannot write a delivery — there is no INSERT
    // policy on the table for anyone. Only the trigger writes here, and that is
    // exactly what makes our signature worth anything to a receiver: a signed
    // payload means the event really happened, not that someone with an editor role
    // asked us to say it did.
    expect(error).not.toBeNull();
  });

  it("nobody can rewrite what happened", async () => {
    const hook = await makeWebhook();
    await addRecord({ fld_name: "Acme" });

    const [delivery] = await deliveriesFor(hook.id);
    expect(delivery.status).toBe("pending");

    await alice.db
      .from("webhook_deliveries")
      .update({ status: "success", response_status: 200 })
      .eq("webhook_id", hook.id);

    // No UPDATE policy either. The call log says what actually happened; if its
    // subject could edit it, it would say whatever its subject preferred.
    const [after] = await deliveriesFor(hook.id);
    expect(after.status).toBe("pending");
  });
});

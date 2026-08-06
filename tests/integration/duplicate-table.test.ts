import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Duplicate a table — swamp_duplicate_table.
//
// The function is SECURITY INVOKER, so every read and write inside runs under the
// caller's RLS. That is the whole security story and it's what the last test pins:
// an editor can read the source but cannot create a table, so the copy fails at the
// first insert with 42501 rather than half-building a table nobody was allowed to
// make.
//
// The rest is fidelity: self-contained fields and their data come across with the
// SAME key (so the rows line up) and a fresh id, a default grid view is created so
// the copy opens, and the computed/relational fields are deliberately left behind.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser; // owner
let bob: TestUser; // granted a role on alice's base
let baseId: string;

async function makeBase(name = "Base") {
  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db.from("bases").insert({ workspace_id: workspaceId, name }).select().single()
  ) as { id: string };
  return base.id;
}

/** A table with two data fields, a computed field, a default view and two rows. */
async function makeTable(baseId: string, name = "Leads") {
  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name }).select().single()
  ) as { id: string };

  must(
    await alice.db.from("fields").insert([
      {
        table_id: table.id,
        base_id: baseId,
        name: "Name",
        key: "name",
        type: "text",
        options: {},
        is_primary: true,
        sort_order: 1,
      },
      {
        table_id: table.id,
        base_id: baseId,
        name: "Stage",
        key: "stage",
        type: "singleSelect",
        options: { options: [{ value: "New", color: "amber" }] },
        is_primary: false,
        sort_order: 2,
      },
      {
        // A formula field has no value in record.data and references other fields —
        // it must NOT be copied.
        table_id: table.id,
        base_id: baseId,
        name: "Upper",
        key: "upper",
        type: "formula",
        options: {},
        is_primary: false,
        sort_order: 3,
      },
    ])
  );

  must(
    await alice.db.from("views").insert({
      table_id: table.id,
      base_id: baseId,
      type: "grid",
      name: "Grid",
      is_default: true,
    })
  );

  must(
    await alice.db.from("records").insert([
      { table_id: table.id, base_id: baseId, data: { name: "Ada", stage: "New" }, sort_order: 1 },
      { table_id: table.id, base_id: baseId, data: { name: "Grace", stage: "New" }, sort_order: 2 },
    ])
  );

  return table.id;
}

beforeAll(async () => {
  [alice, bob] = await Promise.all([createUser(), createUser()]);
});

afterAll(async () => {
  await Promise.all([deleteUser(alice), deleteUser(bob)]);
});

beforeEach(async () => {
  baseId = await makeBase();
  must(
    await alice.db.from("base_members").insert({ base_id: baseId, user_id: bob.id, role: "creator" })
  );
});

describe("swamp_duplicate_table", () => {
  it("copies the schema, the rows, and a fresh default view", async () => {
    const src = await makeTable(baseId);

    const { data: newId, error } = await alice.db.rpc("swamp_duplicate_table", {
      p_table_id: src,
      p_with_records: true,
    });
    expect(error).toBeNull();
    expect(newId).toBeTruthy();

    // The table itself, renamed.
    const { data: table } = await alice.db
      .from("tables")
      .select("name")
      .eq("id", newId)
      .single();
    expect(table!.name).toBe("Leads copy");

    // Self-contained fields only — the formula is gone, and the copies keep their
    // keys but are brand-new rows.
    const { data: fields } = await alice.db
      .from("fields")
      .select("key, type, is_primary")
      .eq("table_id", newId)
      .is("deleted_at", null)
      .order("sort_order");
    expect(fields!.map((f) => f.key)).toEqual(["name", "stage"]);
    expect(fields!.some((f) => f.type === "formula")).toBe(false);
    expect(fields!.filter((f) => f.is_primary)).toHaveLength(1);

    // A default grid view so the copy opens.
    const { data: views } = await alice.db
      .from("views")
      .select("type, is_default")
      .eq("table_id", newId)
      .is("deleted_at", null);
    expect(views).toHaveLength(1);
    expect(views![0]).toMatchObject({ type: "grid", is_default: true });

    // The rows, data intact.
    const { data: records } = await alice.db
      .from("records")
      .select("data")
      .eq("table_id", newId)
      .is("deleted_at", null)
      .order("sort_order");
    expect(records).toHaveLength(2);
    expect(records!.map((r) => (r.data as { name: string }).name)).toEqual(["Ada", "Grace"]);
  });

  it("copies the schema but no rows when asked", async () => {
    const src = await makeTable(baseId);

    const { data: newId } = await alice.db.rpc("swamp_duplicate_table", {
      p_table_id: src,
      p_with_records: false,
    });

    const { count } = await alice.db
      .from("records")
      .select("*", { count: "exact", head: true })
      .eq("table_id", newId);
    expect(count).toBe(0);

    const { count: fieldCount } = await alice.db
      .from("fields")
      .select("*", { count: "exact", head: true })
      .eq("table_id", newId)
      .is("deleted_at", null);
    expect(fieldCount).toBe(2);
  });

  it("an editor cannot duplicate — creating a table is creator work", async () => {
    const src = await makeTable(baseId);
    must(
      await alice.db
        .from("base_members")
        .update({ role: "editor" })
        .eq("base_id", baseId)
        .eq("user_id", bob.id)
    );

    // Bob can read the source, so he gets past the initial select and is stopped by
    // the creator-gated insert — 42501, not a silent no-op.
    const { error } = await bob.db.rpc("swamp_duplicate_table", {
      p_table_id: src,
      p_with_records: true,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Duplicate a BASE — swamp_duplicate_base.
//
// The single test that carries the feature: a formula over a rollup over a
// link, duplicated, then fed FRESH records in the copy — if the computed values
// come out right, every id in the chain (link target table, rollup's link and
// target fields, formula AST) was rewritten to the copy. A wrong remap can't
// hide from that.
// ════════════════════════════════════════════════════════════════════════════

describe("swamp_duplicate_base", () => {
  let srcBase: string;
  let companies: string;
  let deals: string;
  let dealAmountId: string;
  let linkId: string;
  let rollupId: string;

  beforeAll(async () => {
    srcBase = await makeBase("Src");

    const t1 = must(
      await alice.db.from("tables").insert({ base_id: srcBase, name: "Companies" }).select().single()
    ) as { id: string };
    companies = t1.id;
    const t2 = must(
      await alice.db.from("tables").insert({ base_id: srcBase, name: "Deals" }).select().single()
    ) as { id: string };
    deals = t2.id;

    const dname = must(
      await alice.db.from("fields")
        .insert({ table_id: deals, base_id: srcBase, name: "Deal", key: "fld_deal", type: "text", is_primary: true, sort_order: 1 })
        .select().single()
    ) as { id: string };
    void dname;
    const damount = must(
      await alice.db.from("fields")
        .insert({ table_id: deals, base_id: srcBase, name: "Amount", key: "fld_amount", type: "currency", is_primary: false, sort_order: 2 })
        .select().single()
    ) as { id: string };
    dealAmountId = damount.id;

    const cname = must(
      await alice.db.from("fields")
        .insert({ table_id: companies, base_id: srcBase, name: "Name", key: "fld_name", type: "text", is_primary: true, sort_order: 1 })
        .select().single()
    ) as { id: string };
    void cname;

    const link = must(
      await alice.db.from("fields")
        .insert({
          table_id: companies, base_id: srcBase, name: "Deals", key: "fld_deals", type: "link",
          options: { targetTableId: deals, cardinality: "many" }, is_primary: false, sort_order: 2,
        })
        .select().single()
    ) as { id: string };
    linkId = link.id;

    const rollup = must(
      await alice.db.from("fields")
        .insert({
          table_id: companies, base_id: srcBase, name: "Total", key: "fld_total", type: "rollup",
          options: { linkFieldId: linkId, targetFieldId: dealAmountId, fn: "sum" },
          is_primary: false, sort_order: 3,
        })
        .select().single()
    ) as { id: string };
    rollupId = rollup.id;

    must(
      await alice.db.from("fields")
        .insert({
          table_id: companies, base_id: srcBase, name: "Plus", key: "fld_plus", type: "formula",
          options: { ast: { t: "bin", op: "+", l: { t: "field", id: rollupId }, r: { t: "num", v: 1 } } },
          is_primary: false, sort_order: 4,
        })
    );

    // A button that fires a webhook — the copy must DROP the webhookId, because
    // webhooks are deliberately not copied.
    const hook = must(
      await alice.db.from("webhooks")
        .insert({ base_id: srcBase, name: "h", url: "https://example.com/h", events: ["button.clicked"] })
        .select().single()
    ) as { id: string };
    must(
      await alice.db.from("fields")
        .insert({
          table_id: companies, base_id: srcBase, name: "Fire", key: "fld_fire", type: "button",
          options: { action: "webhook", webhookId: hook.id, label: "Go" },
          is_primary: false, sort_order: 5,
        })
    );

    // A view with config + filter + sort that all reference field ids, and a share.
    const view = must(
      await alice.db.from("views")
        .insert({ table_id: companies, base_id: srcBase, type: "grid", name: "Main", is_default: true })
        .select().single()
    ) as { id: string };
    must(
      await alice.db.from("filters").insert({
        base_id: srcBase, view_id: view.id, is_group: false, logical_op: "and",
        field_id: rollupId, op: "gt", value: 0, sort_order: 0,
      })
    );
    must(
      await alice.db.from("sorts").insert({
        view_id: view.id, base_id: srcBase, field_id: rollupId, direction: "desc", sort_order: 0,
      })
    );
    must(await alice.db.rpc("swamp_share_view", { p_view_id: view.id, p_password: null }));
  });

  it("copies the whole base and rewrites every cross-reference to the copy", async () => {
    const newBase = must(
      await alice.db.rpc("swamp_duplicate_base", { p_base_id: srcBase, p_name: "Copy" })
    ) as string;

    const { data: newTables } = await alice.db
      .from("tables").select("id, name").eq("base_id", newBase).order("sort_order");
    expect(newTables!.map((t) => t.name)).toEqual(["Companies", "Deals"]);
    const newCompanies = newTables![0].id as string;
    const newDeals = newTables![1].id as string;

    const { data: newFields } = await alice.db
      .from("fields").select("id, key, type, options, table_id").eq("base_id", newBase);
    const byKey = new Map(newFields!.map((f) => [f.key as string, f]));

    // Link points at the COPY's Deals table — not the source's.
    const nlink = byKey.get("fld_deals")!;
    expect((nlink.options as { targetTableId: string }).targetTableId).toBe(newDeals);

    // Rollup points at the COPY's link and amount fields.
    const nroll = byKey.get("fld_total")!;
    expect((nroll.options as { linkFieldId: string }).linkFieldId).toBe(nlink.id);
    expect((nroll.options as { targetFieldId: string }).targetFieldId).toBe(byKey.get("fld_amount")!.id);

    // Formula AST references the COPY's rollup.
    const nplus = byKey.get("fld_plus")!;
    const ast = (nplus.options as { ast: { l: { id: string } } }).ast;
    expect(ast.l.id).toBe(nroll.id);

    // The button lost its webhookId — webhooks are not copied.
    const nfire = byKey.get("fld_fire")!;
    expect((nfire.options as Record<string, unknown>).webhookId).toBeUndefined();

    // View filter + sort remapped to copy ids; share NOT copied.
    const { data: newViews } = await alice.db
      .from("views").select("id, share_id").eq("base_id", newBase).eq("table_id", newCompanies);
    expect(newViews!.length).toBe(1);
    expect(newViews![0].share_id).toBeNull();

    const { data: newFilters } = await alice.db
      .from("filters").select("field_id").eq("base_id", newBase);
    expect(newFilters!.map((f) => f.field_id)).toEqual([nroll.id]);
    const { data: newSorts } = await alice.db
      .from("sorts").select("field_id").eq("base_id", newBase);
    expect(newSorts!.map((s) => s.field_id)).toEqual([nroll.id]);

    // ── The proof: fresh records in the COPY compute through the whole chain ──
    const co = must(
      await alice.db.from("records")
        .insert({ table_id: newCompanies, base_id: newBase, data: { fld_name: "Acme" }, sort_order: 1 })
        .select().single()
    ) as { id: string };
    const d1 = must(
      await alice.db.from("records")
        .insert({ table_id: newDeals, base_id: newBase, data: { fld_deal: "A", fld_amount: "100" }, sort_order: 1 })
        .select().single()
    ) as { id: string };
    const d2 = must(
      await alice.db.from("records")
        .insert({ table_id: newDeals, base_id: newBase, data: { fld_deal: "B", fld_amount: "250" }, sort_order: 2 })
        .select().single()
    ) as { id: string };
    must(
      await alice.db.from("links").insert([
        { base_id: newBase, field_id: nlink.id as string, from_record_id: co.id, to_record_id: d1.id },
        { base_id: newBase, field_id: nlink.id as string, from_record_id: co.id, to_record_id: d2.id },
      ])
    );

    const { data: page, error } = await alice.db.rpc("swamp_query_records", {
      p_table_id: newCompanies, p_spec: {},
    });
    expect(error).toBeNull();
    const rec = (page as { records: { data: Record<string, unknown> }[] }).records[0];
    expect(Number(rec.data.fld_total)).toBe(350);
    expect(Number(rec.data.fld_plus)).toBe(351);
  });

  it("an editor cannot duplicate a base — creating a base is workspace-creator work", async () => {
    must(
      await alice.db.from("base_members")
        .upsert({ base_id: srcBase, user_id: bob.id, role: "editor" })
    );
    const { error } = await bob.db.rpc("swamp_duplicate_base", {
      p_base_id: srcBase, p_name: "Stolen",
    });
    expect(error).not.toBeNull();
  });
});

describe("swamp_remap_ast", () => {
  // The AST grammar (features/tables/formula/parser.ts) is exactly:
  //   num(v) str(v) bool(v) field(id) un(op,a) bin(op,l,r) call(fn,args)
  // so the child positions are l, r, a and args. This pins that the remap
  // reaches every one of them, at depth.
  const OLD_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const OLD_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const NEW_A = "11111111-1111-1111-1111-111111111111";
  const NEW_B = "22222222-2222-2222-2222-222222222222";
  const map = { [OLD_A]: NEW_A, [OLD_B]: NEW_B };

  const remap = async (node: unknown) =>
    must(await alice.db.rpc("swamp_remap_ast", { p_node: node, p_map: map })) as unknown;

  it("rewrites field ids through every child position, at depth", async () => {
    const ast = {
      t: "call",
      fn: "IF",
      args: [
        { t: "bin", op: ">", l: { t: "field", id: OLD_A }, r: { t: "num", v: 1 } },
        { t: "un", op: "-", a: { t: "field", id: OLD_B } },
        { t: "call", fn: "CONCAT", args: [{ t: "field", id: OLD_A }, { t: "str", v: "x" }] },
      ],
    };

    const out = JSON.stringify(await remap(ast));
    expect(out).not.toContain(OLD_A);
    expect(out).not.toContain(OLD_B);
    expect(out).toContain(NEW_A);
    expect(out).toContain(NEW_B);
  });

  it("leaves an id that is not in the map alone (it referenced outside the copy)", async () => {
    const stranger = "99999999-9999-9999-9999-999999999999";
    const out = (await remap({ t: "field", id: stranger })) as { id: string };
    expect(out.id).toBe(stranger);
  });

  it("is a no-op on scalars and null", async () => {
    expect((await remap({ t: "num", v: 5 })) as { v: number }).toEqual({ t: "num", v: 5 });
    expect(await remap(null)).toBeNull();
  });
});

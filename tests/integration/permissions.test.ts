import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anon, createUser, deleteUser, must, workspaceOf, type TestUser } from "./harness";

// ════════════════════════════════════════════════════════════════════════════
// Table & field permissions — Stage 1: the machinery, wired to nothing.
//
// The properties that matter here are the ones every later stage stands on:
//
//   · DEFAULT-OPEN. No rule ⇒ TRUE. This is what lets Stage 2 and 3 wire up
//     call sites without changing anybody's behaviour.
//   · NARROW-ONLY. A rule can never hand out access the role ladder denies.
//     Call sites AND the two together; there is a test below that pins the
//     conjunction rather than trusting the convention.
//   · FAIL-CLOSED on the unknowns — no user, unrecognised grant type.
//   · The fast-path flag tracks reality, because every hot read will skip the
//     resolver entirely when it is false.
// ════════════════════════════════════════════════════════════════════════════

let alice: TestUser; // owner
let bob: TestUser; // gets roles assigned per test
let baseId: string;
let tableId: string;
let fieldId: string;

const allows = async (
  user: TestUser | null,
  key: string,
  fieldIdArg: string | null = null
): Promise<boolean> => {
  const db = user ? user.db : alice.db;
  const { data, error } = await db.rpc("swamp_permission_allows", {
    p_base_id: baseId,
    p_table_id: tableId,
    p_key: key,
    p_field_id: fieldIdArg,
    p_user_id: user ? user.id : null,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
};

const hasFlag = async (): Promise<boolean> => {
  const { data } = await alice.db
    .from("bases")
    .select("has_permissions")
    .eq("id", baseId)
    .single();
  return data!.has_permissions as boolean;
};

beforeAll(async () => {
  [alice, bob] = await Promise.all([createUser(), createUser()]);

  const workspaceId = await workspaceOf(alice);
  const base = must(
    await alice.db
      .from("bases")
      .insert({ workspace_id: workspaceId, name: "Perms" })
      .select()
      .single()
  ) as { id: string };
  baseId = base.id;

  const table = must(
    await alice.db.from("tables").insert({ base_id: baseId, name: "Leads" }).select().single()
  ) as { id: string };
  tableId = table.id;

  const field = must(
    await alice.db
      .from("fields")
      .insert({
        table_id: tableId,
        base_id: baseId,
        name: "Salary",
        key: "fld_salary",
        type: "currency",
        is_primary: false,
      })
      .select()
      .single()
  ) as { id: string };
  fieldId = field.id;
});

afterAll(async () => {
  await Promise.all([deleteUser(alice), deleteUser(bob)]);
});

beforeEach(async () => {
  // Every test starts from "no rules". The flag must follow.
  await alice.db.from("permissions").delete().eq("base_id", baseId);
});

// ─── Default-open ───────────────────────────────────────────────────────────

describe("default-open", () => {
  it("allows everything when no rule exists", async () => {
    for (const key of ["table_record_add", "table_record_delete"]) {
      expect(await allows(alice, key), key).toBe(true);
      expect(await allows(bob, key), `${key} (bob)`).toBe(true);
    }
    expect(await allows(alice, "record_field_edit", fieldId)).toBe(true);
  });

  it("the flag is false until a rule exists, and true after", async () => {
    expect(await hasFlag()).toBe(false);

    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_add",
        granted_type: "nobody",
      })
    );
    expect(await hasFlag()).toBe(true);

    await alice.db.from("permissions").delete().eq("base_id", baseId);
    expect(await hasFlag()).toBe(false);
  });
});

// ─── Grant semantics ────────────────────────────────────────────────────────

describe("granted_type", () => {
  it("nobody denies everyone, including the owner", async () => {
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_delete",
        granted_type: "nobody",
      })
    );
    expect(await allows(alice, "table_record_delete")).toBe(false);
    expect(await allows(bob, "table_record_delete")).toBe(false);
  });

  it("user allows exactly the listed people", async () => {
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_add",
        granted_type: "user", user_ids: [bob.id],
      })
    );
    expect(await allows(bob, "table_record_add")).toBe(true);
    expect(await allows(alice, "table_record_add")).toBe(false);
  });

  it("role allows that rung and above, reading LIVE membership", async () => {
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_add",
        granted_type: "role", role: "creator",
      })
    );

    // Alice owns the base (owner > creator).
    expect(await allows(alice, "table_record_add")).toBe(true);

    // Bob as editor is below creator.
    must(
      await alice.db
        .from("base_members")
        .upsert({ base_id: baseId, user_id: bob.id, role: "editor" })
    );
    expect(await allows(bob, "table_record_add")).toBe(false);

    // Promote him and the SAME rule now admits him — no rule edit, no cache.
    must(
      await alice.db
        .from("base_members")
        .update({ role: "creator" })
        .eq("base_id", baseId)
        .eq("user_id", bob.id)
    );
    expect(await allows(bob, "table_record_add")).toBe(true);

    await alice.db.from("base_members").delete().eq("base_id", baseId).eq("user_id", bob.id);
  });

  it("denies an unauthenticated caller once a rule exists", async () => {
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_add",
        granted_type: "role", role: "viewer",
      })
    );
    // p_user_id null — nobody satisfies a rule.
    expect(await allows(null, "table_record_add")).toBe(false);
  });
});

// ─── The narrowing invariant ────────────────────────────────────────────────

describe("a permission may only NARROW", () => {
  it("cannot grant what the role ladder denies", async () => {
    // Bob is a VIEWER: the ladder says he may not add records, whatever a rule
    // says. This pins the conjunction every call site must use — swamp_can AND
    // allows — rather than trusting the convention to be followed.
    must(
      await alice.db
        .from("base_members")
        .upsert({ base_id: baseId, user_id: bob.id, role: "viewer" })
    );
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_add",
        granted_type: "user", user_ids: [bob.id],
      })
    );

    // The rule alone says yes...
    expect(await allows(bob, "table_record_add")).toBe(true);

    // ...and the ladder still says no, so the AND is no.
    const { data: ladder } = await bob.db.rpc("swamp_can", {
      p_base_id: baseId,
      p_min: "editor",
    });
    expect(ladder).toBe(false);
    expect(ladder && (await allows(bob, "table_record_add"))).toBe(false);

    await alice.db.from("base_members").delete().eq("base_id", baseId).eq("user_id", bob.id);
  });
});

// ─── Shape constraints ──────────────────────────────────────────────────────

describe("the table refuses nonsense", () => {
  it("record_field_edit requires a field; the others refuse one", async () => {
    const noField = await alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "record_field_edit",
      granted_type: "nobody",
    });
    expect(noField.error).not.toBeNull();

    const strayField = await alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "table_record_add",
      field_id: fieldId, granted_type: "nobody",
    });
    expect(strayField.error).not.toBeNull();
  });

  it("a role grant needs a role; a user grant needs users", async () => {
    const roleless = await alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "table_record_add",
      granted_type: "role",
    });
    expect(roleless.error).not.toBeNull();

    const userless = await alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "table_record_add",
      granted_type: "user", user_ids: [],
    });
    expect(userless.error).not.toBeNull();
  });

  it("refuses an unknown key, and a second rule for the same target", async () => {
    const badKey = await alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "delete_the_database",
      granted_type: "nobody",
    });
    expect(badKey.error).not.toBeNull();

    // table_visibility is NOT offered: it is a READ permission and the read
    // surface has no choke point (see the migration header). Accepting a rule
    // that silently does nothing would be worse than refusing it.
    const readKey = await alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "table_visibility",
      granted_type: "nobody",
    });
    expect(readKey.error).not.toBeNull();

    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_add",
        granted_type: "nobody",
      })
    );
    const dupe = await alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "table_record_add",
      granted_type: "role", role: "owner",
    });
    expect(dupe.error).not.toBeNull();
  });
});

// ─── Who may manage rules ───────────────────────────────────────────────────

describe("managing rules", () => {
  it("an editor may READ the rules but not write them", async () => {
    must(
      await alice.db
        .from("base_members")
        .upsert({ base_id: baseId, user_id: bob.id, role: "editor" })
    );
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_add",
        granted_type: "nobody",
      })
    );

    // Read: yes — the UI has to grey out what you cannot do.
    const read = await bob.db.from("permissions").select("id");
    expect(read.error).toBeNull();
    expect(read.data!.length).toBe(1);

    // Write: no.
    const write = await bob.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "table_record_delete",
      granted_type: "nobody",
    });
    expect(write.error).not.toBeNull();

    await alice.db.from("base_members").delete().eq("base_id", baseId).eq("user_id", bob.id);
  });

  it("a stranger sees nothing and writes nothing", async () => {
    const mallory = await createUser();
    try {
      must(
        await alice.db.from("permissions").insert({
          base_id: baseId, table_id: tableId, key: "table_record_add",
          granted_type: "nobody",
        })
      );

      const read = await mallory.db.from("permissions").select("id");
      expect(read.data ?? []).toHaveLength(0);

      const write = await mallory.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_delete",
        granted_type: "nobody",
      });
      expect(write.error).not.toBeNull();
    } finally {
      await deleteUser(mallory);
    }
  });

  it("anon cannot reach the table or the resolver", async () => {
    const table = await anon().from("permissions").select("id");
    expect(table.error).not.toBeNull();

    const fn = await anon().rpc("swamp_permission_allows", {
      p_base_id: baseId, p_table_id: tableId, p_key: "table_record_add",
      p_field_id: null, p_user_id: null,
    });
    expect(fn.error).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Stage 2 — the write choke point.
//
// The claim being tested is the one the whole design rests on: a BEFORE trigger
// on public.records fires for EVERY caller, so a rule holds identically whether
// the write arrives from a cookie session, an API token (SECURITY DEFINER, RLS
// off), a public form, or a direct RPC call to swamp_patch_records.
//
// Six guards in six callers would leave the seventh unwritten. These tests are
// how we know there is one.
// ════════════════════════════════════════════════════════════════════════════

describe("Stage 2 — writes are enforced at the choke point", () => {
  let nameId: string;
  let recordId: string;

  const rule = (key: string, extra: Record<string, unknown> = {}) =>
    alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key, granted_type: "nobody", ...extra,
    });

  beforeAll(async () => {
    const f = must(
      await alice.db
        .from("fields")
        .insert({
          table_id: tableId, base_id: baseId, name: "Name", key: "fld_name",
          type: "text", is_primary: true,
        })
        .select().single()
    ) as { id: string };
    nameId = f.id;
  });

  beforeEach(async () => {
    await alice.db.from("permissions").delete().eq("base_id", baseId);
    await alice.db.from("records").delete().eq("table_id", tableId);
    const r = must(
      await alice.db
        .from("records")
        .insert({ table_id: tableId, base_id: baseId, sort_order: 1, data: { fld_name: "Acme", fld_salary: "100" } })
        .select().single()
    ) as { id: string };
    recordId = r.id;
  });

  it("table_record_add blocks an insert — even for the base OWNER", async () => {
    must(await rule("table_record_add"));
    const { error } = await alice.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, sort_order: 2, data: { fld_name: "Beta" } });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/may not add records/i);
  });

  it("table_record_delete blocks BOTH the soft delete and the restore", async () => {
    must(await rule("table_record_delete"));

    const del = await alice.db
      .from("records").update({ deleted_at: new Date().toISOString() }).eq("id", recordId);
    expect(del.error).not.toBeNull();

    // And the inverse: un-deleting is the same door. Soft-delete first with the
    // rule off, then put it back on.
    await alice.db.from("permissions").delete().eq("base_id", baseId);
    must(
      await alice.db.from("records")
        .update({ deleted_at: new Date().toISOString() }).eq("id", recordId)
    );
    must(await rule("table_record_delete"));

    const restore = await alice.db.from("records").update({ deleted_at: null }).eq("id", recordId);
    expect(restore.error).not.toBeNull();
    expect(restore.error!.message).toMatch(/delete or restore/i);
  });

  it("record_field_edit blocks the ruled field and leaves the others alone", async () => {
    must(await rule("record_field_edit", { field_id: fieldId }));

    // The locked field is refused...
    const locked = await alice.db
      .from("records").update({ data: { fld_name: "Acme", fld_salary: "999" } }).eq("id", recordId);
    expect(locked.error).not.toBeNull();
    expect(locked.error!.message).toMatch(/Salary/);

    // ...and an untouched field still writes, in the SAME payload shape. This is
    // the read-modify-write case: PostgREST sends the whole `data` object, so a
    // naive "is this key present" check would refuse every edit on the row.
    const other = await alice.db
      .from("records").update({ data: { fld_name: "Renamed", fld_salary: "100" } }).eq("id", recordId);
    expect(other.error).toBeNull();
  });

  it("an INSERT that omits the locked key is allowed; supplying it is not", async () => {
    must(await rule("record_field_edit", { field_id: fieldId }));

    const without = await alice.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, sort_order: 3, data: { fld_name: "NoSalary" } });
    expect(without.error).toBeNull();

    const with_ = await alice.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, sort_order: 4, data: { fld_name: "X", fld_salary: "1" } });
    expect(with_.error).not.toBeNull();
  });

  it("holds on swamp_patch_records — the RPC any editor can call directly", async () => {
    // sanitizeValues() in TypeScript is not a boundary; this RPC is granted to
    // `authenticated` and reachable straight from the browser.
    must(await rule("record_field_edit", { field_id: fieldId }));

    const { error } = await alice.db.rpc("swamp_patch_records", {
      p_table_id: tableId,
      p_patches: [{ id: recordId, values: { fld_salary: "31337" } }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/may not edit/i);
  });

  it("holds on the TOKEN path, where RLS is off entirely", async () => {
    // swamp_api_patch is SECURITY DEFINER — RLS does not run. If the guard had
    // been written as a policy, this would silently succeed.
    const token = must(
      await alice.db.rpc("swamp_create_token", {
        p_base_id: baseId, p_name: "perm-test",
        p_scopes: ["records:read", "records:write"], p_table_ids: [], p_expires_at: null,
      })
    ) as string;

    must(await rule("record_field_edit", { field_id: fieldId }));

    const { error } = await anon().rpc("swamp_api_patch", {
      p_token: token,
      p_table_id: tableId,
      p_records: [{ id: recordId, fields: { fld_salary: "31337" } }],
    });
    expect(error).not.toBeNull();

    // The value really did not move.
    const { data } = await alice.db.from("records").select("data").eq("id", recordId).single();
    expect((data!.data as Record<string, unknown>).fld_salary).toBe("100");
  });

  it("blocks a token INSERT when table_record_add says nobody", async () => {
    const token = must(
      await alice.db.rpc("swamp_create_token", {
        p_base_id: baseId, p_name: "perm-add",
        p_scopes: ["records:read", "records:write"], p_table_ids: [], p_expires_at: null,
      })
    ) as string;

    must(await rule("table_record_add"));

    const { error } = await anon().rpc("swamp_api_insert", {
      p_token: token, p_table_id: tableId,
      p_records: [{ fields: { fld_name: "ViaToken" } }],
    });
    expect(error).not.toBeNull();
  });

  it("costs nothing when the base has no rules — the flag short-circuits", async () => {
    // Not a benchmark; a correctness check that the fast path is actually taken
    // and does not change behaviour.
    const { data } = await alice.db.from("bases").select("has_permissions").eq("id", baseId).single();
    expect(data!.has_permissions).toBe(false);

    const ok = await alice.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, sort_order: 9, data: { fld_name: "Free" } });
    expect(ok.error).toBeNull();
  });

  it("a role rule lets the right people through while blocking the rest", async () => {
    must(
      await alice.db
        .from("base_members")
        .upsert({ base_id: baseId, user_id: bob.id, role: "editor" })
    );
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "record_field_edit",
        field_id: fieldId, granted_type: "role", role: "creator",
      })
    );

    // Bob is an editor — below creator — so the salary is locked for him.
    const bobTry = await bob.db
      .from("records").update({ data: { fld_name: "Acme", fld_salary: "500" } }).eq("id", recordId);
    expect(bobTry.error).not.toBeNull();

    // Alice owns the base, so she is above creator and may write it.
    const aliceTry = await alice.db
      .from("records").update({ data: { fld_name: "Acme", fld_salary: "500" } }).eq("id", recordId);
    expect(aliceTry.error).toBeNull();

    await alice.db.from("base_members").delete().eq("base_id", baseId).eq("user_id", bob.id);
  });

  it("refuses a rule on a field whose value is not stored — no silent no-ops", async () => {
    const linkField = must(
      await alice.db.from("fields").insert({
        table_id: tableId, base_id: baseId, name: "Rel", key: "fld_rel",
        type: "link", options: { targetTableId: tableId, cardinality: "many" },
        is_primary: false,
      }).select().single()
    ) as { id: string };

    const { error } = await alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "record_field_edit",
      field_id: linkField.id, granted_type: "nobody",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/hold no stored value/i);

    await alice.db.from("fields").delete().eq("id", linkField.id);
  });
});

// ─── Stage 3: the management API's own rules ────────────────────────────────

describe("Stage 3 — managing rules through the API surface", () => {
  beforeEach(async () => {
    await alice.db.from("permissions").delete().eq("base_id", baseId);
  });

  it("replacing a rule for the same target does not 409 — the UI toggles constantly", async () => {
    // The unique index means a naive insert would fail on the second toggle.
    // The route deletes-then-inserts; this pins that the end state is one rule.
    for (const grant of ["nobody", "role"] as const) {
      await alice.db
        .from("permissions")
        .delete()
        .eq("table_id", tableId)
        .eq("key", "table_record_add")
        .is("field_id", null);

      must(
        await alice.db.from("permissions").insert({
          base_id: baseId, table_id: tableId, key: "table_record_add",
          granted_type: grant, ...(grant === "role" ? { role: "creator" } : {}),
        })
      );
    }

    const { data } = await alice.db
      .from("permissions").select("id, granted_type").eq("table_id", tableId);
    expect(data!.length).toBe(1);
    expect(data![0].granted_type).toBe("role");
  });

  it("a rule cannot be scoped to another base's table", async () => {
    // The route reads base_id off the TABLE, never off the request body — but
    // the FK plus the RLS check are what actually hold the line.
    const other = await createUser();
    try {
      const ws = await workspaceOf(other);
      const otherBase = must(
        await other.db.from("bases").insert({ workspace_id: ws, name: "Theirs" }).select().single()
      ) as { id: string };

      // Alice claims her rule belongs to Bob's base: RLS refuses the write.
      const { error } = await alice.db.from("permissions").insert({
        base_id: otherBase.id, table_id: tableId, key: "table_record_add",
        granted_type: "nobody",
      });
      expect(error).not.toBeNull();
    } finally {
      await deleteUser(other);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Hardening — one test per hole found by attacking Stage 2.
//
// Every one of these passed BEFORE the fix, which is the point of writing them.
// ════════════════════════════════════════════════════════════════════════════

describe("hardening", () => {
  let nameId2: string;
  let recId: string;

  beforeAll(async () => {
    const { data } = await alice.db
      .from("fields").select("id").eq("table_id", tableId).eq("key", "fld_name").maybeSingle();
    nameId2 = data!.id as string;
  });

  beforeEach(async () => {
    await alice.db.from("permissions").delete().eq("base_id", baseId);
    await alice.db.from("records").delete().eq("table_id", tableId);
    const r = must(
      await alice.db.from("records")
        .insert({ table_id: tableId, base_id: baseId, sort_order: 1, data: { fld_name: "Acme", fld_salary: "100" } })
        .select().single()
    ) as { id: string };
    recId = r.id;
  });

  it("NULL is not allow: a NON-MEMBER cannot satisfy a role rule", async () => {
    // swamp_base_role_of is NULL for a non-member, swamp_role_rank(NULL) is
    // NULL, and `if not NULL` never fires — so this returned "allowed".
    const stranger = await createUser();
    try {
      must(
        await alice.db.from("permissions").insert({
          base_id: baseId, table_id: tableId, key: "table_record_add",
          granted_type: "role", role: "editor",
        })
      );
      const { data } = await alice.db.rpc("swamp_permission_allows", {
        p_base_id: baseId, p_table_id: tableId, p_key: "table_record_add",
        p_field_id: null, p_user_id: stranger.id,
      });
      expect(data).toBe(false);
    } finally {
      await deleteUser(stranger);
    }
  });

  it("NULL is not allow: a NULL inside user_ids cannot open a rule to everyone", async () => {
    // `x = any(array[null])` is NULL. The array now refuses NULL elements, and
    // the resolver coalesces regardless.
    const { error } = await alice.db.from("permissions").insert({
      base_id: baseId, table_id: tableId, key: "table_record_add",
      granted_type: "user", user_ids: [bob.id, null],
    });
    expect(error).not.toBeNull();
  });

  it("a spoofed base_id cannot steer the check at a base with no rules", async () => {
    // records.base_id is client-supplied. Reading it for the has_permissions
    // fast path meant a writer could aim the whole check somewhere harmless
    // while the row still landed in the victim's table.
    const ws = await workspaceOf(alice);
    const decoy = must(
      await alice.db.from("bases").insert({ workspace_id: ws, name: "Decoy" }).select().single()
    ) as { id: string };

    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "record_field_edit",
        field_id: fieldId, granted_type: "nobody",
      })
    );

    const { error } = await alice.db
      .from("records")
      .update({ base_id: decoy.id, data: { fld_name: "Acme", fld_salary: "999" } })
      .eq("id", recId);
    expect(error).not.toBeNull();

    // The value did not move.
    const { data } = await alice.db.from("records").select("data").eq("id", recId).single();
    expect((data!.data as Record<string, unknown>).fld_salary).toBe("100");

    await alice.db.from("bases").delete().eq("id", decoy.id);
  });

  it("a hard DELETE is covered, not just the soft delete", async () => {
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_delete",
        granted_type: "nobody",
      })
    );

    const { error } = await alice.db.from("records").delete().eq("id", recId);
    expect(error).not.toBeNull();

    const { data } = await alice.db.from("records").select("id").eq("id", recId);
    expect(data!.length).toBe(1);
  });

  it("...but a rule never makes its own table undroppable", async () => {
    // The cascade from dropping a table is not a record deletion. Without the
    // cascade escape, table_record_delete = nobody would wedge the table.
    const doomed = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "Doomed" }).select().single()
    ) as { id: string };
    must(
      await alice.db.from("fields").insert({
        table_id: doomed.id, base_id: baseId, name: "N", key: "fld_n", type: "text", is_primary: true,
      })
    );
    must(
      await alice.db.from("records")
        .insert({ table_id: doomed.id, base_id: baseId, sort_order: 1, data: { fld_n: "x" } })
    );
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: doomed.id, key: "table_record_delete",
        granted_type: "nobody",
      })
    );

    const { error } = await alice.db.from("tables").delete().eq("id", doomed.id);
    expect(error).toBeNull();
  });

  it("a rule cannot be planted on another tenant's table", async () => {
    // Mallory owns her own base, so RLS admitted a row carrying HER base_id and
    // the VICTIM's table_id — and the resolver looks rules up by table_id alone,
    // so it applied. Composite FK now makes the pair unrepresentable.
    const mallory = await createUser();
    try {
      const ws = await workspaceOf(mallory);
      const herBase = must(
        await mallory.db.from("bases").insert({ workspace_id: ws, name: "Hers" }).select().single()
      ) as { id: string };

      const { error } = await mallory.db.from("permissions").insert({
        base_id: herBase.id, table_id: tableId, key: "record_field_edit",
        field_id: fieldId, granted_type: "nobody",
      });
      expect(error).not.toBeNull();
    } finally {
      await deleteUser(mallory);
    }
  });

  it("swamp_writable_keys is back to its original contract (autoNumber included)", async () => {
    // A permission clause here turned a denial into a SILENT drop, because
    // swamp_pick_writable drops unknown keys by design. It also excluded
    // autoNumber, breaking upserts keyed on one.
    const auto = must(
      await alice.db.from("fields").insert({
        table_id: tableId, base_id: baseId, name: "Seq", key: "fld_seq",
        type: "autoNumber", is_primary: false,
      }).select().single()
    ) as { id: string };

    const { data } = await alice.db.rpc("swamp_writable_keys", { p_table_id: tableId });
    expect(data as string[]).toContain("fld_seq");

    await alice.db.from("fields").delete().eq("id", auto.id);
  });
});

describe("swamp_set_permission — atomic replacement", () => {
  beforeEach(async () => {
    await alice.db.from("permissions").delete().eq("base_id", baseId);
  });

  it("replaces in ONE transaction, so a failed write cannot leave the target unprotected", async () => {
    must(
      await alice.db.rpc("swamp_set_permission", {
        p_table_id: tableId, p_key: "table_record_add", p_field_id: null,
        p_granted_type: "nobody", p_role: null, p_user_ids: [],
      })
    );

    // Replacing with an INVALID grant must fail whole: the old rule survives.
    const bad = await alice.db.rpc("swamp_set_permission", {
      p_table_id: tableId, p_key: "table_record_add", p_field_id: null,
      p_granted_type: "role", p_role: null, p_user_ids: [],   // role grant, no role
    });
    expect(bad.error).not.toBeNull();

    const { data } = await alice.db
      .from("permissions").select("granted_type").eq("table_id", tableId).eq("key", "table_record_add");
    expect(data!.length).toBe(1);
    expect(data![0].granted_type).toBe("nobody");
  });

  it("a valid replacement leaves exactly one rule", async () => {
    for (const g of ["nobody", "role"] as const) {
      must(
        await alice.db.rpc("swamp_set_permission", {
          p_table_id: tableId, p_key: "table_record_add", p_field_id: null,
          p_granted_type: g, p_role: g === "role" ? "creator" : null, p_user_ids: [],
        })
      );
    }
    const { data } = await alice.db
      .from("permissions").select("granted_type").eq("table_id", tableId).eq("key", "table_record_add");
    expect(data!.length).toBe(1);
    expect(data![0].granted_type).toBe("role");
  });

  it("an editor cannot set a rule through the RPC either — it is SECURITY INVOKER", async () => {
    must(
      await alice.db.from("base_members").upsert({ base_id: baseId, user_id: bob.id, role: "editor" })
    );
    const { error } = await bob.db.rpc("swamp_set_permission", {
      p_table_id: tableId, p_key: "table_record_add", p_field_id: null,
      p_granted_type: "nobody", p_role: null, p_user_ids: [],
    });
    expect(error).not.toBeNull();
    await alice.db.from("base_members").delete().eq("base_id", baseId).eq("user_id", bob.id);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Re-parenting, the kill switch, and the cron.
//
// The first hardening pass stopped the caller lying about base_id and I called
// the phase done. An adversarial pass then found that table_id is just as
// client-controlled — and every key is resolved from it.
// ════════════════════════════════════════════════════════════════════════════

describe("re-parenting", () => {
  let scratchId: string;
  let recId2: string;

  beforeAll(async () => {
    const t = must(
      await alice.db.from("tables").insert({ base_id: baseId, name: "Scratch" }).select().single()
    ) as { id: string };
    scratchId = t.id;
    must(
      await alice.db.from("fields").insert({
        table_id: scratchId, base_id: baseId, name: "N", key: "fld_n",
        type: "text", is_primary: true,
      })
    );
  });

  beforeEach(async () => {
    await alice.db.from("permissions").delete().eq("base_id", baseId);
    await alice.db.from("records").delete().eq("table_id", tableId);
    const r = must(
      await alice.db.from("records")
        .insert({ table_id: tableId, base_id: baseId, sort_order: 1, data: { fld_name: "Acme", fld_salary: "100" } })
        .select().single()
    ) as { id: string };
    recId2 = r.id;
  });

  it("a record cannot be moved to another table — the whole bypass depends on it", async () => {
    // Park the row in an UNRULED table, edit the locked field there (the loop
    // iterates the scratch table's fields and finds no rules), then move it
    // back with data unchanged so the loop is skipped entirely.
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "record_field_edit",
        field_id: fieldId, granted_type: "nobody",
      })
    );

    const move = await alice.db
      .from("records")
      .update({ table_id: scratchId, data: { fld_name: "Acme", fld_salary: "999" } })
      .eq("id", recId2);
    expect(move.error).not.toBeNull();
    expect(move.error!.message).toMatch(/cannot change tables/i);

    const { data } = await alice.db.from("records").select("data, table_id").eq("id", recId2).single();
    expect((data!.data as Record<string, unknown>).fld_salary).toBe("100");
    expect(data!.table_id).toBe(tableId);
  });

  it("...including the one-statement delete variant", async () => {
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_delete",
        granted_type: "nobody",
      })
    );
    const { error } = await alice.db
      .from("records")
      .update({ table_id: scratchId, deleted_at: new Date().toISOString() })
      .eq("id", recId2);
    expect(error).not.toBeNull();
  });

  it("a normal edit still works — the guard costs a comparison, not a behaviour", async () => {
    const { error } = await alice.db
      .from("records").update({ data: { fld_name: "Renamed", fld_salary: "100" } }).eq("id", recId2);
    expect(error).toBeNull();
  });
});

describe("has_permissions is derived, not client-writable", () => {
  beforeEach(async () => {
    await alice.db.from("permissions").delete().eq("base_id", baseId);
  });

  it("cannot be switched off to disable every rule in the base", async () => {
    must(
      await alice.db.from("permissions").insert({
        base_id: baseId, table_id: tableId, key: "table_record_add",
        granted_type: "nobody",
      })
    );

    // The kill switch: one UPDATE that leaves the rules in place, looking
    // enforced, while the trigger's fast path skips them all.
    await alice.db.from("bases").update({ has_permissions: false }).eq("id", baseId);

    const { data } = await alice.db
      .from("bases").select("has_permissions").eq("id", baseId).single();
    expect(data!.has_permissions).toBe(true);

    // And the rule really is still enforced.
    const { error } = await alice.db
      .from("records")
      .insert({ table_id: tableId, base_id: baseId, sort_order: 50, data: { fld_name: "X" } });
    expect(error).not.toBeNull();
  });

  it("an ordinary base update (rename) is untouched", async () => {
    const { error } = await alice.db.from("bases").update({ name: "Perms II" }).eq("id", baseId);
    expect(error).toBeNull();
  });
});

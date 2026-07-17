import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// ════════════════════════════════════════════════════════════════════════════
// Group-by, end to end.
//
// The headline gap against Airtable, and the one place swamp had the vocabulary
// and no engine: view_fields.group_by / group_by_order / group_by_dir have existed
// since the schema rebuild, loadViewConfig READ them, saveViewFields never wrote
// them, and table-workspace hardcoded groupBy:false. Write-only-false.
//
// The design in one line: grouping IS a sort, and it goes first. Rows then arrive
// grouped and contiguous, the keyset cursor works over it unchanged, and the grid
// puts a header wherever the value changes. The counts come from a separate RPC
// over the FILTERED set — which is the part a browser test has to check, because
// counting the loaded window would look identical on four rows and lie on four
// thousand.
// ════════════════════════════════════════════════════════════════════════════

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin(): SupabaseClient {
  if (!/127\.0\.0\.1|localhost/.test(URL)) {
    throw new Error(`[swamp] e2e is pointed at ${URL}. It must only run against local.`);
  }
  return createClient(URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`seed: ${res.error.message}`);
  if (res.data === null) throw new Error("seed: no data returned");
  return res.data;
}

const email = `e2e-gb-${randomUUID()}@swamp.test`;
const password = randomUUID();
let userId: string;

test.beforeAll(async () => {
  const { data, error } = await admin().auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw error;
  userId = data.user!.id;
});

test.afterAll(async () => {
  if (userId) await admin().auth.admin.deleteUser(userId);
});

async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "swamp:consent:v1",
      JSON.stringify({ necessary: true, analytics: false })
    );
  });
  await page.goto("/auth/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);

  const first = page.getByLabel(/first name/i);
  if (await first.isVisible().catch(() => false)) {
    await first.fill("Grace");
    await page.getByLabel(/last name/i).fill("Hopper");
    await page.getByRole("button", { name: /continue/i }).click();
  }
}

/** Four records across two statuses plus one with none — enough to prove ordering,
 *  counts, and that the empty bucket is a bucket. */
async function seed(): Promise<string> {
  const db = admin();
  const ws = must(
    await db.from("workspace_members").select("workspace_id").eq("user_id", userId).single()
  ) as { workspace_id: string };
  const base = must(
    await db.from("bases").insert({ workspace_id: ws.workspace_id, name: "GroupBase" }).select().single()
  ) as { id: string };
  const table = must(
    await db.from("tables").insert({ base_id: base.id, name: "Issues" }).select().single()
  ) as { id: string };

  must(
    await db.from("fields").insert([
      // `options` on EVERY row. PostgREST unions the keys across the array, so a row
      // that omits a key another row carries gets an explicit NULL rather than the
      // column default — and options is NOT NULL. It is the same rule saveViewFields
      // now batches around, and it bites here too.
      { table_id: table.id, base_id: base.id, name: "Name", key: "fld_name", type: "text", is_primary: true, sort_order: 1, options: {} },
      { table_id: table.id, base_id: base.id, name: "Status", key: "fld_status", type: "singleSelect", is_primary: false, sort_order: 2,
        options: { options: [{ value: "open", color: "teal" }, { value: "closed", color: "rose" }] } },
      // Not groupable: a jsonb array. `eq` on it is not a membership test.
      { table_id: table.id, base_id: base.id, name: "Tags", key: "fld_tags", type: "multiSelect", is_primary: false, sort_order: 3, options: {} },
    ]).select()
  );
  must(
    await db.from("views").insert({ table_id: table.id, base_id: base.id, type: "grid", name: "Grid", is_default: true }).select().single()
  );
  must(
    await db.from("records").insert([
      { table_id: table.id, base_id: base.id, data: { fld_name: "one", fld_status: "open" } },
      { table_id: table.id, base_id: base.id, data: { fld_name: "two", fld_status: "open" } },
      { table_id: table.id, base_id: base.id, data: { fld_name: "three", fld_status: "closed" } },
      { table_id: table.id, base_id: base.id, data: { fld_name: "four" } },
    ]).select()
  );
  return table.id;
}

async function groupBy(page: Page, fieldName: string) {
  await page.getByRole("button", { name: /^Group$/ }).click();
  await page.getByRole("dialog").getByRole("combobox").click();
  await page.getByRole("option", { name: fieldName, exact: true }).click();
  await page.keyboard.press("Escape");
}

const headers = (page: Page) => page.getByTestId("group-header");

test("groups the rows, counts each group, and puts Empty last", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();

  await page.goto(`/app/t/${tableId}`);
  await expect(page.getByTestId("grid-row")).toHaveCount(4);
  await expect(headers(page)).toHaveCount(0); // ungrouped to begin with

  await groupBy(page, "Status");

  // Ascending by value, with the empty bucket last — the same place a null sorts
  // in the grid.
  await expect.poll(async () => (await headers(page).allTextContents()).map((h) => h.trim()))
    .toEqual(["closed1", "open2", "Empty1"]);

  // Every record still renders, now under its group.
  await expect(page.getByTestId("grid-row")).toHaveCount(4);
});

test("collapsing a group hides its rows and keeps its header and count", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();
  await page.goto(`/app/t/${tableId}`);
  await groupBy(page, "Status");
  await expect(headers(page)).toHaveCount(3);

  await headers(page).filter({ hasText: "open" }).getByRole("button").click();

  // The two `open` rows go; the header stays, still reporting 2. A collapsed group
  // that forgot its count would be a group you cannot reason about.
  await expect(page.getByTestId("grid-row")).toHaveCount(2);
  await expect(headers(page)).toHaveCount(3);
  await expect(headers(page).filter({ hasText: "open" })).toContainText("2");
  await expect(headers(page).filter({ hasText: "open" }).getByRole("button"))
    .toHaveAttribute("aria-expanded", "false");
});

test("the counts describe the filtered set, not the page", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();
  await page.goto(`/app/t/${tableId}`);
  await groupBy(page, "Status");
  await expect(headers(page)).toHaveCount(3);

  // Search narrows to one record. The group list must narrow with it — counts
  // computed over the loaded window would be right by accident here; these come
  // from swamp_group_counts over the searched set.
  await page.getByPlaceholder("Search…").fill("three");

  await expect.poll(async () => (await headers(page).allTextContents()).map((h) => h.trim()))
    .toEqual(["closed1"]);
  await expect(page.getByTestId("grid-row")).toHaveCount(1);
});

test("grouping persists to the view", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();
  await page.goto(`/app/t/${tableId}`);
  await groupBy(page, "Status");
  await expect(headers(page)).toHaveCount(3);

  // It is view config, not local state — group_by lives on view_fields and was
  // write-only-false until now.
  await page.reload();
  await expect(headers(page)).toHaveCount(3);
});

test("a multiSelect is not offered — you could not ask for its rows", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();
  await page.goto(`/app/t/${tableId}`);

  await page.getByRole("button", { name: /^Group$/ }).click();
  await page.getByRole("dialog").getByRole("combobox").click();

  // A group is only useful if you can then ask for its rows, and that ask is an
  // `eq` filter — not a membership test on a jsonb array. SQL refuses it too; this
  // is the half that stops you trying.
  await expect(page.getByRole("option", { name: "Tags", exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Status", exact: true })).toBeVisible();
});

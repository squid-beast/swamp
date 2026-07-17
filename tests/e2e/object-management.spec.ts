import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// ════════════════════════════════════════════════════════════════════════════
// End to end: create, rename and delete a table from the sidebar.
//
// These routes are new, but the functions behind them are not — `createTable`,
// `updateTable` and `deleteTable` sat in the data layer with ZERO callers since
// the schema rebuild, which means they had never run. An unused write path looks
// exactly like a working one.
//
// It wasn't: createTable made a table and a default view but no FIELD, and the
// query engine refuses a fieldless table outright — the grid renders
// "table … not found, has no fields, or you cannot read it" instead of a table.
// Nothing caught it, because you have to open the thing to find out. That is what
// the first test here is for, and why it asserts on the grid rather than on a row
// count in Postgres.
// ════════════════════════════════════════════════════════════════════════════

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  if (!/127\.0\.0\.1|localhost/.test(URL)) {
    throw new Error(`[swamp] e2e is pointed at ${URL}. It must only run against local.`);
  }
  return createClient(URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const email = `e2e-om-${randomUUID()}@swamp.test`;
const password = randomUUID();
let userId: string;

test.beforeAll(async () => {
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user!.id;
});

test.afterAll(async () => {
  // Cascades everything the user made.
  if (userId) await admin().auth.admin.deleteUser(userId);
});

async function signIn(page: Page) {
  await page.goto("/auth/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);

  const first = page.getByLabel(/first name/i);
  if (await first.isVisible().catch(() => false)) {
    await first.fill("E2E");
    await page.getByLabel(/last name/i).fill("Tester");
    await page.getByRole("button", { name: /continue/i }).click();
  }
}

// One test, one journey. Three separate tests each bootstrapping their own base
// left the account with a pile of them and started timing out on a crowded
// overview — and create/rename/delete is one story anyway, the same shape
// table.spec.ts uses.
test("create, rename and delete a table from the sidebar", async ({ page }) => {
  await signIn(page);

  // A base to work in. The sidebar's "New base" reads its workspace id off an
  // existing base, so bootstrap through the overview's blank template.
  await page.goto("/app");
  await page.getByRole("button", { name: /blank base/i }).click();
  await page.waitForURL(/\/app\/t\/[0-9a-f-]{36}/);

  // ── Create ── ("New table" is the + row in the tree, and it makes a table.
  // It used to be a link to the import screen.)
  await page.getByRole("button", { name: "New table" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Invoices");
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.waitForURL(/\/app\/t\/[0-9a-f-]{36}/);

  // Assert the grid RENDERED, positively. `expect(has-no-fields).toHaveCount(0)`
  // was the obvious way to write this and it's near worthless — it passes just as
  // happily on a blank page as on a working one. The default primary field being
  // on screen is the thing that is actually false when the bug comes back.
  await expect(page.getByRole("button", { name: "Name", exact: true })).toBeVisible();
  await expect(page.getByText("0 rows")).toBeVisible();
  await expect(page.getByText(/has no fields/i)).toHaveCount(0);

  // Two matches, deliberately: the sidebar link and the breadcrumb.
  await expect(page.getByRole("link", { name: "Invoices" })).toHaveCount(2);

  // ── Rename ── (the Invoices row is the second table in the tree)
  await page.getByRole("button", { name: /table actions/i }).nth(1).click();
  await page.getByRole("menuitem", { name: /rename/i }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Renamed Table");
  await page.getByRole("button", { name: /^save$/i }).click();

  // Both come from the server tree, so this proves router.refresh() propagated
  // rather than local state simply being mutated.
  await expect(page.getByRole("link", { name: "Renamed Table" })).toHaveCount(2);

  // ── Delete ──
  await page.getByRole("button", { name: /table actions/i }).nth(1).click();
  await page.getByRole("menuitem", { name: /delete/i }).click();
  await page.getByRole("button", { name: /^delete$/i }).click();

  await expect(page.getByRole("link", { name: "Renamed Table" })).toHaveCount(0);
});

import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// ════════════════════════════════════════════════════════════════════════════
// The people-and-time field types, end to end.
//
// `user`, `createdBy`, `modifiedBy`, `createdTime` and `modifiedTime` were in
// FIELD_TYPES and in the SQL enum from the start, and passed createFieldSchema —
// so they were creatable with curl and simply absent from the field dialog. The
// query engine has always projected them (platform.sql:1611). Nothing was missing
// but the offer and a renderer.
//
// Which is exactly why this file drives a browser. Two of the three things that
// were actually broken here are invisible to the database:
//
//   1. createdBy stores a UUID. Rendering a NAME needs the base roster, and the
//      roster needs swamp_visible_profiles — before that existed, "profiles: read
//      own" meant you could resolve exactly one person: yourself.
//   2. A realtime UPDATE carries the raw `records.data` column, which holds only
//      stored scalars. The grid used to REPLACE the record with it, blanking every
//      computed key — formula, rollup, lookup, count, and these four — the instant
//      anyone touched the row. An integration test cannot see that; it is a bug
//      about what is on screen.
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

const email = `e2e-ft-${randomUUID()}@swamp.test`;
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
  if (userId) await admin().auth.admin.deleteUser(userId);
});

async function signIn(page: Page) {
  // Decline cookies BEFORE the first paint.
  //
  // The banner is `fixed inset-x-0 bottom-0 z-[60]`, which is exactly where "New
  // row" sits, and Playwright reports it as "subtree intercepts pointer events" —
  // the button is visible and stable and simply unclickable. Clicking "Reject all"
  // after each navigation works until it doesn't; seeding the same localStorage key
  // the component reads (cookie-consent.tsx:33) is deterministic. Declining also
  // keeps analytics off, which is the right default for a test.
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
    await first.fill("Ada");
    await page.getByLabel(/last name/i).fill("Lovelace");
    await page.getByRole("button", { name: /continue/i }).click();
  }

}

/** Unwrap or throw. Every arrange step goes through this — an unchecked insert
 *  that silently does nothing is how a table with no fields shipped in the first
 *  place, and a seed that half-works produces a test failure pointing at the
 *  feature instead of at itself. */
function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`seed: ${res.error.message}`);
  if (res.data === null) throw new Error("seed: no data returned");
  return res.data;
}

/** A base with a table, plus the fields under test. Built through the admin client
 *  because the point of this file is what the GRID does with them. */
async function seed(): Promise<string> {
  const db = admin();

  const ws = must(
    await db.from("workspace_members").select("workspace_id").eq("user_id", userId).single()
  ) as { workspace_id: string };

  const base = must(
    await db
      .from("bases")
      .insert({ workspace_id: ws.workspace_id, name: "Field types" })
      .select()
      .single()
  ) as { id: string };

  const table = must(
    await db.from("tables").insert({ base_id: base.id, name: "T" }).select().single()
  ) as { id: string };

  // `is_primary` on EVERY row, not just the first.
  //
  // PostgREST's bulk insert unions the keys across the array and sends one
  // multi-VALUES statement, so a key present on any row becomes a column for all of
  // them — and the rows that omitted it get NULL, not the column's default. Omitting
  // is_primary on rows 2-4 therefore fails the NOT NULL, and the WHOLE batch rolls
  // back. It cost a while to find, because the seed swallowed the error and the test
  // then failed pointing at the grid.
  must(
    await db
      .from("fields")
      .insert([
        { table_id: table.id, base_id: base.id, name: "Name", key: "fld_name", type: "text", is_primary: true, sort_order: 1 },
        { table_id: table.id, base_id: base.id, name: "Owner", key: "fld_owner", type: "user", is_primary: false, sort_order: 2 },
        { table_id: table.id, base_id: base.id, name: "Created by", key: "fld_cby", type: "createdBy", is_primary: false, sort_order: 3 },
        { table_id: table.id, base_id: base.id, name: "Created", key: "fld_cat", type: "createdTime", is_primary: false, sort_order: 4 },
      ])
      .select()
  );

  must(
    await db
      .from("views")
      .insert({ table_id: table.id, base_id: base.id, type: "grid", name: "Grid", is_default: true })
      .select()
      .single()
  );

  return table.id;
}

test("createdBy shows a name, createdTime reads like a date, and neither blanks on a realtime update", async ({
  page,
}) => {
  await signIn(page);
  const tableId = await seed();

  await page.goto(`/app/t/${tableId}`);

  // A row created through the UI, so the database stamps created_by with a real uid.
  await page.getByRole("button", { name: /new row/i }).click();
  const row = page.getByTestId("grid-row").first();
  await expect(row).toBeVisible();

  const cell = (n: number) => row.getByTestId("grid-cell").nth(n);

  // createdBy resolved the uuid to a name. This is the whole reason
  // swamp_visible_profiles exists — without it this cell reads "Someone".
  await expect(cell(2)).toContainText("Ada Lovelace");

  // createdTime formatted. The stored value is "2026-07-16T17:12:15.282397+00:00";
  // rendering that verbatim is a value and not an answer.
  await expect(cell(3)).toContainText(/\d{1,2}\/\d{1,2}\/\d{4}/);
  await expect(cell(3)).not.toContainText("T17:");

  // ── The realtime regression ──
  //
  // Change the row from OUTSIDE this browser. That is a genuine postgres_changes
  // event carrying raw `data` — no computed keys in it at all. The grid used to
  // replace the record wholesale and blank both cells above.
  const { data: rec } = await admin()
    .from("records")
    .select("id, data")
    .eq("table_id", tableId)
    .single();

  await admin()
    .from("records")
    .update({ data: { ...(rec!.data as object), fld_name: "changed elsewhere" } })
    .eq("id", rec!.id);

  // The edit lands...
  await expect(cell(0)).toContainText("changed elsewhere", { timeout: 10_000 });

  // ...and the computed columns are still there. Asserted AFTER the arrival, so
  // this cannot pass just because the event never fired.
  await expect(cell(2)).toContainText("Ada Lovelace");
  await expect(cell(3)).toContainText(/\d{1,2}\/\d{1,2}\/\d{4}/);
});

test("the user field offers the base roster and stores the pick", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();

  // Wait for the roster BEFORE opening the menu.
  //
  // UserCell fetches the roster when the cell mounts and renders "No members" until
  // it resolves. Open the menu first and the content swaps from empty to a list
  // underneath it, Radix repositions, and the item never becomes "stable" — the
  // click then times out having already passed toBeVisible(), which is a confusing
  // way to fail. Awaiting the response first means the menu opens populated.
  const roster = page.waitForResponse(
    (r) => r.url().includes("/members") && r.status() === 200
  );

  await page.goto(`/app/t/${tableId}`);
  await page.getByRole("button", { name: /new row/i }).click();
  await roster;

  const row = page.getByTestId("grid-row").first();
  await row.getByTestId("grid-cell").nth(1).click();

  // The roster comes from /api/bases/[id]/members -> listMembers -> the profiles
  // function. An empty menu here means the roster is unreadable again — which is
  // what this locator asserts, and it is the point of the test.
  const item = page.getByRole("menuitem", { name: /Ada Lovelace/ });
  await expect(item).toBeVisible();

  // force: true, deliberately. Playwright additionally waits for an element to be
  // "stable" (same box two frames running) and this one never is: it sits in a
  // Radix popover anchored to a cell inside a virtualised, realtime-subscribed
  // grid, so something re-renders under it often enough that the check loses on a
  // slow run. Visibility and the accessible name are already asserted above — the
  // thing being tested — and Radix's own repositioning is not.
  await item.click({ force: true });

  await expect(row.getByTestId("grid-cell").nth(1)).toContainText("Ada Lovelace");

  // And it persisted, rather than only looking right.
  await page.reload();
  await expect(
    page.getByTestId("grid-row").first().getByTestId("grid-cell").nth(1)
  ).toContainText("Ada Lovelace");
});

test("field order persists per view, and survives hiding a field", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();

  await page.goto(`/app/t/${tableId}`);

  // Poll, never read-and-assert: the grid renders after its first fetch, so a bare
  // read right after goto() returns [] and the failure blames the feature.
  //
  // By data-testid, not by role+name. The header's "— click to edit" is a `title`
  // (grid.tsx:237), and title is only a FALLBACK for the accessible name — the
  // button has text, so its name is just "Name". Matching /click to edit/ finds
  // nothing at all.
  const headers = async () =>
    (await page.getByTestId("grid-header").allTextContents()).map((h) => h.trim());

  await expect.poll(headers).toEqual(["Name", "Owner", "Created by", "Created"]);

  // Drag "Created" (last) up onto "Owner" (second).
  await page.getByRole("button", { name: /^Fields$/ }).click();
  const list = page.locator("[data-radix-popper-content-wrapper] label");
  // Drag by the grip — the row itself is not draggable, so that a click still
  // reaches the checkbox inside it.
  await list.nth(3).getByLabel("Reorder Created").dragTo(list.nth(1));
  await page.keyboard.press("Escape");

  await expect.poll(headers).toEqual(["Name", "Created", "Owner", "Created by"]);

  // It persisted server-side, not just in local state.
  await page.reload();
  await expect.poll(headers).toEqual(["Name", "Created", "Owner", "Created by"]);

  // The trap this whole change exists for: order lives on the VIEW, and hiding a
  // field writes a view_fields row. The old PATCH /api/tables/[id]/fields wrote
  // fields.sort_order instead, which the grid only consults as a FALLBACK when a
  // field has no view_fields row — so a UI wired to it would have worked until the
  // first hide and then silently stopped. Hide something and confirm the order the
  // user set is still the order they get.
  await page.getByRole("button", { name: /^Fields$/ }).click();
  // click(), not uncheck(). The checkbox is CONTROLLED by `hidden`, which only
  // changes after patchConfig round-trips to the server — uncheck() clicks and
  // verifies the new state immediately, so it always loses that race.
  await page
    .locator("[data-radix-popper-content-wrapper] label")
    .nth(2)
    .locator("input[type=checkbox]")
    .click();
  await page.keyboard.press("Escape");

  await expect.poll(headers).toEqual(["Name", "Created", "Created by"]);

  await page.reload();
  await expect.poll(headers).toEqual(["Name", "Created", "Created by"]);
});

test("duplicate copies a record's values and drops what it must", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();

  await page.goto(`/app/t/${tableId}`);
  await page.getByRole("button", { name: /new row/i }).click();

  // Give it a value worth copying.
  const first = page.getByTestId("grid-row").first();
  await first.getByTestId("grid-cell").nth(0).click();
  await page.keyboard.type("original");
  await page.keyboard.press("Enter");

  // Count the rows themselves rather than the "N rows" copy, which is a label and
  // could be reworded tomorrow.
  await expect(page.getByTestId("grid-row")).toHaveCount(1);
  await expect(first.getByTestId("grid-cell").nth(0)).toContainText("original");

  // Expand it and duplicate. Space only toggles a boolean cell (use-grid.ts:472);
  // the row's context menu is the reliable way in.
  await first.getByTestId("grid-cell").nth(0).click({ button: "right" });
  await page.getByRole("menuitem", { name: /expand record/i }).click();
  await page.getByRole("button", { name: /duplicate record/i }).click();

  const rows = page.getByTestId("grid-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByTestId("grid-cell").nth(0)).toContainText("original");

  // createdBy/createdTime are stamped fresh by the database on the copy rather than
  // carried over — sanitizeValues refuses every read-only type, so they can't be.
  await expect(rows.nth(1).getByTestId("grid-cell").nth(2)).toContainText("Ada Lovelace");
});

test("a copied record link opens that record", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  const tableId = await seed();

  await page.goto(`/app/t/${tableId}`);
  await page.getByRole("button", { name: /new row/i }).click();

  const first = page.getByTestId("grid-row").first();
  await first.getByTestId("grid-cell").nth(0).click();
  await page.keyboard.type("findable");
  await page.keyboard.press("Enter");

  await first.getByTestId("grid-cell").nth(0).click({ button: "right" });
  await page.getByRole("menuitem", { name: /expand record/i }).click();
  await page.getByRole("button", { name: /copy link to this record/i }).click();

  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\?record=[0-9a-f-]{36}$/);

  // The bug: this button has always produced that URL, and nothing read it. Going
  // there landed on a plain grid with no record open, and the "Link copied" toast
  // was the only part that worked.
  await page.goto(url);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("findable");
});

test("a record link the view cannot show says so instead of doing nothing", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();

  // A real uuid that is not a record in this table. Silence here is the original
  // bug wearing a different hat.
  await page.goto(`/app/t/${tableId}?record=00000000-0000-0000-0000-000000000000`);

  await expect(page.getByText(/isn't in this view/i)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("barcode and QR draw the field they point at", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();
  const db = admin();

  const { data: src } = await db
    .from("fields")
    .select("id, base_id")
    .eq("table_id", tableId)
    .eq("key", "fld_name")
    .single();

  must(
    await db
      .from("fields")
      .insert([
        {
          table_id: tableId,
          base_id: src!.base_id,
          name: "Code",
          key: "fld_bc",
          type: "barcode",
          options: { sourceFieldId: src!.id, barcodeFormat: "CODE128" },
          is_primary: false,
          sort_order: 5,
        },
        {
          table_id: tableId,
          base_id: src!.base_id,
          name: "QR",
          key: "fld_qr",
          type: "qr",
          // No source on purpose — an unconfigured barcode must be BLANK, not an
          // error and not a crash.
          options: {},
          is_primary: false,
          sort_order: 6,
        },
      ])
      .select()
  );

  await page.goto(`/app/t/${tableId}`);
  await page.getByRole("button", { name: /new row/i }).click();

  const row = page.getByTestId("grid-row").first();
  await row.getByTestId("grid-cell").nth(0).click();
  await page.keyboard.type("ABC-123");
  await page.keyboard.press("Enter");

  // The source-less QR is blank right now, and nothing was thrown. Assert that
  // BEFORE the reload, while the row is definitely on screen.
  await expect(row.getByTestId("grid-cell").nth(5).locator("img")).toHaveCount(0);

  // Point the QR at the same field.
  await db
    .from("fields")
    .update({ options: { sourceFieldId: src!.id } })
    .eq("table_id", tableId)
    .eq("key", "fld_qr");

  // NO reload. This used to need one: a barcode's value is computed by the query
  // engine from the field it points at, and typing into that field recomputed
  // nothing client-side, so the cell stayed blank until the next fetch. The write
  // path now returns what it recomputed, so the barcode appears as you type — and
  // this assertion is what proves it, because without the fix it is blank here.
  const after = page.getByTestId("grid-row").first();

  // Assert on the BARS: jsbarcode emits one <rect> per bar, so a non-zero count is
  // the only proof that something scannable exists rather than an empty <svg>.
  const bars = after.getByTestId("grid-cell").nth(4).locator("svg[role=img] rect");
  await expect.poll(async () => await bars.count()).toBeGreaterThan(10);

  await expect(
    after.getByTestId("grid-cell").nth(4).locator("svg[role=img]")
  ).toHaveAttribute("aria-label", "Barcode for ABC-123");

  const qr = after.getByTestId("grid-cell").nth(5).locator("img");
  await expect(qr).toHaveAttribute("alt", "QR code for ABC-123");
  expect(await qr.getAttribute("src")).toMatch(/^data:image\/png/);
});

test("a barcode says so when the value doesn't fit the format", async ({ page }) => {
  await signIn(page);
  const tableId = await seed();
  const db = admin();

  const { data: src } = await db
    .from("fields")
    .select("id, base_id")
    .eq("table_id", tableId)
    .eq("key", "fld_name")
    .single();

  // EAN13 wants 13 digits. Letters are a thing a user will absolutely do, and
  // jsbarcode throws — which must become a message, not a broken grid.
  must(
    await db
      .from("fields")
      .insert({
        table_id: tableId,
        base_id: src!.base_id,
        name: "Code",
        key: "fld_bc",
        type: "barcode",
        options: { sourceFieldId: src!.id, barcodeFormat: "EAN13" },
        is_primary: false,
        sort_order: 5,
      })
      .select()
  );

  await page.goto(`/app/t/${tableId}`);
  await page.getByRole("button", { name: /new row/i }).click();

  const row = page.getByTestId("grid-row").first();
  await row.getByTestId("grid-cell").nth(0).click();
  await page.keyboard.type("not-an-ean");
  await page.keyboard.press("Enter");

  // No reload — the write now returns the recomputed barcode value, so the format
  // error surfaces as you type.
  await expect(
    page.getByTestId("grid-row").first().getByTestId("grid-cell").nth(4)
  ).toContainText("Not a valid EAN13");
});

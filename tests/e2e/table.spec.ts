import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

// ════════════════════════════════════════════════════════════════════════════
// End to end: sign up, import a CSV, and drive the grid.
//
// This is the only test that proves the pieces fit together. The integration
// tests prove the database is right; the unit tests prove the pure functions are
// right; neither notices if the API route sends `spec` where the handler reads
// `query`.
//
// No seed data. The test creates its own user and its own CSV, and deletes the
// user at the end — which cascades everything they made.
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

const email = `e2e-${randomUUID()}@swamp.test`;
const password = randomUUID();
let userId: string;

/**
 * A CSV with the awkward values on purpose.
 *
 * ── Why eleven rows, and not the four this used to have ──
 *
 * Because inference has thresholds, and four rows sat on the wrong side of both —
 * so this test was asserting on a table whose columns had NOT been inferred the way
 * its comments claimed. It was fixture rot, not a product bug:
 *
 *   • Status → singleSelect needs `totalRows >= 6` (engine/inference.ts:179). With
 *     four rows Status inferred as plain TEXT, so the filter builder rendered a text
 *     <Input> where the test looked for a combobox, and the test hung on a control
 *     that was never going to appear.
 *
 *   • Amount → number needs `ratio(values, RE.number) > 0.9` (inference.ts:84).
 *     One "N/A" in four rows is 0.75 — so Amount was TEXT too, and "banana" was a
 *     perfectly valid value in it. With ten numeric rows against one "N/A" it is
 *     10/11 = 0.909, which clears it.
 *
 *   • Amount → CURRENCY additionally needs money-SHAPED values: `RE.money`
 *     (inference.ts:17) wants a symbol, two decimals, or thousands grouping, and
 *     bare "1000" has none of them (inference.ts:142). So Amount could never have
 *     been a currency here whatever the row count — this file's comments claimed it
 *     was for as long as they have existed. Hence "1000.00": two decimals, which is
 *     what actually makes it money.
 *
 * So both the row count and the decimal points are load-bearing. Keep exactly one
 * "N/A", at least ten numeric rows, and the 2dp — or Amount quietly degrades to
 * number or text and the assertions below start proving nothing.
 *
 * Exactly one row is `closed` — the Status filter asserts it narrows to that one.
 * Only Acme contains "acme", so the search assertion stays honest too.
 */
const CSV = [
  "Name,Amount,Status,Due",
  "Acme,1000.00,open,2026-08-01",
  "Beta,500.00,open,2026-07-01",
  "Ceres,2500.00,closed,2026-09-01",
  "Echo,750.00,open,2026-07-15",
  "Foxtrot,1250.00,open,2026-08-20",
  "Golf,300.00,open,2026-09-10",
  "Hotel,4000.00,open,2026-10-01",
  "India,150.00,open,2026-07-22",
  "Juliet,2200.00,open,2026-11-05",
  "Kilo,880.00,open,2026-08-30",
  // "N/A" in a currency column. A naive ::numeric cast throws on this and takes
  // the whole query down. It must import, render, and simply not match a numeric
  // filter. Due is empty here too — an empty date must not become "now".
  "Delta,N/A,open,",
].join("\n");

/** Data rows in CSV, minus the header. The grid must show every one. */
const ROW_COUNT = CSV.split("\n").length - 1;

let csvPath: string;

test.beforeAll(async () => {
  csvPath = path.join(os.tmpdir(), `swamp-e2e-${randomUUID()}.csv`);
  fs.writeFileSync(csvPath, CSV);

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
  if (csvPath && fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
});

async function signIn(page: Page) {
  await page.goto("/auth/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);

  // First run asks for a name before it will let you past.
  const first = page.getByLabel(/first name/i);
  if (await first.isVisible().catch(() => false)) {
    await first.fill("E2E");
    await page.getByLabel(/last name/i).fill("Tester");
    await page.getByRole("button", { name: /continue/i }).click();
  }
}

test("import a CSV, then filter, sort and edit the grid", async ({ page }) => {
  await signIn(page);

  // ── Import ──
  await page.goto("/app/import");
  await page.setInputFiles('input[type="file"]', csvPath);
  await page.getByRole("button", { name: /^import$/i }).click();

  await page.waitForURL(/\/app\/t\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("grid-row")).toHaveCount(ROW_COUNT);

  // Inference should have made Amount a currency and Status a select. The proof
  // is the toolbar offering type-appropriate operators, which we check below.
  await expect(page.getByText("Acme")).toBeVisible();
  await expect(page.getByText("Delta")).toBeVisible();

  // "N/A" imported into a currency column and rendered as-is, rather than being
  // silently turned into a number or blowing up the query.
  await expect(page.getByText("N/A")).toBeVisible();

  // ── Search (server-side) ──
  await page.getByPlaceholder("Search…").fill("acme");
  await expect(page.getByTestId("grid-row")).toHaveCount(1);
  await page.getByPlaceholder("Search…").clear();
  await expect(page.getByTestId("grid-row")).toHaveCount(ROW_COUNT);

  // ── Filter ──
  await page.getByRole("button", { name: /^filter$/i }).click();
  await page.getByRole("button", { name: /add condition/i }).click();

  // Field defaults to the first (Name). Switch it to Status.
  const selects = page.locator('[role="combobox"]');
  await selects.nth(0).click();
  await page.getByRole("option", { name: "Status" }).click();

  // Operator list for a select field must offer "is any of" and must NOT offer
  // "is checked" — operators are gated by type.
  await selects.nth(1).click();
  await expect(page.getByRole("option", { name: /is checked/i })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Value
  await selects.nth(2).click();
  await page.getByRole("option", { name: "closed" }).click();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("grid-row")).toHaveCount(1);
  await expect(page.getByText("Ceres")).toBeVisible();

  // The filter persisted to the view — a reload must not lose it. This is the
  // whole point of view config living in the database rather than in useState.
  await page.reload();
  await expect(page.getByTestId("grid-row")).toHaveCount(1);
});

test("edit a cell, and reject an invalid value", async ({ page }) => {
  await signIn(page);

  // Land on the table imported by the previous test — the sidebar has it.
  await page.goto("/app");
  await page.getByRole("link", { name: /swamp-e2e|imported/i }).first().click().catch(async () => {
    // Fall back to the command menu if the base name doesn't match.
    await page.keyboard.press("Meta+k");
    await page.keyboard.press("Enter");
  });

  await page.waitForURL(/\/app\/t\//);

  // ── The UI will not let you type it ──
  //
  // Amount is a currency, and currency renders <input type="number">
  // (components/cell.tsx:170). A number input silently discards non-numeric
  // keystrokes, so "banana" never becomes a value.
  //
  // This test used to type "banana" here and wait for an "Enter a number" toast that
  // could not arrive, and it had been failing ever since. Two separate reasons, both
  // worth keeping in mind:
  //   1. the keystrokes go nowhere, so nothing is ever sent;
  //   2. the CSV was small enough that Amount inferred as TEXT rather than currency
  //      (see the CSV note above), where "banana" is a perfectly valid value.
  // The assertion was unreachable through the UI either way.
  const cell = page.getByTestId("grid-row").first().getByTestId("grid-cell").nth(1);
  await cell.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("banana");
  await page.keyboard.press("Enter");

  await expect(cell).not.toContainText("banana");

  // ── The API rejects it anyway ──
  //
  // Which is the claim actually worth testing: "client-side validation is a UX
  // affordance; the API is the boundary". A number input is trivially bypassed —
  // curl, a stale tab, our own REST API — so the guard that matters is the one in
  // repo.ts:335, and only this half proves it is there.
  //
  // fetch() from the page so the session cookie rides along, exactly as the grid's
  // own writes do.
  // Pulled out with a regex rather than `new URL(...)`: this file shadows the global
  // URL with `const URL = process.env.NEXT_PUBLIC_SUPABASE_URL` at the top.
  const tableId = page.url().match(/\/app\/t\/([0-9a-f-]{36})/)![1];

  // Reading rows is a POST with a query spec — filtering and paging execute in
  // Postgres, so the spec is a body, not a querystring.
  const recordId = await page.evaluate(async (id) => {
    const res = await fetch(`/api/tables/${id}/records`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec: { limit: 1 } }),
    });
    const body = await res.json();
    return body.records?.[0]?.id ?? null;
  }, tableId);

  expect(recordId, "needed a record to patch").not.toBeNull();

  const amountKey = await page.evaluate(async (id) => {
    const res = await fetch(`/api/tables/${id}/fields`);
    const body = await res.json();
    const f = (body.fields ?? []).find(
      (x: { name: string; type: string }) => x.type === "currency"
    );
    return f?.key ?? null;
  }, tableId);

  // If this is null, inference stopped making Amount a currency and the CSV note
  // above needs re-reading — the test would otherwise pass while proving nothing.
  expect(amountKey, "Amount must infer as currency for this test to mean anything").not.toBeNull();

  const rejection = await page.evaluate(
    async ({ id, recordId, key }) => {
      const res = await fetch(`/api/tables/${id}/records`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patches: [{ id: recordId, values: { [key]: "banana" } }] }),
      });
      return { status: res.status, body: await res.json() };
    },
    { id: tableId, recordId, key: amountKey }
  );

  expect(rejection.status).toBe(400);
  expect(JSON.stringify(rejection.body)).toMatch(/enter a number/i);
});

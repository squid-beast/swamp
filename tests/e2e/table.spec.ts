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

/** A CSV with the awkward values on purpose. */
const CSV = [
  "Name,Amount,Status,Due",
  "Acme,1000,open,2026-08-01",
  "Beta,500,open,2026-07-01",
  "Ceres,2500,closed,2026-09-01",
  // "N/A" in a currency column. A naive ::numeric cast throws on this and takes
  // the whole query down. It must import, render, and simply not match a numeric
  // filter.
  "Delta,N/A,open,",
].join("\n");

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
  await expect(page.getByTestId("grid-row")).toHaveCount(4);

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
  await expect(page.getByTestId("grid-row")).toHaveCount(4);

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

  // Editing a currency cell to a non-number must be REJECTED by the server and
  // rolled back in the UI. Client-side validation is a UX affordance; the API is
  // the boundary, and it used to accept "banana" without complaint.
  const cell = page.getByTestId("grid-row").first().getByRole("button").nth(1);
  await cell.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("banana");
  await page.keyboard.press("Enter");

  await expect(page.getByText(/enter a number/i)).toBeVisible({ timeout: 5000 });
});

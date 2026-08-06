import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

// ════════════════════════════════════════════════════════════════════════════
// Phase 3 in a real browser: keyboard, selection, clipboard, fill, undo.
//
// None of this can be tested anywhere else. The command stack has unit tests and
// the clipboard has unit tests, but "does Tab wrap to the next row" and "does
// ⌘Z actually put the old value back on screen" only have one honest answer, and
// it involves a browser.
// ════════════════════════════════════════════════════════════════════════════

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  if (!/127\.0\.0\.1|localhost/.test(URL)) {
    throw new Error(`[swamp] e2e is pointed at ${URL}. Local only.`);
  }
  return createClient(URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const email = `e2e-kbd-${randomUUID()}@swamp.test`;
const password = randomUUID();
let userId: string;
let csvPath: string;

const CSV = [
  "Name,Qty,Note",
  "Alpha,1,first",
  "Bravo,2,second",
  "Charlie,3,third",
  "Delta,4,fourth",
].join("\n");

test.beforeAll(async () => {
  csvPath = path.join(os.tmpdir(), `swamp-kbd-${randomUUID()}.csv`);
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

async function setup(page: Page) {
  await page.goto("/auth/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);

  const first = page.getByLabel(/first name/i);
  if (await first.isVisible().catch(() => false)) {
    await first.fill("Kbd");
    await page.getByLabel(/last name/i).fill("Tester");
    await page.getByRole("button", { name: /continue/i }).click();
  }

  await page.goto("/app/import");
  await page.setInputFiles('input[type="file"]', csvPath);
  // Import is TWO steps: read the file ("Continue"), then choose where it lands.
  // In the default "New table" mode that second button reads "Create table" —
  // "Import" is the EXISTING-table label. This helper predated the destination
  // step (added 2026-07-17) and clicked straight for "Import", so every spec
  // that imports has been timing out at 60s ever since.
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByRole("button", { name: /^create table$/i }).click();
  await page.waitForURL(/\/app\/t\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("grid-row")).toHaveCount(4);
}

/** The cell at (row, col) — 0-indexed, excluding the gutter. */
function cellAt(page: Page, row: number, col: number) {
  return page.getByTestId("grid-row").nth(row).getByTestId("grid-cell").nth(col);
}

test("arrow keys and Tab move the active cell, and Tab wraps", async ({ page }) => {
  await setup(page);

  await cellAt(page, 0, 0).click();
  await expect(cellAt(page, 0, 0)).toHaveClass(/outline-brand/);

  await page.keyboard.press("ArrowDown");
  await expect(cellAt(page, 1, 0)).toHaveClass(/outline-brand/);

  await page.keyboard.press("ArrowRight");
  await expect(cellAt(page, 1, 1)).toHaveClass(/outline-brand/);

  // Tab past the LAST column wraps to the start of the next row. A Tab that just
  // stops at the right edge makes data entry miserable.
  await page.keyboard.press("Tab"); // → col 2 (last)
  await page.keyboard.press("Tab"); // → wraps to row 2, col 0
  await expect(cellAt(page, 2, 0)).toHaveClass(/outline-brand/);
});

test("type-to-replace: the first keystroke replaces, it does not append", async ({ page }) => {
  await setup(page);

  // Qty on row 0 holds "1". Typing "9" must give "9", not "19".
  await cellAt(page, 0, 1).click();
  await page.keyboard.type("9");
  await page.keyboard.press("Enter");

  await expect(cellAt(page, 0, 1)).toContainText("9");
  await expect(cellAt(page, 0, 1)).not.toContainText("19");
});

test("Escape reverts an in-progress edit", async ({ page }) => {
  await setup(page);

  await cellAt(page, 0, 0).click();
  await page.keyboard.press("Enter"); // open the editor
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Wrecked");
  await page.keyboard.press("Escape");

  // A cell that commits on Escape is a cell that eats work.
  await expect(cellAt(page, 0, 0)).toContainText("Alpha");
  await expect(cellAt(page, 0, 0)).not.toContainText("Wrecked");
});

test("shift+arrow extends a range, and Delete clears it", async ({ page }) => {
  await setup(page);

  await cellAt(page, 0, 2).click(); // Note: "first"
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");

  await page.keyboard.press("Delete");

  await expect(cellAt(page, 0, 2)).toContainText("—");
  await expect(cellAt(page, 1, 2)).toContainText("—");
  await expect(cellAt(page, 2, 2)).toContainText("—");
  // Row 3 was outside the range and must be untouched.
  await expect(cellAt(page, 3, 2)).toContainText("fourth");
});

test("undo puts it back, and redo takes it away again", async ({ page }) => {
  await setup(page);

  await cellAt(page, 0, 0).click();
  await page.keyboard.type("Zulu");
  await page.keyboard.press("Enter");
  await expect(cellAt(page, 0, 0)).toContainText("Zulu");

  await page.keyboard.press("Meta+z");
  await expect(cellAt(page, 0, 0)).toContainText("Alpha");

  await page.keyboard.press("Meta+Shift+z");
  await expect(cellAt(page, 0, 0)).toContainText("Zulu");

  // And it PERSISTED — undo isn't just a local illusion; it wrote back.
  await page.reload();
  await expect(cellAt(page, 0, 0)).toContainText("Zulu");
});

test("undo restores a deleted row, in its original position", async ({ page }) => {
  await setup(page);

  await cellAt(page, 1, 0).click({ button: "right" });
  await page.getByRole("menuitem", { name: /delete row/i }).click();

  await expect(page.getByTestId("grid-row")).toHaveCount(3);
  await expect(page.getByText("Bravo")).toHaveCount(0);

  await page.keyboard.press("Meta+z");

  await expect(page.getByTestId("grid-row")).toHaveCount(4);
  // Back BETWEEN Alpha and Charlie — not appended to the end. Soft delete is what
  // makes this possible: the row was never gone, just tombstoned.
  await expect(cellAt(page, 1, 0)).toContainText("Bravo");
});

test("fill handle continues a numeric series", async ({ page }) => {
  await setup(page);

  // Qty = 1, 2 in rows 0–1. Drag the handle down: 3, 4 — not 1, 2 repeated.
  await cellAt(page, 0, 1).click();
  await page.keyboard.press("Shift+ArrowDown");

  const handle = page.getByTestId("fill-handle");
  await expect(handle).toBeVisible();

  const box = (await handle.boundingBox())!;
  const target = (await cellAt(page, 3, 1).boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  await expect(cellAt(page, 2, 1)).toContainText("3");
  await expect(cellAt(page, 3, 1)).toContainText("4");
});

test("a column resize persists to the view", async ({ page }) => {
  await setup(page);

  const header = page.getByTestId("grid-header").first();
  const before = (await header.boundingBox())!.width;

  const grip = page.getByTestId("col-resize").first();
  const box = (await grip.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = (await header.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 50);

  // The write is debounced by 400ms. Wait, then reload — the width lives on the
  // VIEW, so it must survive.
  await page.waitForTimeout(800);
  await page.reload();

  const reloaded = (await page.getByTestId("grid-header").first().boundingBox())!.width;
  expect(reloaded).toBeGreaterThan(before + 50);
});

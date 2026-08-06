import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression — Vercel Cron invokes with GET, and both scheduled routes only
// exported POST. Every scheduled invocation 405'd; the jobs never ran, and
// nothing noticed because a cron has no user to complain. This is the whole
// check that bug needed and never had.

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

describe("cron routes answer GET", () => {
  beforeEach(() => {
    // env.ts throws at import on missing config, by design.
    vi.stubEnv(URL_VAR, "https://stub.supabase.co");
    vi.stubEnv(KEY_VAR, "stub-key");
    vi.resetModules();
  });

  const routes: Record<string, () => Promise<{ GET?: unknown }>> = {
    "/api/cron": () => import("@/app/api/cron/route"),
    "/api/webhooks/dispatch": () => import("@/app/api/webhooks/dispatch/route"),
    "/api/attachments/gc": () => import("@/app/api/attachments/gc/route"),
    "/api/sync": () => import("@/app/api/sync/route"),
  };

  for (const [path, load] of Object.entries(routes)) {
    it(`${path} exports GET`, async () => {
      const mod = await load();
      expect(typeof mod.GET).toBe("function");
    });
  }

  it("every vercel.json cron path is a known GET route", async () => {
    const { default: vercel } = await import("@/vercel.json");
    for (const cron of vercel.crons) {
      expect(routes, `${cron.path} is scheduled but not in this test's map`).toHaveProperty(
        cron.path
      );
    }
  });
});

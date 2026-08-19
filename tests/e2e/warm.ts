/**
 * Compile the dev server's routes before the suite runs.
 *
 * The e2e suite runs against `npm run dev`, and Next compiles a route the first
 * time it is requested. That cost lands on whichever test happens to touch the
 * route first, which is why a failure here moves between tests run to run and
 * disappears on the second run — 60s+ cold, ~18s warm, same code. It is a build
 * cost wearing a test's clothes, and the wrong fix is to keep raising timeouts
 * until it hides.
 *
 * A GET is enough to compile a route; the response doesn't matter. /app redirects
 * when signed out and the table id below doesn't exist — both still compile.
 *
 * (The real answer for CI is to run against `next build && next start`, where
 * nothing compiles on demand. This makes the local suite honest in the meantime.)
 */
/**
 * Delete what previous e2e runs left behind.
 *
 * Nothing cleaned up after the suite, and deleting the auth user doesn't reach
 * the data: `workspaces` has no owner column, so its rows (and every base, table
 * and record under them) survive their creator. One run orphaned ~23 bases and
 * ~70 records. That grows monotonically, the nav queries scan more each time,
 * and eventually a 5s `toHaveCount` goes over — which is why three consecutive
 * runs each failed a DIFFERENT test while every one of them passed in isolation.
 *
 * TARGETED, not a wipe. The suite signs up as `e2e-<uuid>@swamp.test`, so only
 * those accounts and the workspaces they belong to are removed. A developer's own
 * local data is never touched — which is the difference between a cleanup you can
 * leave switched on and one people disable.
 */
async function sweep() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "http://127.0.0.1:54321";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // No key: skip silently. The suite still runs; it just starts dirtier.
  if (!serviceKey) return;

  // Same guard the integration harness uses. This deletes users, so it must
  // never be able to point at a hosted project.
  const { hostname } = new URL(url);
  if (!["127.0.0.1", "localhost", "0.0.0.0"].includes(hostname)) {
    throw new Error(
      `[swamp] e2e cleanup is pointed at ${url}. It DELETES users and must only ` +
        `ever run against the local stack. Fix NEXT_PUBLIC_SUPABASE_URL in .env.local.`
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Any e2e account a previous run left behind (one that died mid-way).
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const stale = (data?.users ?? []).filter((u) => u.email?.endsWith("@swamp.test"));

  for (const u of stale) {
    await db.auth.admin.deleteUser(u.id).catch(() => {
      // Already gone is not a failure worth stopping for.
    });
  }

  // 2. The actual leak: MEMBER-LESS workspaces.
  //
  // The suite deletes its own users when it finishes, and that cascades
  // `workspace_members` away — so the workspace survives with nobody in it, and
  // tracing from users (step 1) finds nothing to delete. That is why the first
  // version of this sweep removed the account and left 51 workspaces standing.
  //
  // A workspace with zero members cannot be opened by anyone: every read goes
  // through swamp_workspace_role, which reads membership. It is unreachable by
  // construction, so removing it is safe for a developer's own data — theirs has
  // them in it. Bases, tables, records and links all cascade from here.
  const { data: live } = await db.from("workspace_members").select("workspace_id");
  const reachable = new Set((live ?? []).map((m) => m.workspace_id as string));

  const { data: all } = await db.from("workspaces").select("id");
  const orphaned = (all ?? []).map((w) => w.id as string).filter((id) => !reachable.has(id));

  if (orphaned.length) {
    // Chunked: a suite left running for a while can strand hundreds, and a URL
    // built from one `in` list has a length limit.
    for (let i = 0; i < orphaned.length; i += 100) {
      await db.from("workspaces").delete().in("id", orphaned.slice(i, i + 100));
    }
  }
}

async function warm() {
  const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";

  const nil = "00000000-0000-0000-0000-000000000000";

  // API routes compile on first request too, and warming only the pages left that
  // cost on whichever test wrote first. A GET to a POST-only route answers 405 —
  // and compiles it, which is the whole point.
  const routes = [
    "/auth/sign-in",
    "/app",
    // A uuid that resolves to nothing. notFound() still compiles the route.
    `/app/t/${nil}`,
    `/api/tables/${nil}/records`,
    `/api/tables/${nil}/fields`,
    `/api/tables/${nil}/views`,
    `/api/tables`,
    `/api/bases/${nil}/members`,
    `/api/views/${nil}/config`,
    `/api/records/${nil}/comments`,
  ];

  await Promise.all(
    routes.map((r) =>
      fetch(`${base}${r}`, { redirect: "manual" }).catch(() => {
        // A cold server can refuse the first connection. The suite's own waits
        // cover that; failing global setup over it would be worse than the flake.
      })
    )
  );
}

export default async function globalSetup() {
  // Sweep first: warming touches the routes the sweep is about to empty, and a
  // cold compile is cheaper than a compile against a polluted tree.
  await sweep();
  await warm();
}

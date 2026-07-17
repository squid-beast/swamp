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

export default warm;

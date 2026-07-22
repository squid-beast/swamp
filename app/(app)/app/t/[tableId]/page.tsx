import { notFound, redirect } from "next/navigation";
import { getTable, listFields, listTables, listViews } from "@/features/tables/repo";
import { loadViewConfig } from "@/features/tables/view-config";
import { TableWorkspace } from "@/features/tables/components/table-workspace";
import { createClient } from "@/shared/supabase/server";
import { isGoogleConfigured } from "@/features/sheets/google/sheets";
import { resyncSheetTable } from "@/features/sheets/resync";
import type { Role } from "@/features/tables/types";

// The table workspace.
//
// Note what this page does NOT load: the records.
//
// The old page ran `store.getRows(id)` on the server and passed every row into a
// client component as a prop. Records are now fetched by the client, one page at
// a time, through the query spec — so the server render is small and fast no
// matter how large the table is, and the initial payload doesn't scale with the
// row count.

export const dynamic = "force-dynamic";

export default async function TablePage({
  params,
  searchParams,
}: {
  params: { tableId: string };
  searchParams: { view?: string; record?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const table = await getTable(params.tableId);
  if (!table) notFound();

  // If this table is a live Google Sheet connection, pull the latest rows before
  // rendering so opening (or refreshing) the table shows new form responses
  // automatically — no manual "Sync now" needed. Throttled so a burst of loads
  // doesn't hammer Google, and strictly best-effort: a revoked token or a Google
  // 403 must never break viewing the table, it just shows what's already stored.
  if (isGoogleConfigured) {
    try {
      const { data: cred } = await supabase
        .from("google_credentials")
        .select("refresh_token")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cred?.refresh_token) {
        await resyncSheetTable(supabase, params.tableId, cred.refresh_token, {
          minIntervalMs: 15_000,
        });
      }
    } catch {
      // ignore — a sheet sync failure must not block the table
    }
  }

  const [fields, views, tables] = await Promise.all([
    listFields(params.tableId),
    listViews(params.tableId),
    // Every table in the base: a link field needs somewhere to point.
    listTables(table.baseId),
  ]);

  // ?view=… selects a view; otherwise the default. Every table has exactly one
  // default view and it cannot be deleted, so there is always somewhere to land.
  const view =
    views.find((v) => v.id === searchParams.view) ??
    views.find((v) => v.isDefault) ??
    views[0];

  if (!view) notFound();

  const [config, { data: role }] = await Promise.all([
    loadViewConfig(view.id, params.tableId),
    // The caller's effective role for this base. Read from the same function RLS
    // uses, so the UI's idea of what you can do can't drift from what the database
    // will actually let you do.
    supabase.rpc("swamp_base_role", { p_base_id: table.baseId }),
  ]);

  return (
    <TableWorkspace
      table={table}
      fields={fields}
      views={views}
      view={view}
      config={config}
      tables={tables}
      userId={user.id}
      role={(role as Role) ?? null}
      // ?record=… opens that record expanded. The expanded record's "Copy link"
      // button has always produced this URL; nothing has ever read it, so the link
      // it copied did nothing at all. This is the other half.
      openRecordId={searchParams.record ?? null}
    />
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PermissionsPanel } from "@/features/tables/components/permissions-panel";
import { getTable, listFields } from "@/features/tables/repo";
import { createClient } from "@/shared/supabase/server";
import { roleAtLeast, type Permission, type Role } from "@/features/tables/types";

export const dynamic = "force-dynamic";

export default async function PermissionsPage({
  params,
}: {
  params: { tableId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const table = await getTable(params.tableId);
  if (!table) notFound();

  const [fields, { data: rules }, { data: role }] = await Promise.all([
    listFields(params.tableId),
    supabase
      .from("permissions")
      .select("id, base_id, table_id, field_id, key, granted_type, role, user_ids")
      .eq("table_id", params.tableId),
    supabase.rpc("swamp_base_role", { p_base_id: table.baseId }),
  ]);

  const permissions: Permission[] = (rules ?? []).map((p) => ({
    id: p.id as string,
    baseId: p.base_id as string,
    tableId: p.table_id as string,
    fieldId: (p.field_id as string) ?? null,
    key: p.key as Permission["key"],
    grantedType: p.granted_type as Permission["grantedType"],
    role: (p.role as Role) ?? null,
    userIds: (p.user_ids as string[]) ?? [],
  }));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <Link
        href={`/app/t/${params.tableId}`}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to {table.name}
      </Link>

      <PermissionsPanel
        tableId={params.tableId}
        tableName={table.name}
        fields={fields}
        permissions={permissions}
        canEdit={roleAtLeast(role as Role | null, "creator")}
      />
    </main>
  );
}

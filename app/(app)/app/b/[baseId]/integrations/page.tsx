import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { IntegrationsPanel } from "@/features/tables/components/integrations-panel";
import { listTables } from "@/features/tables/repo";
import { createClient } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({ params }: { params: { baseId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const { data: base } = await supabase
    .from("bases")
    .select("id, name")
    .eq("id", params.baseId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!base) notFound();

  const tables = await listTables(params.baseId);

  // The absolute origin, so the copy-paste examples work as-is. Behind a proxy the
  // forwarded host is the public one; fall back to the request host.
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-app.example.com";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  return (
    <IntegrationsPanel
      baseId={base.id}
      baseName={base.name}
      tables={tables.map((t) => ({ id: t.id, name: t.name }))}
      origin={origin}
    />
  );
}

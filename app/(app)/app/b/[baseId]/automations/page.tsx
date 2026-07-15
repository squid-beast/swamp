import { notFound, redirect } from "next/navigation";
import { WebhooksPanel } from "@/features/tables/components/webhooks-panel";
import { listTables } from "@/features/tables/repo";
import { listWebhooks } from "@/features/tables/webhooks";
import { createClient } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

export default async function AutomationsPage({ params }: { params: { baseId: string } }) {
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

  const [tables, webhooks] = await Promise.all([
    listTables(params.baseId),
    // Webhooks are creator-and-up. An editor sees the page with an empty list
    // rather than a 403 — the page still tells them the feature exists.
    listWebhooks(params.baseId).catch(() => []),
  ]);

  return (
    <WebhooksPanel
      baseId={base.id}
      baseName={base.name}
      tables={tables}
      webhooks={webhooks}
    />
  );
}

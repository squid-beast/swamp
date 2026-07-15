import { notFound, redirect } from "next/navigation";
import { listTokens } from "@/features/tables/api-tokens";
import { TokensPanel } from "@/features/tables/components/tokens-panel";
import { createClient } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

export default async function ApiPage({ params }: { params: { baseId: string } }) {
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

  return (
    <TokensPanel
      baseId={base.id}
      baseName={base.name}
      tokens={await listTokens(params.baseId)}
    />
  );
}

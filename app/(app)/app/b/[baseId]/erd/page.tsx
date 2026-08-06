import { notFound, redirect } from "next/navigation";
import { Erd } from "@/features/tables/components/erd";
import { createClient } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

export default async function ErdPage({ params }: { params: { baseId: string } }) {
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
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3">
        <h1 className="text-[15px] font-medium">{base.name} — schema</h1>
        <p className="text-[12px] text-muted-foreground">
          Tables and the links between them.
        </p>
      </header>
      <Erd baseId={base.id} />
    </div>
  );
}

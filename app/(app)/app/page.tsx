import { redirect } from "next/navigation";
import { createClient } from "@/shared/supabase/server";
import { listNav } from "@/features/tables/nav";
import { Overview } from "@/features/overview/components/overview";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const [{ data: profile }, bases] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name,last_name")
      .eq("id", user.id)
      .maybeSingle(),
    listNav(),
  ]);

  return (
    <Overview
      firstName={profile?.first_name ?? ""}
      userId={user.id}
      needsProfile={!profile?.first_name || !profile?.last_name}
      bases={bases}
    />
  );
}

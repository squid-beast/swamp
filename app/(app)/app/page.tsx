import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/shared/supabase/server";
import { getMoney } from "@/features/overview/money";
import { Overview } from "@/features/overview/components/overview";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  if (!isSupabaseConfigured) {
    return <Overview firstName="" userId="" needsProfile={false} onboarded money={null} />;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  // Resilient to migration 0004 not being applied yet: if the `onboarded` column
  // doesn't exist, fall back to name-only and suppress the onboarding flow.
  let firstName = "";
  let needsProfile = true;
  let onboarded = true;
  const full = await supabase
    .from("profiles")
    .select("first_name,last_name,onboarded")
    .eq("id", user.id)
    .maybeSingle();
  if (full.error) {
    const basic = await supabase
      .from("profiles")
      .select("first_name,last_name")
      .eq("id", user.id)
      .maybeSingle();
    firstName = basic.data?.first_name ?? "";
    needsProfile = !basic.data?.first_name || !basic.data?.last_name;
  } else {
    firstName = full.data?.first_name ?? "";
    needsProfile = !full.data?.first_name || !full.data?.last_name;
    onboarded = full.data?.onboarded ?? false;
  }

  const money = await getMoney();

  return (
    <Overview
      firstName={firstName}
      userId={user.id}
      needsProfile={needsProfile}
      onboarded={onboarded}
      money={money}
    />
  );
}

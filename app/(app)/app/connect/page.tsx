import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { ConnectPanel } from "@/components/connect/connect-panel";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto w-full max-w-lg p-4 text-sm text-muted-foreground md:p-6">
        Connecting a Google Sheet needs Supabase. Add your keys to enable it.
      </div>
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: cred } = await supabase
    .from("google_credentials")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Connect a Google Sheet</h1>
        <p className="text-[13px] text-muted-foreground">
          Turn a Google Form&rsquo;s responses sheet into a live dataset. New submissions
          append on their own.
        </p>
      </div>
      <ConnectPanel googleConnected={!!cred} />
    </div>
  );
}

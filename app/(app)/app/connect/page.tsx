import { redirect } from "next/navigation";
import { createClient } from "@/shared/supabase/server";
import { hasSheetsScope } from "@/features/sheets/google/sheets";
import { ConnectPanel } from "@/features/sheets/components/connect-panel";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const { data: cred } = await supabase
    .from("google_credentials")
    .select("scope")
    .eq("user_id", user.id)
    .maybeSingle();

  // A row from a plain Google sign-in (scope null / no Sheets) reads as not
  // connected, so the user is prompted to grant Sheets access instead of hitting a
  // 403 on Load tabs.
  const googleConnected = hasSheetsScope(cred?.scope);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Connect a Google Sheet</h1>
        <p className="text-[13px] text-muted-foreground">
          Turn a Google Form&rsquo;s responses sheet into a live dataset. New submissions
          append on their own.
        </p>
      </div>
      <ConnectPanel googleConnected={googleConnected} />
    </div>
  );
}

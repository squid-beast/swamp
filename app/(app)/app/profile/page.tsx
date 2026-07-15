import { redirect } from "next/navigation";
import { createClient } from "@/shared/supabase/server";
import { ProfileForm } from "@/features/auth/components/profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name,last_name,dob,email,avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Profile</h1>
        <p className="text-[13px] text-muted-foreground">
          Update your details. Changes save to your account.
        </p>
      </div>
      <ProfileForm
        userId={user.id}
        initial={{
          firstName: profile?.first_name ?? "",
          lastName: profile?.last_name ?? "",
          dob: profile?.dob ?? "",
          email: profile?.email ?? user.email ?? "",
          avatarUrl: profile?.avatar_url ?? "",
        }}
      />
    </div>
  );
}

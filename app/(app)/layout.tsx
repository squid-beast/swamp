import { AppShell, type ShellUser } from "@/features/navigation/app-shell";
import { store } from "@/features/datasets/storage/store";
import { getMoney } from "@/features/overview/money";
import { createClient, isSupabaseConfigured } from "@/shared/supabase/server";

// The sidebar reflects the live dataset list, so render this subtree dynamically.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: ShellUser | null = null;
  if (isSupabaseConfigured) {
    const supabase = createClient();
    const {
      data: { user: u },
    } = await supabase.auth.getUser();
    if (u) {
      const { data: p } = await supabase
        .from("profiles")
        .select("first_name,last_name,avatar_url,email")
        .eq("id", u.id)
        .maybeSingle();
      const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ");
      user = {
        name: name || u.email || "Account",
        email: p?.email ?? u.email ?? "",
        avatarUrl: p?.avatar_url ?? null,
      };
    }
  }

  const [datasets, money] = await Promise.all([store.list(), getMoney()]);
  return (
    <AppShell datasets={datasets} user={user} money={money}>
      {children}
    </AppShell>
  );
}

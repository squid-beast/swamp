import { AppShell, type ShellUser } from "@/components/app-shell";
import { store } from "@/storage/store";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

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

  const datasets = await store.list();
  return (
    <AppShell datasets={datasets} user={user}>
      {children}
    </AppShell>
  );
}

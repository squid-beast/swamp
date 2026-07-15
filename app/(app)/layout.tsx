import { AppShell, type ShellUser } from "@/features/navigation/app-shell";
import { listNav } from "@/features/tables/nav";
import { createClient } from "@/shared/supabase/server";

// The sidebar reflects the live bases/tables tree, so render this subtree
// dynamically.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user: u },
  } = await supabase.auth.getUser();

  let user: ShellUser | null = null;
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

  const bases = await listNav();

  return (
    <AppShell bases={bases} user={user}>
      {children}
    </AppShell>
  );
}

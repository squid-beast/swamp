import { notFound, redirect } from "next/navigation";
import { listInvites, listMembers } from "@/features/tables/collaboration";
import { MembersPanel } from "@/features/tables/components/members-panel";
import { createClient } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: { baseId: string } }) {
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

  const [members, invites] = await Promise.all([
    listMembers(params.baseId),
    // A viewer can see who's in the base but not who's been asked. Failing softly
    // rather than 403-ing the whole page is the right call: the page is still useful.
    listInvites(params.baseId).catch(() => []),
  ]);

  return (
    <MembersPanel
      baseId={base.id}
      baseName={base.name}
      members={members}
      invites={invites}
      currentUserId={user.id}
    />
  );
}

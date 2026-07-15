import { redirect } from "next/navigation";
import { acceptInvite } from "@/features/tables/collaboration";
import { createClient } from "@/shared/supabase/server";

// Accept an invite.
//
// The token alone is not enough: swamp_accept_invite checks that the signed-in
// user's EMAIL matches the address the invite was sent to. Forwarding your invite
// link to a friend does not get them into the base.

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in? Send them to sign-in, and come back here afterwards — the
  // invite is almost always the first thing they've ever seen of SWAMP.
  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/invite/${params.token}`)}`);
  }

  let baseId: string;
  try {
    baseId = await acceptInvite(params.token);
  } catch (e) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="font-display text-xl font-extrabold">Invite not valid</h1>
        <p className="text-[13px] text-muted-foreground">{(e as Error).message}</p>
      </main>
    );
  }

  redirect(`/app?base=${baseId}`);
}

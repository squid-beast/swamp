import { notFound } from "next/navigation";
import {
  getSharedMeta,
  PasswordRequired,
} from "@/features/tables/sharing";
import {
  SharePasswordGate,
  SharedView,
} from "@/features/tables/components/shared-view";

// A publicly shared view. No auth, by design.
//
// This route sits OUTSIDE the (app) group, so it gets none of the authenticated
// shell — no sidebar, no user menu, no session. A visitor should not be able to
// tell whether the person who shared it is even logged in.

export const dynamic = "force-dynamic";

export default async function SharedPage({
  params,
  searchParams,
}: {
  params: { shareId: string };
  searchParams: { p?: string };
}) {
  const password = searchParams.p;

  let meta;
  try {
    meta = await getSharedMeta(params.shareId, password);
  } catch (e) {
    if (e instanceof PasswordRequired) {
      // `wrong` only when they actually gave one — otherwise the first visit would
      // accuse them of a mistake they haven't made yet.
      return <SharePasswordGate wrong={!!password} />;
    }
    throw e;
  }

  // A revoked link and a link that never existed give the same 404. Distinguishing
  // them would tell a stranger that a share link USED to be here, which is more
  // than they need to know.
  if (!meta) notFound();

  return <SharedView shareId={params.shareId} meta={meta} password={password} />;
}

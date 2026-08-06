import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { createPublicClient } from "@/shared/supabase/public";
import { SharePasswordGate } from "@/features/tables/components/shared-view";

// A publicly shared BASE: its name, and links to the views that are THEMSELVES
// shared. Nothing else — swamp_shared_base returns no records and no field
// metadata by design; every record read still goes through the per-view share
// with its allow-list.

export const dynamic = "force-dynamic";

interface SharedBase {
  base: { name: string };
  views: { shareId: string; name: string; type: string; tableName: string }[];
}

export default async function SharedBasePage({
  params,
  searchParams,
}: {
  params: { shareId: string };
  searchParams: { p?: string };
}) {
  const password = searchParams.p;

  const { data, error } = await createPublicClient().rpc("swamp_shared_base", {
    p_share_id: params.shareId,
    p_password: password ?? null,
  });

  if (error) {
    if (error.code === "28000") return <SharePasswordGate wrong={!!password} />;
    notFound();
  }

  const shared = data as SharedBase;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 p-6">
      <header className="flex items-center gap-2">
        <h1 className="font-display text-xl font-extrabold tracking-tight">
          {shared.base.name}
        </h1>
        <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          <Lock className="size-3" />
          Read-only
        </span>
      </header>

      {shared.views.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-muted-foreground">
          Nothing in this base is shared yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shared.views.map((v) => (
            <li key={v.shareId}>
              <Link
                href={`/s/${v.shareId}${password ? `?p=${encodeURIComponent(password)}` : ""}`}
                className="flex items-center justify-between rounded-lg border px-4 py-3 hover:border-brand/50"
              >
                <span className="text-[14px] font-medium">{v.name}</span>
                <span className="text-[12px] text-muted-foreground">
                  {v.tableName} · {v.type}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

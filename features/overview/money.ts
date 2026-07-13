// ── Server-side read of the "Money (AI)" metrics the agent pushes via
//    /api/agent/metrics. Rendered in the header badge and the Overview card.
//    Reads with the signed-in user's cookie client, so RLS scopes it — a user
//    only ever sees their own money row. Returns null when unconfigured,
//    signed out, or the agent hasn't pushed metrics yet (UI hides itself). ──

import { createClient, isSupabaseConfigured } from "@/shared/supabase/server";
import type { Money } from "@/features/datasets/types";

const MONEY_DATASET = "Money (AI)";
const ROW_ID = "r_money_current";

export async function getMoney(): Promise<Money | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = createClient();
    const { data: ds } = await db
      .from("datasets")
      .select("id")
      .eq("name", MONEY_DATASET)
      .maybeSingle();
    if (!ds) return null;

    const { data: row } = await db
      .from("dataset_rows")
      .select("data")
      .eq("dataset_id", ds.id as string)
      .eq("row_id", ROW_ID)
      .maybeSingle();
    if (!row) return null;

    const d = row.data as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.length ? v : null;

    return {
      balance: num(d.f_balance),
      revenueMtd: num(d.f_revenue_mtd),
      pipelineValue: num(d.f_pipeline_value),
      pipelineCounts: str(d.f_pipeline_counts),
      topAction: str(d.f_top_action),
      updatedAt: str(d.f_updated),
    };
  } catch {
    return null; // never let the money badge take the app down
  }
}

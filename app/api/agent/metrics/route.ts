// ── /api/agent/metrics — the money numbers behind the header badge + Overview. ──
// POST { balance?, revenue_mtd?, pipeline_value?, pipeline_counts?, top_action? }
//   → upserts the single "current" row of the "Money (AI)" dataset. All amounts
//     are USD **dollars** (not cents). Partial bodies merge over what's stored.
// GET → the current metrics row (agent reads state back).
// The header badge and the Overview money card render straight from this dataset
// via the signed-in user's own RLS-scoped client (lib/money.ts). Zero new tables.

import { NextRequest, NextResponse } from "next/server";
import { agentDenied, agentOwnerId, jsonError, serviceDb } from "@/lib/agent/service";
import type { FieldMeta, ViewConfig } from "@/core/types";

export const dynamic = "force-dynamic";

const DATASET_NAME = "Money (AI)";
const ROW_ID = "r_money_current";

const F = (
  id: string,
  displayName: string,
  type: FieldMeta["type"],
  extra: Partial<FieldMeta> = {}
): FieldMeta => ({
  id,
  sourceName: id.replace(/^f_/, ""),
  displayName,
  type,
  nullable: true,
  unique: false,
  sortable: true,
  filterable: true,
  groupable: false,
  searchable: type === "text" || type === "longText",
  hidden: false,
  confidence: 1,
  ...extra,
});

const FIELDS: FieldMeta[] = [
  F("f_balance", "Stripe Balance", "currency", { currency: "USD" }),
  F("f_revenue_mtd", "Revenue (This Month)", "currency", { currency: "USD" }),
  F("f_pipeline_value", "Pipeline Value", "currency", { currency: "USD" }),
  F("f_pipeline_counts", "Pipeline", "text"),
  F("f_top_action", "Top Money Action", "longText"),
  F("f_updated", "Updated", "datetime"),
];

const VIEWS: ViewConfig[] = [{ id: "v_money_grid", type: "grid", name: "Grid" }];

async function ensureMoneyDataset(db: ReturnType<typeof serviceDb>, ownerId: string) {
  const { data, error } = await db
    .from("datasets")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", DATASET_NAME)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.id as string;

  const id = `ds_agent_money_${Math.random().toString(36).slice(2, 7)}`;
  const { error: insErr } = await db.from("datasets").insert({
    id,
    owner_id: ownerId,
    name: DATASET_NAME,
    source: { kind: "webhook", ref: "agent:claude" },
    fields: FIELDS,
    overrides: {},
    views: VIEWS,
    row_count: 1,
  });
  if (insErr) throw insErr;
  return id;
}

type MetricsIn = {
  balance?: number;
  revenue_mtd?: number;
  pipeline_value?: number;
  pipeline_counts?: string;
  top_action?: string;
};

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export async function GET(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureMoneyDataset(db, ownerId);
    const { data, error } = await db
      .from("dataset_rows")
      .select("data")
      .eq("dataset_id", dsId)
      .eq("row_id", ROW_ID)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ datasetId: dsId, metrics: data?.data ?? null });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as MetricsIn;
    const patch: Record<string, unknown> = {};
    const balance = num(body.balance);
    const revenue = num(body.revenue_mtd);
    const pipeline = num(body.pipeline_value);
    if (balance !== undefined) patch.f_balance = balance;
    if (revenue !== undefined) patch.f_revenue_mtd = revenue;
    if (pipeline !== undefined) patch.f_pipeline_value = pipeline;
    if (typeof body.pipeline_counts === "string") patch.f_pipeline_counts = body.pipeline_counts;
    if (typeof body.top_action === "string") patch.f_top_action = body.top_action;
    if (!Object.keys(patch).length) {
      return NextResponse.json(
        { error: "at least one of balance, revenue_mtd, pipeline_value, pipeline_counts, top_action required" },
        { status: 400 }
      );
    }
    patch.f_updated = new Date().toISOString();

    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureMoneyDataset(db, ownerId);

    const { data: existing, error: getErr } = await db
      .from("dataset_rows")
      .select("data")
      .eq("dataset_id", dsId)
      .eq("row_id", ROW_ID)
      .maybeSingle();
    if (getErr) throw getErr;

    if (existing) {
      const { error } = await db
        .from("dataset_rows")
        .update({ data: { ...(existing.data as Record<string, unknown>), ...patch } })
        .eq("dataset_id", dsId)
        .eq("row_id", ROW_ID);
      if (error) throw error;
    } else {
      const { error } = await db
        .from("dataset_rows")
        .insert({ dataset_id: dsId, row_id: ROW_ID, ord: 0, data: patch });
      if (error) throw error;
    }
    await db
      .from("datasets")
      .update({ row_count: 1, updated_at: new Date().toISOString() })
      .eq("id", dsId);

    return NextResponse.json({ datasetId: dsId, ok: true, patched: Object.keys(patch) });
  } catch (e) {
    return jsonError(e);
  }
}

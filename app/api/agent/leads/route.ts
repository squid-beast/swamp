// ── /api/agent/leads — Claude ⇄ Swamp lead pipeline. ─────────────────────────
// POST  { leads: [...] }                      → upsert into the "Leads (AI)" dataset
// PATCH { key: {business, phone?}, values }   → update one lead (e.g. stage change)
// GET                                         → current leads (agent reads state back)
// Dataset is created on first push with a fixed schema + Grid/Kanban/Dashboard views,
// so everything renders in the existing UI untouched. Rows arrive live via the
// dataset_rows realtime subscription in Workspace.

import { NextRequest, NextResponse } from "next/server";
import { agentDenied, agentOwnerId, jsonError, serviceDb, slugKey } from "@/features/agent/service";
import type { FieldMeta, ViewConfig } from "@/features/datasets/types";

export const dynamic = "force-dynamic";

const DATASET_NAME = "Leads (AI)";

const STAGE_OPTIONS = [
  { value: "New", color: "amber" },
  { value: "Verify First", color: "orange" },
  { value: "Contacted", color: "violet" },
  { value: "Replied", color: "teal" },
  { value: "Meeting", color: "sky" },
  { value: "Proposal Sent", color: "fuchsia" },
  { value: "Won", color: "lime" },
  { value: "Lost", color: "rose" },
];

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
  groupable: type === "singleSelect" || type === "status",
  searchable: type === "text" || type === "longText" || type === "url",
  hidden: false,
  confidence: 1,
  ...extra,
});

const FIELDS: FieldMeta[] = [
  F("f_business", "Business", "text"),
  F("f_niche", "Niche", "singleSelect", {
    options: [
      { value: "HVAC", color: "sky" },
      { value: "Dentist", color: "teal" },
      { value: "Other", color: "amber" },
    ],
  }),
  F("f_city", "City", "text"),
  F("f_phone", "Phone", "phone", { searchable: false }),
  F("f_rating", "Rating", "rating", { searchable: false }),
  F("f_reviews", "Reviews", "number", { searchable: false }),
  F("f_score", "Opportunity Score", "number", { searchable: false }),
  F("f_stage", "Stage", "status", { options: STAGE_OPTIONS }),
  F("f_website_status", "Website Status", "text"),
  F("f_social", "Social", "url"),
  F("f_owner", "Owner", "text"),
  F("f_pitch", "Pitch Angle", "longText"),
  F("f_verification", "Verification", "longText"),
  F("f_notes", "Notes", "longText"),
  F("f_updated", "Last Update", "date", { searchable: false }),
];

const VIEWS: ViewConfig[] = [
  { id: "v_agent_grid", type: "grid", name: "Grid" },
  { id: "v_agent_board", type: "kanban", name: "Pipeline", groupBy: "f_stage", titleField: "f_business" },
  { id: "v_agent_dash", type: "dashboard", name: "Dashboard" },
];

async function ensureLeadsDataset(db: ReturnType<typeof serviceDb>, ownerId: string) {
  const { data, error } = await db
    .from("datasets")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", DATASET_NAME)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.id as string;

  const id = `ds_agent_leads_${Math.random().toString(36).slice(2, 7)}`;
  const { error: insErr } = await db.from("datasets").insert({
    id,
    owner_id: ownerId,
    name: DATASET_NAME,
    source: { kind: "webhook", ref: "agent:claude" },
    fields: FIELDS,
    overrides: {},
    views: VIEWS,
    row_count: 0,
  });
  if (insErr) throw insErr;
  return id;
}

type LeadIn = {
  business: string;
  niche?: string;
  city?: string;
  phone?: string;
  rating?: number;
  reviews?: number;
  score?: number;
  stage?: string;
  website_status?: string;
  social?: string;
  owner?: string;
  pitch?: string;
  verification?: string;
  notes?: string;
};

function leadToData(l: LeadIn): Record<string, unknown> {
  return {
    f_business: l.business,
    f_niche: l.niche ?? "Other",
    f_city: l.city ?? null,
    f_phone: l.phone ?? null,
    f_rating: l.rating ?? null,
    f_reviews: l.reviews ?? null,
    f_score: l.score ?? null,
    f_stage: l.stage && STAGE_OPTIONS.some((o) => o.value === l.stage) ? l.stage : "New",
    f_website_status: l.website_status ?? null,
    f_social: l.social ?? null,
    f_owner: l.owner ?? null,
    f_pitch: l.pitch ?? null,
    f_verification: l.verification ?? null,
    f_notes: l.notes ?? null,
    f_updated: new Date().toISOString().slice(0, 10),
  };
}

export async function GET(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureLeadsDataset(db, ownerId);
    const { data, error } = await db
      .from("dataset_rows")
      .select("row_id,data")
      .eq("dataset_id", dsId)
      .order("ord", { ascending: true })
      .range(0, 4999);
    if (error) throw error;
    return NextResponse.json({ datasetId: dsId, leads: data ?? [] });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { leads?: LeadIn[] };
    const leads = body.leads ?? [];
    if (!leads.length || leads.some((l) => !l.business)) {
      return NextResponse.json({ error: "leads[] with business required" }, { status: 400 });
    }
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureLeadsDataset(db, ownerId);

    const { data: maxRow } = await db
      .from("dataset_rows")
      .select("ord")
      .eq("dataset_id", dsId)
      .order("ord", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextOrd = (maxRow?.ord ?? -1) + 1;

    let inserted = 0;
    let updated = 0;
    for (const l of leads) {
      const rowId = `r_${slugKey(l.business, l.phone)}`;
      const { data: existing } = await db
        .from("dataset_rows")
        .select("row_id,ord,data")
        .eq("dataset_id", dsId)
        .eq("row_id", rowId)
        .maybeSingle();
      if (existing) {
        // merge: never regress the stage a human moved; agent fields refresh
        const merged = { ...leadToData(l), f_stage: (existing.data as Record<string, unknown>).f_stage ?? leadToData(l).f_stage };
        const { error } = await db
          .from("dataset_rows")
          .update({ data: { ...(existing.data as Record<string, unknown>), ...merged } })
          .eq("dataset_id", dsId)
          .eq("row_id", rowId);
        if (error) throw error;
        updated++;
      } else {
        const { error } = await db.from("dataset_rows").insert({
          dataset_id: dsId,
          row_id: rowId,
          ord: nextOrd++,
          data: leadToData(l),
        });
        if (error) throw error;
        inserted++;
      }
    }

    const { count } = await db
      .from("dataset_rows")
      .select("row_id", { count: "exact", head: true })
      .eq("dataset_id", dsId);
    await db
      .from("datasets")
      .update({ row_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq("id", dsId);

    return NextResponse.json({ datasetId: dsId, inserted, updated });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      key: { business: string; phone?: string };
      values: Record<string, unknown>; // plain names: stage, notes, pitch, ...
    };
    if (!body?.key?.business || !body?.values) {
      return NextResponse.json({ error: "key.business and values required" }, { status: 400 });
    }
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureLeadsDataset(db, ownerId);
    const rowId = `r_${slugKey(body.key.business, body.key.phone)}`;

    const { data: existing, error: getErr } = await db
      .from("dataset_rows")
      .select("data")
      .eq("dataset_id", dsId)
      .eq("row_id", rowId)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!existing) return NextResponse.json({ error: `lead not found: ${rowId}` }, { status: 404 });

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.values)) {
      const fid = k.startsWith("f_") ? k : `f_${k}`;
      if (fid === "f_stage" && !STAGE_OPTIONS.some((o) => o.value === v)) continue;
      patch[fid] = v;
    }
    patch["f_updated"] = new Date().toISOString().slice(0, 10);

    const { error } = await db
      .from("dataset_rows")
      .update({ data: { ...(existing.data as Record<string, unknown>), ...patch } })
      .eq("dataset_id", dsId)
      .eq("row_id", rowId);
    if (error) throw error;
    await db.from("datasets").update({ updated_at: new Date().toISOString() }).eq("id", dsId);

    return NextResponse.json({ ok: true, rowId, patched: Object.keys(patch) });
  } catch (e) {
    return jsonError(e);
  }
}

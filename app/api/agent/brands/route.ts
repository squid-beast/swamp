// ── /api/agent/brands — UGC brand-deal pipeline for @thealpharomeo_. ──────────
// POST  { brands: [...] }                        → upsert into "Brands (AI)" dataset
// PATCH { key: {brand, instagram?}, values }     → update one brand (stage, rate, notes)
// GET                                            → current brands (agent reads state back)
// Same pattern as /api/agent/leads: auto-created dataset with Grid/Kanban/Dashboard,
// human stage moves are never overwritten by agent re-pushes.

import { NextRequest, NextResponse } from "next/server";
import { agentDenied, agentOwnerId, jsonError, serviceDb, slugKey } from "@/lib/agent/service";
import type { FieldMeta, ViewConfig } from "@/core/types";

export const dynamic = "force-dynamic";

const DATASET_NAME = "Brands (AI)";

const STAGE_OPTIONS = [
  { value: "New", color: "amber" },
  { value: "Pitched", color: "violet" },
  { value: "Follow-up", color: "orange" },
  { value: "Replied", color: "teal" },
  { value: "Negotiating", color: "sky" },
  { value: "Won", color: "lime" },
  { value: "Lost", color: "rose" },
];

const CATEGORY_OPTIONS = [
  { value: "Beauty", color: "fuchsia" },
  { value: "Supplements", color: "lime" },
  { value: "Gadgets", color: "sky" },
  { value: "Apps", color: "violet" },
  { value: "Pet", color: "amber" },
  { value: "Home", color: "teal" },
  { value: "Fashion", color: "rose" },
  { value: "Food", color: "orange" },
  { value: "Other", color: "slate" },
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
  searchable: type === "text" || type === "longText" || type === "url" || type === "email",
  hidden: false,
  confidence: 1,
  ...extra,
});

const FIELDS: FieldMeta[] = [
  F("f_brand", "Brand", "text"),
  F("f_product", "Product", "text"),
  F("f_category", "Category", "singleSelect", { options: CATEGORY_OPTIONS }),
  F("f_budget_evidence", "Budget Evidence", "text"),
  F("f_email", "Email", "email"),
  F("f_instagram", "Instagram", "text"),
  F("f_contact", "Contact Person", "text"),
  F("f_stage", "Stage", "status", { options: STAGE_OPTIONS }),
  F("f_rate_quoted", "Rate Quoted", "currency", { currency: "USD" }),
  F("f_pitch_angle", "Pitch Angle", "longText"),
  F("f_email_subject", "Email Subject", "text"),
  F("f_dm_draft", "IG DM Draft", "longText"),
  F("f_verification", "Verification", "longText"),
  F("f_notes", "Notes", "longText"),
  F("f_updated", "Last Update", "date", { searchable: false }),
];

const VIEWS: ViewConfig[] = [
  { id: "v_brands_grid", type: "grid", name: "Grid" },
  { id: "v_brands_board", type: "kanban", name: "Deals", groupBy: "f_stage", titleField: "f_brand" },
  { id: "v_brands_dash", type: "dashboard", name: "Dashboard" },
];

async function ensureBrandsDataset(db: ReturnType<typeof serviceDb>, ownerId: string) {
  const { data, error } = await db
    .from("datasets")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", DATASET_NAME)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.id as string;

  const id = `ds_agent_brands_${Math.random().toString(36).slice(2, 7)}`;
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

type BrandIn = {
  brand: string;
  product?: string;
  category?: string;
  budget_evidence?: string;
  email?: string;
  instagram?: string;
  contact?: string;
  stage?: string;
  rate_quoted?: number;
  pitch_angle?: string;
  email_subject?: string;
  dm_draft?: string;
  verification?: string;
  notes?: string;
};

function brandToData(b: BrandIn): Record<string, unknown> {
  return {
    f_brand: b.brand,
    f_product: b.product ?? null,
    f_category:
      b.category && CATEGORY_OPTIONS.some((o) => o.value === b.category) ? b.category : "Other",
    f_budget_evidence: b.budget_evidence ?? null,
    f_email: b.email ?? null,
    f_instagram: b.instagram ?? null,
    f_contact: b.contact ?? null,
    f_stage: b.stage && STAGE_OPTIONS.some((o) => o.value === b.stage) ? b.stage : "New",
    f_rate_quoted: typeof b.rate_quoted === "number" && Number.isFinite(b.rate_quoted) ? b.rate_quoted : null,
    f_pitch_angle: b.pitch_angle ?? null,
    f_email_subject: b.email_subject ?? null,
    f_dm_draft: b.dm_draft ?? null,
    f_verification: b.verification ?? null,
    f_notes: b.notes ?? null,
    f_updated: new Date().toISOString().slice(0, 10),
  };
}

export async function GET(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureBrandsDataset(db, ownerId);
    const { data, error } = await db
      .from("dataset_rows")
      .select("row_id,data")
      .eq("dataset_id", dsId)
      .order("ord", { ascending: true })
      .range(0, 4999);
    if (error) throw error;
    return NextResponse.json({ datasetId: dsId, brands: data ?? [] });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { brands?: BrandIn[] };
    const brands = body.brands ?? [];
    if (!brands.length || brands.some((b) => !b.brand)) {
      return NextResponse.json({ error: "brands[] with brand required" }, { status: 400 });
    }
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureBrandsDataset(db, ownerId);

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
    for (const b of brands) {
      const rowId = `r_${slugKey(b.brand, b.instagram)}`;
      const { data: existing } = await db
        .from("dataset_rows")
        .select("row_id,data")
        .eq("dataset_id", dsId)
        .eq("row_id", rowId)
        .maybeSingle();
      if (existing) {
        // merge: never regress the stage a human moved; agent fields refresh
        const fresh = brandToData(b);
        const merged = {
          ...fresh,
          f_stage: (existing.data as Record<string, unknown>).f_stage ?? fresh.f_stage,
        };
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
          data: brandToData(b),
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
      key: { brand: string; instagram?: string };
      values: Record<string, unknown>;
    };
    if (!body?.key?.brand || !body?.values) {
      return NextResponse.json({ error: "key.brand and values required" }, { status: 400 });
    }
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureBrandsDataset(db, ownerId);
    const rowId = `r_${slugKey(body.key.brand, body.key.instagram)}`;

    const { data: existing, error: getErr } = await db
      .from("dataset_rows")
      .select("data")
      .eq("dataset_id", dsId)
      .eq("row_id", rowId)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!existing) return NextResponse.json({ error: `brand not found: ${rowId}` }, { status: 404 });

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

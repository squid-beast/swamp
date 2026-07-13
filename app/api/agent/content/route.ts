// ── /api/agent/content — daily content calendar for @thealpharomeo_. ──────────
// POST  { items: [...] }                          → upsert into "Content Calendar (AI)"
// PATCH { key: {date, type, hook}, values }       → update one item (status, notes)
// GET   ?date=YYYY-MM-DD (optional)               → items (agent reads state back)
// Same pattern as /api/agent/leads: auto-created dataset, Grid/Kanban views,
// human status moves are never overwritten by agent re-pushes.

import { NextRequest, NextResponse } from "next/server";
import { agentDenied, agentOwnerId, jsonError, serviceDb, slugKey } from "@/features/agent/service";
import type { FieldMeta, ViewConfig } from "@/features/datasets/types";

export const dynamic = "force-dynamic";

const DATASET_NAME = "Content Calendar (AI)";

const STATUS_OPTIONS = [
  { value: "Planned", color: "amber" },
  { value: "Prompt Ready", color: "violet" },
  { value: "Generated", color: "sky" },
  { value: "Posted", color: "lime" },
  { value: "Skipped", color: "rose" },
];

const TYPE_OPTIONS = [
  { value: "Reel", color: "fuchsia" },
  { value: "Carousel", color: "sky" },
  { value: "Photo", color: "teal" },
  { value: "Story", color: "amber" },
];

const PURPOSE_OPTIONS = [
  { value: "Post", color: "lime" },
  { value: "Spec Ad", color: "violet" },
  { value: "Portfolio", color: "sky" },
  { value: "Client Work", color: "fuchsia" },
  { value: "Product Promo", color: "orange" },
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
  searchable: type === "text" || type === "longText",
  hidden: false,
  confidence: 1,
  ...extra,
});

const FIELDS: FieldMeta[] = [
  F("f_date", "Date", "date"),
  F("f_time", "Post Time (ET)", "text"),
  F("f_type", "Type", "singleSelect", { options: TYPE_OPTIONS }),
  F("f_purpose", "Purpose", "singleSelect", { options: PURPOSE_OPTIONS }),
  F("f_hook", "Hook / Title", "text"),
  F("f_product", "Brand / Product", "text"),
  F("f_prompt", "Generation Prompt", "longText"),
  F("f_caption", "Caption", "longText"),
  F("f_status", "Status", "status", { options: STATUS_OPTIONS }),
  F("f_notes", "Notes", "longText"),
  F("f_updated", "Last Update", "date", { searchable: false }),
];

const VIEWS: ViewConfig[] = [
  { id: "v_content_board", type: "kanban", name: "Production", groupBy: "f_status", titleField: "f_hook" },
  { id: "v_content_grid", type: "grid", name: "Grid" },
  { id: "v_content_dash", type: "dashboard", name: "Dashboard" },
];

async function ensureContentDataset(db: ReturnType<typeof serviceDb>, ownerId: string) {
  const { data, error } = await db
    .from("datasets")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", DATASET_NAME)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.id as string;

  const id = `ds_agent_content_${Math.random().toString(36).slice(2, 7)}`;
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

type ItemIn = {
  date: string; // YYYY-MM-DD
  time?: string; // "7:00 PM ET"
  type: string; // Reel | Carousel | Photo | Story
  purpose?: string;
  hook: string;
  product?: string;
  prompt?: string;
  caption?: string;
  status?: string;
  notes?: string;
};

function itemToData(i: ItemIn): Record<string, unknown> {
  return {
    f_date: i.date,
    f_time: i.time ?? null,
    f_type: TYPE_OPTIONS.some((o) => o.value === i.type) ? i.type : "Reel",
    f_purpose:
      i.purpose && PURPOSE_OPTIONS.some((o) => o.value === i.purpose) ? i.purpose : "Post",
    f_hook: i.hook,
    f_product: i.product ?? null,
    f_prompt: i.prompt ?? null,
    f_caption: i.caption ?? null,
    f_status:
      i.status && STATUS_OPTIONS.some((o) => o.value === i.status) ? i.status : "Prompt Ready",
    f_notes: i.notes ?? null,
    f_updated: new Date().toISOString().slice(0, 10),
  };
}

const rowIdFor = (date: string, type: string, hook: string) =>
  `r_${slugKey(date, type, hook)}`;

export async function GET(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureContentDataset(db, ownerId);
    const date = req.nextUrl.searchParams.get("date");
    const { data, error } = await db
      .from("dataset_rows")
      .select("row_id,data")
      .eq("dataset_id", dsId)
      .order("ord", { ascending: true })
      .range(0, 4999);
    if (error) throw error;
    const rows = (data ?? []).filter(
      (r) => !date || (r.data as Record<string, unknown>).f_date === date
    );
    return NextResponse.json({ datasetId: dsId, items: rows });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { items?: ItemIn[] };
    const items = body.items ?? [];
    if (!items.length || items.some((i) => !i.date || !i.type || !i.hook)) {
      return NextResponse.json({ error: "items[] with date, type, hook required" }, { status: 400 });
    }
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureContentDataset(db, ownerId);

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
    for (const i of items) {
      const rowId = rowIdFor(i.date, i.type, i.hook);
      const { data: existing } = await db
        .from("dataset_rows")
        .select("row_id,data")
        .eq("dataset_id", dsId)
        .eq("row_id", rowId)
        .maybeSingle();
      if (existing) {
        // merge: never regress the status a human moved; agent fields refresh
        const fresh = itemToData(i);
        const merged = {
          ...fresh,
          f_status: (existing.data as Record<string, unknown>).f_status ?? fresh.f_status,
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
          data: itemToData(i),
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
      key: { date: string; type: string; hook: string };
      values: Record<string, unknown>;
    };
    if (!body?.key?.date || !body?.key?.type || !body?.key?.hook || !body?.values) {
      return NextResponse.json(
        { error: "key.date, key.type, key.hook and values required" },
        { status: 400 }
      );
    }
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureContentDataset(db, ownerId);
    const rowId = rowIdFor(body.key.date, body.key.type, body.key.hook);

    const { data: existing, error: getErr } = await db
      .from("dataset_rows")
      .select("data")
      .eq("dataset_id", dsId)
      .eq("row_id", rowId)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!existing) return NextResponse.json({ error: `item not found: ${rowId}` }, { status: 404 });

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.values)) {
      const fid = k.startsWith("f_") ? k : `f_${k}`;
      if (fid === "f_status" && !STATUS_OPTIONS.some((o) => o.value === v)) continue;
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

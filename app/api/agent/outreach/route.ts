// ── /api/agent/outreach — append-only activity log per lead. ─────────────────
// POST { events: [{business, channel, type, summary?, link?}] } → rows in the
// "Outreach Log (AI)" dataset (created on first push). GET → recent events.

import { NextRequest, NextResponse } from "next/server";
import { agentDenied, agentOwnerId, jsonError, serviceDb } from "@/lib/agent/service";
import type { FieldMeta, ViewConfig } from "@/core/types";

export const dynamic = "force-dynamic";

const DATASET_NAME = "Outreach Log (AI)";

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
  F("f_date", "Date", "datetime", { searchable: false }),
  F("f_business", "Business", "text"),
  F("f_channel", "Channel", "singleSelect", {
    options: [
      { value: "Email", color: "violet" },
      { value: "Facebook DM", color: "sky" },
      { value: "Instagram DM", color: "fuchsia" },
      { value: "Phone", color: "teal" },
      { value: "Other", color: "amber" },
    ],
  }),
  F("f_type", "Type", "singleSelect", {
    options: [
      { value: "Draft Created", color: "amber" },
      { value: "Sent", color: "violet" },
      { value: "Follow-up", color: "orange" },
      { value: "Reply Received", color: "teal" },
      { value: "Meeting Booked", color: "sky" },
      { value: "Proposal Sent", color: "fuchsia" },
      { value: "Closed Won", color: "lime" },
      { value: "Closed Lost", color: "rose" },
    ],
  }),
  F("f_summary", "Summary", "longText"),
  F("f_link", "Link", "url"),
];

const VIEWS: ViewConfig[] = [
  { id: "v_agent_log_grid", type: "grid", name: "Grid", sort: { fieldId: "f_date", dir: "desc" } },
  { id: "v_agent_log_dash", type: "dashboard", name: "Dashboard" },
];

async function ensureLogDataset(db: ReturnType<typeof serviceDb>, ownerId: string) {
  const { data, error } = await db
    .from("datasets")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", DATASET_NAME)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.id as string;
  const id = `ds_agent_log_${Math.random().toString(36).slice(2, 7)}`;
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

type EventIn = {
  business: string;
  channel: string;
  type: string;
  summary?: string;
  link?: string;
  date?: string; // ISO; defaults to now
};

export async function GET(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureLogDataset(db, ownerId);
    const { data, error } = await db
      .from("dataset_rows")
      .select("row_id,data")
      .eq("dataset_id", dsId)
      .order("ord", { ascending: false })
      .range(0, 199);
    if (error) throw error;
    return NextResponse.json({ datasetId: dsId, events: data ?? [] });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { events?: EventIn[] };
    const events = body.events ?? [];
    if (!events.length || events.some((e) => !e.business || !e.type)) {
      return NextResponse.json({ error: "events[] with business and type required" }, { status: 400 });
    }
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const dsId = await ensureLogDataset(db, ownerId);

    const { data: maxRow } = await db
      .from("dataset_rows")
      .select("ord")
      .eq("dataset_id", dsId)
      .order("ord", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextOrd = (maxRow?.ord ?? -1) + 1;

    const rows = events.map((e) => ({
      dataset_id: dsId,
      row_id: `r_${nextOrd}_${Math.random().toString(36).slice(2, 6)}`,
      ord: nextOrd++,
      data: {
        f_date: e.date ?? new Date().toISOString(),
        f_business: e.business,
        f_channel: e.channel ?? "Other",
        f_type: e.type,
        f_summary: e.summary ?? null,
        f_link: e.link ?? null,
      },
    }));
    const { error } = await db.from("dataset_rows").insert(rows);
    if (error) throw error;

    const { count } = await db
      .from("dataset_rows")
      .select("row_id", { count: "exact", head: true })
      .eq("dataset_id", dsId);
    await db
      .from("datasets")
      .update({ row_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq("id", dsId);

    return NextResponse.json({ datasetId: dsId, appended: rows.length });
  } catch (e) {
    return jsonError(e);
  }
}

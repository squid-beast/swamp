import { NextRequest, NextResponse } from "next/server";
import { Row, RowPatch } from "@/features/datasets/types";
import { store } from "@/features/datasets/storage/store";
import { requireAuth } from "@/shared/supabase/server";

// Row-level writes. POST appends new rows; PATCH merges cell values into rows;
// DELETE removes rows. All keep the field registry + overrides untouched, and
// unknown field ids are stripped so only real columns are written.

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const denied = await requireAuth();
    if (denied) return denied;
    const ds = await store.get(params.id);
    if (!ds) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = await req.json();
    const inputs: Record<string, unknown>[] = Array.isArray(body?.rows)
      ? body.rows
      : body?.values && typeof body.values === "object" && !Array.isArray(body.values)
        ? [body.values]
        : [];
    if (!inputs.length) return NextResponse.json({ error: "invalid rows" }, { status: 400 });

    const fieldIds = new Set(ds.fields.map((f) => f.id));
    const rows: Row[] = inputs.map((vals) => {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(vals ?? {})) if (fieldIds.has(k)) clean[k] = v;
      return { __id: `r_${crypto.randomUUID()}`, ...clean };
    });

    await store.insertRows(params.id, rows);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const denied = await requireAuth();
    if (denied) return denied;
    const ds = await store.get(params.id);
    if (!ds) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = await req.json();
    const raw = body?.patches;
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      raw.some(
        (p) =>
          typeof p?.__id !== "string" ||
          typeof p?.values !== "object" ||
          p.values === null ||
          Array.isArray(p.values)
      )
    ) {
      return NextResponse.json({ error: "invalid patches" }, { status: 400 });
    }

    // Only known field ids may be written; __id stays server-controlled.
    const fieldIds = new Set(ds.fields.map((f) => f.id));
    const patches: RowPatch[] = raw.map((p) => ({
      __id: p.__id,
      values: Object.fromEntries(
        Object.entries(p.values as Record<string, unknown>).filter(([k]) => fieldIds.has(k))
      ),
    }));

    await store.updateRows(params.id, patches);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const denied = await requireAuth();
    if (denied) return denied;
    const ds = await store.get(params.id);
    if (!ds) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = await req.json();
    const rowIds = body?.rowIds;
    if (!Array.isArray(rowIds) || rowIds.length === 0 || rowIds.some((r) => typeof r !== "string")) {
      return NextResponse.json({ error: "invalid rowIds" }, { status: 400 });
    }

    const rowCount = await store.deleteRows(params.id, rowIds);
    return NextResponse.json({ ok: true, rowCount });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

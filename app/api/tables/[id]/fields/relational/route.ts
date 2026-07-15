import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTable } from "@/features/tables/repo";
import {
  createComputedField,
  createFormulaField,
  createLinkField,
} from "@/features/tables/relations";
import { requireAuth } from "@/shared/supabase/server";

// Create a relational field: link, lookup, rollup, count, formula.
//
// Separate from POST /fields because the payloads are genuinely different shapes
// and a single schema with fifteen optional keys would validate nothing.

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("link"),
    name: z.string().trim().min(1).max(120),
    targetTableId: z.string().uuid(),
    cardinality: z.enum(["one", "many"]).default("many"),
    symmetricName: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    type: z.literal("lookup"),
    name: z.string().trim().min(1).max(120),
    linkFieldId: z.string().uuid(),
    targetFieldId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("rollup"),
    name: z.string().trim().min(1).max(120),
    linkFieldId: z.string().uuid(),
    targetFieldId: z.string().uuid(),
    fn: z.enum(["count", "sum", "avg", "min", "max"]),
  }),
  z.object({
    type: z.literal("count"),
    name: z.string().trim().min(1).max(120),
    linkFieldId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("formula"),
    name: z.string().trim().min(1).max(120),
    expr: z.string().min(1).max(2000),
    /** Set when editing an existing formula rather than creating one. */
    fieldId: z.string().uuid().optional(),
  }),
]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const table = await getTable(params.id);
  if (!table) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = parsed.data;

  try {
    if (body.type === "link") {
      const field = await createLinkField(params.id, table.baseId, body);
      return NextResponse.json({ field });
    }

    if (body.type === "formula") {
      // A parse error, or a cycle, lands here. Both are the user's mistake and
      // both have a message worth showing verbatim — "There is no field called
      // 'Amont'" beats "invalid formula".
      const field = await createFormulaField(
        params.id,
        table.baseId,
        { name: body.name, expr: body.expr },
        body.fieldId
      );
      return NextResponse.json({ field });
    }

    const field = await createComputedField(params.id, table.baseId, body);
    return NextResponse.json({ field });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

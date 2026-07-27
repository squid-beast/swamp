import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, requireAuth } from "@/shared/supabase/server";
import {
  loadViewConfig,
  saveFilterTree,
  saveSorts,
  saveViewFields,
} from "@/features/tables/view-config";
import { filterNodeSchema, sortSpecSchema } from "@/features/tables/schema";
import type { FilterNode } from "@/features/tables/types";

// A view's saved config: filters, sorts, per-field visibility/order/width.
//
// Every toolbar change writes here immediately. That's what Airtable does, and
// it's what people expect — a filter you set is a filter that's set, not one
// waiting behind a Save button you forgot to press.
//
// The cost of that choice, written down rather than assumed: two people editing
// the same view's filters last-write-wins the WHOLE tree, not per-condition.
// Fine while views aren't shared. Worth revisiting the moment they are.

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    filter: filterNodeSchema.nullable(),
    sorts: z.array(sortSpecSchema).max(10),
    viewFields: z.array(
      z.object({
        fieldId: z.string().uuid(),
        show: z.boolean().optional(),
        sortOrder: z.number().optional(),
        width: z.number().int().min(60).max(1000).optional(),
        // Grouping. `groupByOrder` is the level (0 = outermost); null clears it.
        // Three levels, like NocoDB (nc-gui/composables/useViewGroupBy.ts:27).
        groupBy: z.boolean().optional(),
        groupByOrder: z.number().int().min(0).max(2).nullable().optional(),
        groupByDir: z.enum(["asc", "desc"]).nullable().optional(),
        // The chosen footer summary. null clears it. The name is validated for the
        // field's type in swamp_aggregate, where the catalog is; here it's just a
        // persisted string.
        aggregation: z.string().max(40).nullable().optional(),
        formConfig: z
          .object({
            label: z.string().max(200).optional(),
            help: z.string().max(500).optional(),
            required: z.boolean().optional(),
            visibleWhen: z
              .object({ fieldId: z.string().uuid(), equals: z.string() })
              .optional(),
            limitedOptions: z.array(z.string()).max(100).optional(),
          })
          .optional(),
      })
    ),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/** The view row, for its table_id and base_id. Both are needed to write config. */
async function viewOwner(viewId: string) {
  const { data } = await createClient()
    .from("views")
    .select("table_id, base_id")
    .eq("id", viewId)
    .is("deleted_at", null)
    .maybeSingle();
  return data as { table_id: string; base_id: string } | null;
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const owner = await viewOwner(params.id);
  if (!owner) return NextResponse.json({ error: "not found" }, { status: 404 });

  const config = await loadViewConfig(params.id, owner.table_id);
  return NextResponse.json(config);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const owner = await viewOwner(params.id);
  if (!owner) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { filter, sorts, viewFields } = parsed.data;

  try {
    // `filter` present-and-null means "clear the filters"; absent means "don't
    // touch them". Collapsing those two would make it impossible to remove the
    // last filter from a view.
    if (filter !== undefined) {
      await saveFilterTree(
        params.id,
        owner.base_id,
        owner.table_id,
        filter as FilterNode | null
      );
    }
    if (sorts !== undefined) {
      await saveSorts(params.id, owner.base_id, owner.table_id, sorts);
    }
    if (viewFields !== undefined) {
      await saveViewFields(params.id, owner.base_id, viewFields);
    }

    const config = await loadViewConfig(params.id, owner.table_id);
    return NextResponse.json(config);
  } catch (e) {
    // A locked view, or an editor who isn't allowed. RLS said no.
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

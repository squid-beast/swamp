import "server-only";
import { createClient } from "@/shared/supabase/server";

// The sidebar tree: bases, each with its tables.
//
// One query per level rather than a nested PostgREST select, because the two
// levels have different RLS paths and a join would hide which one denied you.

export interface NavTable {
  id: string;
  name: string;
}

export interface NavBase {
  id: string;
  name: string;
  tables: NavTable[];
}

export async function listNav(): Promise<NavBase[]> {
  const db = createClient();

  const { data: bases, error: basesError } = await db
    .from("bases")
    .select("id, name, sort_order")
    .is("deleted_at", null)
    .order("sort_order");
  if (basesError) throw new Error(`listNav bases: ${basesError.message}`);
  if (!bases?.length) return [];

  const { data: tables, error: tablesError } = await db
    .from("tables")
    .select("id, base_id, name, sort_order")
    .is("deleted_at", null)
    .order("sort_order");
  if (tablesError) throw new Error(`listNav tables: ${tablesError.message}`);

  const byBase = new Map<string, NavTable[]>();
  for (const t of tables ?? []) {
    const list = byBase.get(t.base_id as string) ?? [];
    list.push({ id: t.id as string, name: t.name as string });
    byBase.set(t.base_id as string, list);
  }

  return bases.map((b) => ({
    id: b.id as string,
    name: b.name as string,
    tables: byBase.get(b.id as string) ?? [],
  }));
}

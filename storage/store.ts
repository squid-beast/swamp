import fs from "fs";
import path from "path";
import { Dataset, DatasetSummary, FieldOverride, Row, RowPatch, ViewConfig } from "@/core/types";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

// ── StorageAdapter: swap FileStore for SupabaseStore in the morning without
//    touching any route or component. Same method signatures. ──

export interface StorageAdapter {
  list(): Promise<DatasetSummary[]>;
  get(id: string): Promise<Dataset | null>;
  getRows(id: string): Promise<Row[]>;
  create(ds: Dataset, rows: Row[]): Promise<void>;
  saveOverrides(id: string, overrides: Record<string, FieldOverride>): Promise<void>;
  saveViews(id: string, views: ViewConfig[]): Promise<void>;
  updateRows(id: string, patches: RowPatch[]): Promise<void>;
  deleteRows(id: string, rowIds: string[]): Promise<number>; // returns new rowCount
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const DATA_DIR = path.join(process.cwd(), "data");

class FileStore implements StorageAdapter {
  private ensure() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  private dsPath(id: string) { return path.join(DATA_DIR, `${id}.meta.json`); }
  private rowsPath(id: string) { return path.join(DATA_DIR, `${id}.rows.json`); }

  async list(): Promise<DatasetSummary[]> {
    this.ensure();
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".meta.json"));
    return files
      .map((f) => {
        const ds: Dataset = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
        return {
          id: ds.id,
          name: ds.name,
          source: ds.source,
          rowCount: ds.rowCount,
          fieldCount: ds.fields.length,
          updatedAt: ds.updatedAt,
          recommendedViews: ds.views.map((v) => v.type),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Dataset | null> {
    this.ensure();
    const p = this.dsPath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }

  async getRows(id: string): Promise<Row[]> {
    this.ensure();
    const p = this.rowsPath(id);
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }

  async create(ds: Dataset, rows: Row[]): Promise<void> {
    this.ensure();
    fs.writeFileSync(this.dsPath(ds.id), JSON.stringify(ds));
    fs.writeFileSync(this.rowsPath(ds.id), JSON.stringify(rows));
  }

  async saveOverrides(id: string, overrides: Record<string, FieldOverride>): Promise<void> {
    const ds = await this.get(id);
    if (!ds) throw new Error("not found");
    ds.overrides = overrides;
    ds.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.dsPath(id), JSON.stringify(ds));
  }

  async saveViews(id: string, views: ViewConfig[]): Promise<void> {
    const ds = await this.get(id);
    if (!ds) throw new Error("not found");
    ds.views = views;
    ds.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.dsPath(id), JSON.stringify(ds));
  }

  async updateRows(id: string, patches: RowPatch[]): Promise<void> {
    const ds = await this.get(id);
    if (!ds) throw new Error("not found");
    const byId = new Map(patches.map((p) => [p.__id, p.values]));
    const rows = (await this.getRows(id)).map((r) => {
      const values = byId.get(r.__id);
      return values ? { ...r, ...values, __id: r.__id } : r;
    });
    fs.writeFileSync(this.rowsPath(id), JSON.stringify(rows));
    ds.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.dsPath(id), JSON.stringify(ds));
  }

  async deleteRows(id: string, rowIds: string[]): Promise<number> {
    const ds = await this.get(id);
    if (!ds) throw new Error("not found");
    const drop = new Set(rowIds);
    const rows = (await this.getRows(id)).filter((r) => !drop.has(r.__id));
    fs.writeFileSync(this.rowsPath(id), JSON.stringify(rows));
    ds.rowCount = rows.length;
    ds.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.dsPath(id), JSON.stringify(ds));
    return rows.length;
  }

  async rename(id: string, name: string): Promise<void> {
    const ds = await this.get(id);
    if (!ds) throw new Error("not found");
    ds.name = name;
    ds.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.dsPath(id), JSON.stringify(ds));
  }

  async remove(id: string): Promise<void> {
    for (const p of [this.dsPath(id), this.rowsPath(id)]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
}

// ── SupabaseStore: Postgres-backed, per-user via RLS. Uses a per-request
//    cookie-authenticated client, so auth.uid() scopes every read/write; no
//    service-role bypass. supabase-js talks to PostgREST over HTTP, so there is
//    no raw Postgres connection to pool/exhaust from the app. ──

const MAX_ROWS = 5000; // cap the initial row load — never return 50k rows for one page
const ROW_CHUNK = 1000; // bulk-insert page size

const rowValues = (r: Row): Record<string, unknown> => {
  const { __id, ...rest } = r;
  void __id;
  return rest;
};

class SupabaseStore implements StorageAdapter {
  private db() {
    return createClient();
  }

  private async ownerId(): Promise<string> {
    const {
      data: { user },
    } = await this.db().auth.getUser();
    if (!user) throw new Error("unauthenticated");
    return user.id;
  }

  async list(): Promise<DatasetSummary[]> {
    // One query, explicit columns (no rows), RLS-scoped, newest first.
    const { data, error } = await this.db()
      .from("datasets")
      .select("id,name,source,row_count,updated_at,fields,views")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((d) => ({
      id: d.id as string,
      name: d.name as string,
      source: d.source as Dataset["source"],
      rowCount: (d.row_count as number) ?? 0,
      fieldCount: Array.isArray(d.fields) ? d.fields.length : 0,
      updatedAt: d.updated_at as string,
      recommendedViews: Array.isArray(d.views)
        ? (d.views as ViewConfig[]).map((v) => v.type)
        : [],
    }));
  }

  async get(id: string): Promise<Dataset | null> {
    const { data, error } = await this.db()
      .from("datasets")
      .select("id,name,source,fields,overrides,views,row_count,created_at,updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id as string,
      name: data.name as string,
      source: data.source as Dataset["source"],
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string,
      fields: data.fields as Dataset["fields"],
      overrides: (data.overrides as Dataset["overrides"]) ?? {},
      views: (data.views as ViewConfig[]) ?? [],
      rowCount: (data.row_count as number) ?? 0,
    };
  }

  async getRows(id: string): Promise<Row[]> {
    // Ordered + capped via the dataset_rows_order_idx index. Never unbounded.
    const { data, error } = await this.db()
      .from("dataset_rows")
      .select("row_id,data")
      .eq("dataset_id", id)
      .order("ord", { ascending: true })
      .range(0, MAX_ROWS - 1);
    if (error) throw error;
    return (data ?? []).map(
      (r) => ({ __id: r.row_id as string, ...(r.data as Record<string, unknown>) }) as Row
    );
  }

  async create(ds: Dataset, rows: Row[]): Promise<void> {
    const owner_id = await this.ownerId();
    const db = this.db();
    const { error: dErr } = await db.from("datasets").insert({
      id: ds.id,
      owner_id,
      name: ds.name,
      source: ds.source,
      fields: ds.fields,
      overrides: ds.overrides ?? {},
      views: ds.views ?? [],
      row_count: rows.length,
    });
    if (dErr) throw dErr;
    for (let i = 0; i < rows.length; i += ROW_CHUNK) {
      const chunk = rows.slice(i, i + ROW_CHUNK).map((r, j) => ({
        dataset_id: ds.id,
        row_id: r.__id,
        ord: i + j,
        data: rowValues(r),
      }));
      const { error: rErr } = await db.from("dataset_rows").insert(chunk);
      if (rErr) throw rErr;
    }
  }

  async saveOverrides(id: string, overrides: Record<string, FieldOverride>): Promise<void> {
    const { error } = await this.db()
      .from("datasets")
      .update({ overrides, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  async saveViews(id: string, views: ViewConfig[]): Promise<void> {
    const { error } = await this.db()
      .from("datasets")
      .update({ views, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  async updateRows(id: string, patches: RowPatch[]): Promise<void> {
    const db = this.db();
    const ids = patches.map((p) => p.__id);
    // Fetch only the affected rows (one query), merge, then one upsert. No N+1.
    const { data, error } = await db
      .from("dataset_rows")
      .select("row_id,ord,data")
      .eq("dataset_id", id)
      .in("row_id", ids);
    if (error) throw error;
    const byId = new Map(patches.map((p) => [p.__id, p.values]));
    const merged = (data ?? []).map((r) => ({
      dataset_id: id,
      row_id: r.row_id as string,
      ord: r.ord as number, // preserve order across the upsert
      data: { ...(r.data as Record<string, unknown>), ...(byId.get(r.row_id as string) ?? {}) },
    }));
    if (merged.length) {
      const { error: uErr } = await db
        .from("dataset_rows")
        .upsert(merged, { onConflict: "dataset_id,row_id" });
      if (uErr) throw uErr;
    }
    await db.from("datasets").update({ updated_at: new Date().toISOString() }).eq("id", id);
  }

  async deleteRows(id: string, rowIds: string[]): Promise<number> {
    const db = this.db();
    const { error } = await db.from("dataset_rows").delete().eq("dataset_id", id).in("row_id", rowIds);
    if (error) throw error;
    // Exact count, head-only (no rows fetched), then persist the new total.
    const { count, error: cErr } = await db
      .from("dataset_rows")
      .select("row_id", { count: "exact", head: true })
      .eq("dataset_id", id);
    if (cErr) throw cErr;
    const rowCount = count ?? 0;
    await db
      .from("datasets")
      .update({ row_count: rowCount, updated_at: new Date().toISOString() })
      .eq("id", id);
    return rowCount;
  }

  async rename(id: string, name: string): Promise<void> {
    const { error } = await this.db()
      .from("datasets")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    // FK cascade removes dataset_rows.
    const { error } = await this.db().from("datasets").delete().eq("id", id);
    if (error) throw error;
  }
}

// Supabase when configured, else the local FileStore (dev without a project).
export const store: StorageAdapter = isSupabaseConfigured
  ? new SupabaseStore()
  : new FileStore();

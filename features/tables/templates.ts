import "server-only";
import { createClient } from "@/shared/supabase/server";
import { deriveFieldKey } from "./repo";
import { createLinkField, setLinks } from "./relations";
import type { FieldOptions, FieldType, ViewConfig, ViewType } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Starter templates — a base that opens as a working product, not a blank grid.
//
// User-initiated only (a click), never auto-seeded. Each template assembles a
// base + tables + typed fields + real linked records + a few example rows + the
// right views, using the same inserts the import path uses plus the relations API
// for cross-table links. `blank` makes an empty one-table base. Everything runs on
// the RLS-scoped session client; the caller must be at least a creator, which the
// workspace owner always is.
//
// Build is two passes: (1) tables, scalar fields, views, records — capturing each
// record's id by its primary value; (2) link fields + edges, resolving each row's
// link reference (a name) to the target record id.
// ════════════════════════════════════════════════════════════════════════════

interface FieldDef {
  name: string;
  type: FieldType;
  options?: FieldOptions;
}
interface LinkDef {
  /** The link field's name on this table. */
  name: string;
  /** The table (by name, within this template) it points at. */
  target: string;
  cardinality?: "one" | "many";
  /** What the mirror field is called on the target table. */
  symmetricName?: string;
}
interface ViewDef {
  name: string;
  type: ViewType;
  stackField?: string; // singleSelect field to stack a kanban by
  dateField?: string; // date field to lay a calendar on
}
interface TableDef {
  name: string;
  fields: FieldDef[];
  links?: LinkDef[];
  /** Keyed by field NAME. A key matching a link field name is a link reference
   *  (the target record's primary value), resolved in pass 2. */
  rows?: Record<string, unknown>[];
  views?: ViewDef[];
}
interface TemplateDef {
  name: string;
  open?: string; // table name to open after creation
  tables: TableDef[];
}

const sel = (...pairs: [string, string][]): FieldOptions => ({
  options: pairs.map(([value, color]) => ({ value, color })),
});

const TEMPLATES = {
  blank: {
    name: "Untitled base",
    tables: [{ name: "Table 1", fields: [{ name: "Name", type: "text" }] }],
  },

  crm: {
    name: "CRM",
    open: "Deals",
    tables: [
      {
        name: "Companies",
        fields: [
          { name: "Name", type: "text" },
          {
            name: "Industry",
            type: "singleSelect",
            options: sel(["SaaS", "sky"], ["Fintech", "violet"], ["Healthcare", "teal"], ["Retail", "amber"], ["Agency", "rose"]),
          },
          { name: "Website", type: "url" },
          { name: "Notes", type: "longText" },
        ],
        rows: [
          { Name: "Globex", Industry: "SaaS", Website: "https://globex.example.com", Notes: "Expanding into the EU next quarter." },
          { Name: "Initech", Industry: "Fintech", Website: "https://initech.example.com" },
          { Name: "Umbrella", Industry: "Healthcare", Website: "https://umbrella.example.com" },
          { Name: "Soylent", Industry: "Retail", Website: "https://soylent.example.com" },
          { Name: "Hooli", Industry: "SaaS", Website: "https://hooli.example.com", Notes: "Warm intro via Alice." },
        ],
      },
      {
        name: "Contacts",
        fields: [
          { name: "Name", type: "text" },
          { name: "Title", type: "text" },
          { name: "Email", type: "email" },
          { name: "Phone", type: "phone" },
        ],
        links: [{ name: "Company", target: "Companies", cardinality: "one", symmetricName: "Contacts" }],
        rows: [
          { Name: "Alice Morgan", Title: "VP Sales", Email: "alice@globex.example.com", Phone: "+1 415 555 0110", Company: "Globex" },
          { Name: "Raj Kapoor", Title: "CTO", Email: "raj@initech.example.com", Phone: "+1 415 555 0121", Company: "Initech" },
          { Name: "Jordan Pike", Title: "Ops Lead", Email: "jordan@hooli.example.com", Phone: "+1 415 555 0132", Company: "Hooli" },
        ],
      },
      {
        name: "Deals",
        fields: [
          { name: "Name", type: "text" },
          {
            name: "Stage",
            type: "singleSelect",
            options: sel(["Lead", "sky"], ["Qualified", "violet"], ["Proposal", "amber"], ["Won", "teal"], ["Lost", "rose"]),
          },
          { name: "Amount", type: "currency", options: { currency: "USD" } },
          { name: "Owner", type: "text" },
          { name: "Close date", type: "date" },
        ],
        links: [{ name: "Company", target: "Companies", cardinality: "one", symmetricName: "Deals" }],
        rows: [
          { Name: "Globex — annual", Stage: "Won", Amount: 91750, Owner: "AM", "Close date": "2026-07-10", Company: "Globex" },
          { Name: "Initech — pilot", Stage: "Proposal", Amount: 12000, Owner: "RK", "Close date": "2026-08-01", Company: "Initech" },
          { Name: "Umbrella — renewal", Stage: "Qualified", Amount: 27400, Owner: "JP", "Close date": "2026-08-15", Company: "Umbrella" },
          { Name: "Hooli — expansion", Stage: "Lead", Amount: 63900, Owner: "JP", "Close date": "2026-09-01", Company: "Hooli" },
          { Name: "Soylent — trial", Stage: "Lost", Amount: 0, Owner: "RK", "Close date": "2026-07-05", Company: "Soylent" },
        ],
        views: [{ name: "Pipeline", type: "kanban", stackField: "Stage" }],
      },
    ],
  },

  "content-calendar": {
    name: "Content calendar",
    open: "Content",
    tables: [
      {
        name: "Content",
        fields: [
          { name: "Title", type: "text" },
          {
            name: "Status",
            type: "singleSelect",
            options: sel(["Idea", "sky"], ["Drafting", "amber"], ["Scheduled", "violet"], ["Published", "teal"]),
          },
          {
            name: "Channel",
            type: "singleSelect",
            options: sel(["Blog", "teal"], ["YouTube", "rose"], ["Newsletter", "amber"], ["Social", "violet"]),
          },
          { name: "Owner", type: "text" },
          { name: "Publish date", type: "date" },
        ],
        rows: [
          { Title: "Launch announcement", Status: "Scheduled", Channel: "Blog", Owner: "You", "Publish date": "2026-07-20" },
          { Title: "How SWAMP handles data", Status: "Drafting", Channel: "Newsletter", Owner: "You", "Publish date": "2026-07-24" },
          { Title: "Import a spreadsheet demo", Status: "Idea", Channel: "YouTube", Owner: "You", "Publish date": "2026-08-02" },
          { Title: "Behind the build", Status: "Published", Channel: "Social", Owner: "You", "Publish date": "2026-07-08" },
        ],
        views: [
          { name: "Calendar", type: "calendar", dateField: "Publish date" },
          { name: "Board", type: "kanban", stackField: "Status" },
        ],
      },
    ],
  },

  "bug-tracker": {
    name: "Bug tracker",
    open: "Bugs",
    tables: [
      {
        name: "Bugs",
        fields: [
          { name: "Title", type: "text" },
          {
            name: "Priority",
            type: "singleSelect",
            options: sel(["Low", "lime"], ["Medium", "amber"], ["High", "orange"], ["Urgent", "rose"]),
          },
          {
            name: "Status",
            type: "singleSelect",
            options: sel(["To do", "sky"], ["In progress", "amber"], ["In review", "violet"], ["Done", "teal"]),
          },
          { name: "Assignee", type: "text" },
          { name: "Opened", type: "date" },
        ],
        rows: [
          { Title: "Login redirect loops on www", Priority: "Urgent", Status: "In progress", Assignee: "You", Opened: "2026-07-15" },
          { Title: "Kanban card drag flickers", Priority: "Medium", Status: "To do", Assignee: "You", Opened: "2026-07-14" },
          { Title: "Export misses hidden columns", Priority: "High", Status: "In review", Assignee: "You", Opened: "2026-07-12" },
          { Title: "Dark-mode logo contrast", Priority: "Low", Status: "Done", Assignee: "You", Opened: "2026-07-09" },
        ],
        views: [{ name: "Board", type: "kanban", stackField: "Status" }],
      },
    ],
  },
} satisfies Record<string, TemplateDef>;

export type TemplateId = keyof typeof TEMPLATES;

export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === "string" && v in TEMPLATES;
}

async function currentWorkspaceId(): Promise<string> {
  const { data, error } = await createClient()
    .from("workspace_members")
    .select("workspace_id")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`workspace lookup failed: ${error.message}`);
  if (!data) throw new Error("no workspace — the signup bootstrap did not run");
  return data.workspace_id as string;
}

interface TableCtx {
  tableId: string;
  primaryName: string;
  recordIdByPrimary: Map<string, string>;
  rows: Record<string, unknown>[];
  links: LinkDef[];
}

export async function createTemplateBase(
  id: TemplateId
): Promise<{ baseId: string; tableId: string }> {
  const def: TemplateDef = TEMPLATES[id];
  const db = createClient();
  const workspaceId = await currentWorkspaceId();

  const { data: base, error: baseErr } = await db
    .from("bases")
    .insert({ workspace_id: workspaceId, name: def.name })
    .select("id")
    .single();
  if (baseErr) throw new Error(`create base: ${baseErr.message}`);
  const baseId = base.id as string;

  let openTableId = "";
  const ctx = new Map<string, TableCtx>();

  // ── Pass 1: tables, scalar fields, views, records ──
  for (const t of def.tables) {
    const linkNames = new Set((t.links ?? []).map((l) => l.name));

    const { data: table, error: tErr } = await db
      .from("tables")
      .insert({ base_id: baseId, name: t.name })
      .select("id")
      .single();
    if (tErr) throw new Error(`create table ${t.name}: ${tErr.message}`);
    const tableId = table.id as string;
    if (!openTableId) openTableId = tableId;
    if (def.open === t.name) openTableId = tableId;

    const taken = new Set<string>();
    const fieldRows = t.fields.map((f, i) => {
      const key = deriveFieldKey(f.name, taken);
      taken.add(key);
      return {
        table_id: tableId,
        base_id: baseId,
        name: f.name,
        key,
        type: f.type,
        options: f.options ?? {},
        is_primary: i === 0,
        sort_order: i + 1,
      };
    });
    const { data: inserted, error: fErr } = await db
      .from("fields")
      .insert(fieldRows)
      .select("id, name, key");
    if (fErr) throw new Error(`create fields ${t.name}: ${fErr.message}`);
    const byName = new Map(
      (inserted ?? []).map((f) => [f.name as string, { id: f.id as string, key: f.key as string }])
    );

    const { error: gvErr } = await db.from("views").insert({
      table_id: tableId,
      base_id: baseId,
      type: "grid",
      name: "Grid",
      is_default: true,
    });
    if (gvErr) throw new Error(`create grid view ${t.name}: ${gvErr.message}`);

    for (const v of t.views ?? []) {
      const config: ViewConfig = {};
      if (v.stackField) config.stackFieldId = byName.get(v.stackField)?.id;
      if (v.dateField) {
        const fid = byName.get(v.dateField)?.id;
        if (fid) config.ranges = [{ fromFieldId: fid }];
      }
      const { error: vErr } = await db.from("views").insert({
        table_id: tableId,
        base_id: baseId,
        type: v.type,
        name: v.name,
        config,
      });
      if (vErr) throw new Error(`create view ${v.name}: ${vErr.message}`);
    }

    const primaryName = t.fields[0]?.name ?? "";
    const primaryKey = byName.get(primaryName)?.key ?? "";
    const recordIdByPrimary = new Map<string, string>();
    const rows = t.rows ?? [];

    if (rows.length) {
      const recordRows = rows.map((row, idx) => {
        const data: Record<string, unknown> = {};
        for (const [fname, val] of Object.entries(row)) {
          if (val == null || val === "") continue;
          if (linkNames.has(fname)) continue; // link references belong to pass 2
          const fk = byName.get(fname)?.key;
          if (fk) data[fk] = val;
        }
        return { table_id: tableId, base_id: baseId, data, sort_order: idx + 1 };
      });
      const { data: insRecs, error: rErr } = await db
        .from("records")
        .insert(recordRows)
        .select("id, data");
      if (rErr) throw new Error(`insert rows ${t.name}: ${rErr.message}`);
      for (const rec of insRecs ?? []) {
        const pv = primaryKey ? (rec.data as Record<string, unknown>)?.[primaryKey] : undefined;
        if (pv != null) recordIdByPrimary.set(String(pv), rec.id as string);
      }
    }

    ctx.set(t.name, { tableId, primaryName, recordIdByPrimary, rows, links: t.links ?? [] });
  }

  // ── Pass 2: link fields + edges ──
  for (const t of def.tables) {
    const self = ctx.get(t.name);
    if (!self) continue;
    for (const link of self.links) {
      const target = ctx.get(link.target);
      if (!target) continue;

      const field = await createLinkField(self.tableId, baseId, {
        name: link.name,
        targetTableId: target.tableId,
        cardinality: link.cardinality ?? "one",
        symmetricName: link.symmetricName,
      });

      for (const row of self.rows) {
        const fromPv = self.primaryName ? row[self.primaryName] : undefined;
        const toVal = row[link.name];
        if (fromPv == null || toVal == null || toVal === "") continue;
        const fromId = self.recordIdByPrimary.get(String(fromPv));
        const toId = target.recordIdByPrimary.get(String(toVal));
        if (fromId && toId) {
          await setLinks(field.id, baseId, fromId, [toId]);
        }
      }
    }
  }

  return { baseId, tableId: openTableId };
}

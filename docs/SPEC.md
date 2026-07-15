# SWAMP — Product & Architecture Spec

**Status:** Draft v1 · 2026-07-14
**Purpose:** Define what SWAMP becomes: a relational, view-driven, collaborative data workspace — Airtable-class.

---

## 0. Provenance & legal position

This spec was written after studying NocoDB (`develop` branch) as a **reference implementation** — reading it to understand *what* a product in this category must do and *why* certain designs are load-bearing.

Two constraints follow, and they are not negotiable:

1. **NocoDB's `develop` branch is under the Sustainable Use License, not an open-source license.** It permits use and modification "only for your own internal business purposes or for non-commercial or personal use," permits distribution "only… free of charge for non-commercial purposes," and forbids altering or removing its notices. SWAMP is intended to be commercial. **Therefore no NocoDB source may be copied, ported line-by-line, or adapted into SWAMP.**
2. **This is a clean-room build.** SWAMP is React/Next.js/Supabase; NocoDB is Vue/Nuxt/NestJS. Every line is original by necessity as well as by policy. What we take is *understanding*: the shape of the problem, and which design decisions are the ones that matter.

Facts — that a filter tree needs an `and`/`or` node, that fractional indexing enables O(1) reorder, that formulas must be stored by column ID so renames don't break them — are not copyrightable. Implementations are. We take the former and write the latter.

---

## 1. The one decision everything else depends on

**How are records stored?**

Two viable answers:

| | **A. Real Postgres tables** (DDL at runtime) | **B. Generic `records` table** (JSONB per record) |
|---|---|---|
| Filter/sort/formula | Native SQL, native indexes | Expression indexes on `data->>'fld_x'` |
| Adding a field | `ALTER TABLE` | Insert a `columns` row. No DDL. |
| Supabase RLS | Policy per generated table — painful | **One policy on one table** |
| Migrations | You build a migration engine | None |
| Ceiling | Very high | High, if indexed properly |
| Time to build | Months | Weeks |

**SWAMP chooses B: a single `records` table with a JSONB `data` column.**

Rationale: SWAMP already stores records this way (`dataset_rows`), and it's the right call for a Supabase-native product. Runtime DDL fights RLS, fights Supabase migrations, and fights connection pooling. The performance gap is closable with expression + GIN indexes, and it only opens at a scale we are nowhere near.

**The thing we must get right instead:** filters, sorts, and aggregations must be **compiled to SQL and executed in Postgres** — never fetched-then-filtered in the browser. That is SWAMP's current fatal flaw (see §8) and fixing it is Phase 1.

---

## 2. Entity hierarchy

```
Workspace              (tenant; owns members + billing)
  └── Base             (the "app" — what a user calls a project)
        └── Table
              ├── Field        (a column definition)
              ├── View         (grid / gallery / kanban / form / calendar)
              │     ├── ViewField   (per-view visibility, order, width)
              │     ├── Filter      (a tree)
              │     └── Sort        (an ordered list)
              └── Record       (a row)
                    └── Link   (a record↔record edge)
```

Today SWAMP has a **flat list of `datasets`** and nothing above or below it. Introducing `Base → Table` re-parents every foreign key and every URL. **Do it now, while the only real user is us.**

### Naming
- `dataset` → **`table`**. A dataset was always a table; call it one.
- Keep "dataset" only as the *import* concept ("import a CSV into a new table").
- The current `/app/datasets/[id]` route becomes `/app/b/[baseId]/t/[tableId]/v/[viewId]`.

---

## 3. Data model

### 3.1 Field types

Keep all 23 existing scalar types. They're good, and `inference.ts` already produces them. Add these:

**Relational / computed (the whole point):**

| Type | Stores | Behavior |
|---|---|---|
| `link` | nothing (edges live in `links`) | Points at another table. Cardinality: `one`/`many`. Reading a cell returns linked records (or a count). |
| `lookup` | nothing | `{ linkFieldId, targetFieldId }` — pulls a value across a link. Returns a scalar through a one-link, an array through a many-link. Lookups may target other lookups (recursive; guard cycles). |
| `rollup` | nothing | `{ linkFieldId, targetFieldId, fn }` where `fn ∈ count \| sum \| avg \| min \| max \| countDistinct \| sumDistinct \| avgDistinct` |
| `formula` | nothing | See §3.4 |
| `count` | nothing | Degenerate rollup: `count` over a link |

**Data types we're missing:**

| Type | Notes |
|---|---|
| `attachment` | JSON array of `{ id, name, mime, size, path, width?, height? }`. Files in Supabase Storage. **URLs are signed at read time and never persisted.** Today's `image` type is a remote-URL string — keep it, but `attachment` is the real one. |
| `user` | One or more workspace member IDs. Options: `multiple`, `notify`. Hydrated to `{ id, email, name, avatar }` on read. |
| `button` | Not data — a per-row action. `{ label, style, action }` where action is `url` (from a formula) \| `webhook` \| `script`. |
| `barcode` / `qr` | Pure projections of another field. Store only `{ sourceFieldId, format }`. Rendered client-side. |
| `autoNumber` | Monotonic per-record counter, app-assigned on insert. Survives deletes. Distinct from the record ID. |
| `createdTime` / `modifiedTime` / `createdBy` / `modifiedBy` | Auto-maintained, read-only. Backed by real columns on `records`, surfaced as fields. |

**Computed/read-only set** (never accept a write): `link`, `lookup`, `rollup`, `formula`, `count`, `button`, `barcode`, `qr`, `autoNumber`, and the four created/modified types.

### 3.2 Fields are rows, not a JSONB blob

Today: `datasets.fields jsonb` + `datasets.overrides jsonb`, with field IDs generated by a **module-level counter** (`fidCounter`) — i.e. IDs are not stable across process restarts, and the `overrides` map is keyed by them.

**Replace with a real `fields` table with UUID primary keys.** Inference *proposes* a field; the row *is* the truth. The two-layer inference/override split collapses and a whole class of bugs disappears.

### 3.3 The two names every field has

Every field carries **both**:
- `name` — what the user sees. Renameable at will.
- `key` — the stable key into `records.data`. **Never changes.**

Users rename columns constantly. Nothing downstream — no formula, no filter, no view config — may reference a field by its display name.

### 3.4 Formulas

Store **three** representations:

1. `expr_raw` — what the user typed, with field *names*: `CONCAT({First Name}, " ", {Last Name})`
2. `expr` — the same with names replaced by **field IDs**. This is canonical. *A field rename must not break a single formula.*
3. `ast` — the cached parse tree.

Plus `error` — a formula is allowed to be broken; the cell renders an error, the query still runs.

**Formulas compile to SQL.** Walk the AST, emit a Postgres expression, inline it in the SELECT. Do not evaluate row-by-row in JS. This is the largest single chunk of work in the whole project and it is also the thing that makes rollups, lookups, filters, and sorts over computed fields *free* — they all compose into the same query.

Function set to target (v1): arithmetic and comparison operators, `CONCAT LEFT RIGHT MID LEN LOWER UPPER TRIM REPLACE SEARCH`, `ABS ROUND ROUNDUP ROUNDDOWN CEILING FLOOR MOD POWER SQRT MIN MAX SUM AVG`, `IF SWITCH AND OR NOT BLANK ISBLANK`, `NOW TODAY DATEADD DATEDIFF DATEFORMAT YEAR MONTH DAY WEEKDAY`, `RECORD_ID`.

### 3.5 Links

**Every link is a row in one `links` table** — regardless of cardinality:

```
links(id, base_id, field_id, from_record_id, to_record_id, order)
```

Cardinality (`one`/`many`) is a **constraint and a read shape**, not a different storage layout. A belongs-to is a link with a uniqueness constraint on `from_record_id`; a many-to-many is the same table with no constraint.

Why this and not FK columns + junction tables:
- One RLS policy instead of N.
- Link reordering is free (`order` is already there).
- No junction tables to create, name, hide, and garbage-collect.
- The entire "has-many and belongs-to drifted out of sync" bug class does not exist.

**Links are symmetric.** Creating a link field on Table A creates its mirror on Table B. They reference each other; deleting either cleans up both. This is the single most bug-prone operation in the system — write it once, test it hard.

### 3.6 Row order — fractional indexing

`records.order` is a **numeric/float**, not an integer.

To move a row between two neighbours: `new = (before + after) / 2`. **Only the moved row is written.** No reindexing, no lock contention, no O(n) update.

When precision runs out (midpoint == a neighbour), raise, rebalance that table's orders to clean integers, and retry. Rare, bounded.

SWAMP's `dataset_rows.ord` is currently an `int` — **reordering is literally not implementable** until this changes. Note the irony: `task_cards.position` is already `double precision` and does this correctly. Copy from our own board code.

### 3.7 Filters — a self-referencing tree

One table, one shape, arbitrary nesting:

```
filters(
  id, view_id (or hook_id / row_color_rule_id),
  parent_id       -- null = root. This is what makes nesting work.
  is_group        -- group node vs leaf condition
  logical_op      -- and | or | not
  field_id, op, value, value_field_id  -- leaf only
  order, enabled
)
```

**Siblings in a group share one logical operator.** (Row 1 reads "Where", row 2 offers the and/or dropdown, rows 3+ mirror row 2.) Enforce this at the model level or you will write "detect mixed operators and normalize" cleanup code later.

**Operators** are gated per field type, and their *labels are contextual*: `gt` renders as `>` on a number, "is after" on a date, and shouldn't be offered at all on a checkbox.

Full operator set: `eq neq like nlike empty notempty null notnull checked notchecked blank notblank anyof allof nanyof nallof gt lt gte lte in isWithin btw nbtw`.

**Date sub-operators — this is the feature that makes filters feel alive.** A date filter has a *second* dropdown carrying the real semantics, so "due in the next 7 days" is a **stored, relative, re-evaluated-every-query** filter and not a frozen literal:

- Point: `today tomorrow yesterday oneWeekAgo oneWeekFromNow oneMonthAgo oneMonthFromNow daysAgo(n) daysFromNow(n) exactDate`
- Range (with `isWithin`): `pastWeek pastMonth pastYear nextWeek nextMonth nextYear pastNumberOfDays(n) nextNumberOfDays(n)`

**Dynamic conditions:** a filter may compare a field to *another field* on the same record (`value_field_id`) rather than a literal.

**Current user:** user-type filters can target `@me`. This is what makes "My records" views work, and it costs almost nothing.

### 3.8 Sorts and grouping

**Sorts:** flat ordered list per view — `{ field_id, direction, order }`. Compiles to `ORDER BY`.

**Grouping:** not a separate table. Three columns on the `view_fields` row — `group_by (bool)`, `group_by_order (level)`, `group_by_dir`. Multi-level grouping falls out for free.

**Aggregations** (column footers + group headers), gated per type:
- Any: `count count_empty count_filled count_unique percent_empty percent_filled percent_unique`
- Number: `sum min max avg median std_dev range`
- Checkbox: `checked unchecked percent_checked percent_unchecked`
- Date: `earliest latest date_range`
- Attachment: `total_size`

### 3.9 Soft delete & trash

Two separate mechanisms:

- **Records:** a `deleted_at` column. Delete = UPDATE. **Every read is automatically wrapped with the not-deleted predicate** — make this impossible to forget by putting it in the query builder, not in each call site.
- **Schema objects** (tables, fields, views): a `trash` table recording `{ resource_type, resource_id, parent_type, parent_id, name, deleted_by, deleted_at, purge_after, cascade_set }`. Restoring a child whose parent is still trashed is an error — restore top-down. A background job hard-deletes past `purge_after`.

---

## 4. Proposed Supabase schema

```sql
-- ─── tenancy ────────────────────────────────────────────────────
workspaces(id, name, created_at)
workspace_members(workspace_id, user_id, role, created_at)   -- PK (workspace_id, user_id)

bases(id, workspace_id, name, icon, color, order, created_at, updated_at, deleted_at)
base_members(base_id, user_id, role, created_at)             -- overrides workspace role

-- ─── schema ─────────────────────────────────────────────────────
tables(id, base_id, name, icon, order, created_at, updated_at, deleted_at)

fields(
  id uuid pk, table_id, base_id,
  name text,                    -- display, renameable
  key text,                     -- stable key into records.data. NEVER changes.
  type text,                    -- FieldType
  options jsonb,                -- per-type config: select options, currency, precision,
                                --   link {targetTableId, cardinality, symmetricFieldId},
                                --   lookup {linkFieldId, targetFieldId},
                                --   rollup {linkFieldId, targetFieldId, fn},
                                --   formula {expr, expr_raw, ast, error}
  is_primary bool,              -- the display value; exactly one per table
  order numeric,
  created_at, updated_at, deleted_at
)

-- ─── views ──────────────────────────────────────────────────────
views(
  id, table_id, base_id, type, name,
  is_default bool,              -- one per table; not deletable
  lock_type text,               -- collaborative | locked | personal
  owner_id uuid,                -- for personal views
  config jsonb,                 -- per-type: grid{rowHeight} gallery{coverFieldId}
                                --   kanban{stackFieldId, stacks[]} form{...} calendar{ranges[]}
  share_id text unique,         -- public link slug (null = not shared)
  share_password_hash text,
  share_options jsonb,          -- { allowDownload, embed }
  order numeric, created_at, updated_at, deleted_at
)

view_fields(
  view_id, field_id, base_id,
  show bool, order numeric, width int,
  aggregation text,
  group_by bool, group_by_order numeric, group_by_dir text,
  form_config jsonb,            -- label, help, required, visibility rule, limited options
  primary key (view_id, field_id)
)

filters(
  id, base_id,
  view_id, hook_id, row_color_rule_id,    -- exactly one is set
  parent_id,                              -- self-ref → the tree
  is_group bool, logical_op text,
  field_id, op text, sub_op text, value jsonb, value_field_id,
  order numeric, enabled bool
)

sorts(id, view_id, base_id, field_id, direction, order)

-- ─── data ───────────────────────────────────────────────────────
records(
  id uuid pk,
  table_id, base_id,            -- DENORMALIZED. RLS reads base_id directly — no subquery.
  data jsonb,                   -- { [field.key]: value }
  order numeric,                -- FRACTIONAL. not int.
  created_at, updated_at, created_by, updated_by,
  deleted_at,
  auto_number bigint
)

links(
  id, base_id, field_id,
  from_record_id, to_record_id,
  order numeric,
  created_at
)

-- ─── collaboration ──────────────────────────────────────────────
comments(id, base_id, table_id, record_id, author_id, body jsonb,
         parent_id, resolved_by, resolved_at, created_at, updated_at)

audit(id, base_id, table_id, record_id, actor_id, op, details jsonb, created_at)

trash(id, base_id, resource_type, resource_id, parent_type, parent_id,
      name, deleted_by, deleted_at, purge_after, cascade_set jsonb)

-- ─── automation ─────────────────────────────────────────────────
hooks(id, base_id, table_id, name, event, operation, trigger_field_ids,
      action jsonb, active bool, created_at)
hook_logs(id, base_id, hook_id, record_id, payload jsonb, response jsonb,
          error text, duration_ms, created_at)

api_tokens(id, workspace_id, user_id, name, token_hash, scopes jsonb,
           last_used_at, expires_at, created_at)
```

### Indexes that are not optional

```sql
create index on records (table_id, order) where deleted_at is null;
create index on records using gin (data jsonb_path_ops);
-- + an expression index per field that's actually filtered/sorted on, created lazily:
--   create index on records ((data->>'fld_status')) where table_id = '...';
create index on links (field_id, from_record_id);
create index on links (field_id, to_record_id);
create index on filters (view_id, parent_id);
```

The GIN index gets you containment. The expression indexes get you range/ordering. Today `dataset_rows` has **exactly one index** (`dataset_id, ord`) — every server-side filter would be a seq scan.

### RLS

`records` currently checks ownership with an `EXISTS` subquery against `datasets` **per row**. That's fine at 5k rows and a disaster at 500k.

**Denormalize `base_id` onto every table** and write policies against a single `base_members` lookup. (Our own `task_cards` already does the denormalized-ownership thing correctly — copy it.)

---

## 5. The query engine

This is the product. Everything else is chrome.

A view is a saved `(filter tree, sort list, field projection, group-by)`. A request may add ad-hoc filter/sort/search on top. **All of it must compile into one SQL statement**, plus a bounded number of batched queries for links.

```
GET /api/tables/:id/records
  ?viewId=       -- pulls the view's saved filters/sorts/projection
  &filter=       -- ad-hoc, ANDed with the view's
  &sort=         -- overrides the view's
  &fields=       -- projection override
  &search=
  &groupBy=
  &limit=&cursor=
  &expand=       -- which link fields to hydrate, and how deep (cap at 3)
```

### Pipeline

1. Load table + fields (cached — meta is cached, records never are).
2. Resolve the projection: request `fields`, else the view's visible fields in view order.
3. **Build the SELECT.** Per field type:
   - scalar → `data->>'key'`, cast per type
   - `formula` → compile the AST to a Postgres expression, inline it. On compile error, emit a sentinel so the *cell* errors, not the query.
   - `rollup` / `count` → correlated aggregate subquery over `links`
   - `lookup` → resolved by the batched link loader (or inlined as a subquery when it's needed for a filter or sort)
   - `link` → count by default; rows only when `expand` asks
4. **WHERE** — fold the filter tree recursively into nested `and`/`or`/`not`. Comparison semantics dispatch on field type. Always append the not-deleted predicate. Filtering on a formula/lookup/rollup reuses the same compiled expression from step 3.
5. **ORDER BY** — the sort list, same type dispatch. **Then always append a tiebreaker** (`order`, then `id`). Without this, paginated reads duplicate and skip rows under concurrent writes. This bug is subtle, real, and will eat a week.
6. **LIMIT / cursor.**
7. **Hydrate links in batch.** A 50-row page with 5 link fields must be ~6 queries, not 251. Batch by `(field_id, from_record_id IN (...))`. Never resolve a link per row.
8. **Post-process:** sign attachment URLs, hydrate user fields, format dates.

### Response

```jsonc
{
  "records": [ { "id": "rec_…", "fields": { "Name": "…", "Owner": {…}, "Tasks": [ {…} ] } } ],
  "pageInfo": { "next": "cursor…", "prev": "cursor…" }
}
```

Cursor pagination, not offset. Offset pagination over a mutating table is wrong and the bug it causes (rows appearing twice across pages) is one users notice immediately.

---

## 6. The grid

### Rendering: canvas, with DOM for editing

The reference implementation renders the grid to **`<canvas>`**, not DOM, and keeps a DOM overlay only for the *active* cell's editor. It's worth understanding why before dismissing it:

- A virtualized DOM grid still churns nodes on every scroll frame.
- Hundreds of visible cells × arbitrary type renderers × row coloring × hover state = death by re-render.
- Canvas = one paint per frame, zero node churn.

**SWAMP's position:** start with a **virtualized DOM grid** (`@tanstack/react-virtual`), because it's 10× faster to build, debuggable, accessible, and testable. Design the cell renderer behind an interface (`draw(ctx, rect, value, field)` / `render(value, field)`) so that a canvas renderer can be swapped in later without touching anything above it. Revisit canvas when a real dataset makes the DOM grid stutter — not before.

Today's grid renders a plain `<table>` with `rows.map()` and **no virtualization at all**, capped at 5,000 rows. That has to go regardless of which target we pick.

### Interactions (the full list — this is what "Airtable-class" means)

| | Detail |
|---|---|
| **Selection** | Single cell. Shift+click and drag for a range. Ctrl/Cmd+A. |
| **Keyboard** | Arrows move. Tab / Shift+Tab move horizontally and wrap. Enter opens the editor; Enter again commits and moves down. Escape reverts. Typing any printable char replaces and enters edit mode. Cmd+Enter expands the record. Space toggles a checkbox. Delete/Backspace clears the range. |
| **Copy / paste** | TSV to the clipboard, so it round-trips with Excel and Sheets. Pasting a block writes a block, expanding rows if needed. Paste must respect field types (coerce, or reject with a toast). |
| **Fill handle** | Drag the bottom-right handle of a selection to fill down/right. Detect linear series on numbers and dates. |
| **Undo / redo** | Cmd+Z / Cmd+Shift+Z. A session action stack: cell edit, row add/delete, row reorder, column resize/reorder. **Build this early** — retrofitting undo into an app that mutates state ad hoc is brutal. Every mutation goes through a command object with `do()`/`undo()`. |
| **Row add** | An always-present "+" row at the bottom. New row inherits the active filter's values where unambiguous (filter is `Status = Open` → the new row gets `Open`). |
| **Row reorder** | Drag the row gutter. Fractional order → one UPDATE. Disabled when a sort is active. |
| **Column reorder** | Drag the header. Writes `view_fields.order`. |
| **Column resize** | Drag the header edge. Writes `view_fields.width`. Double-click to autofit. |
| **Frozen columns** | The primary field is frozen by default. A draggable freeze divider. |
| **Row height** | Short / Medium / Tall / Extra. Per-view. |
| **Row gutter** | Row number ↔ checkbox on hover, and an expand-record button. |
| **Context menus** | Right-click a cell (copy, paste, clear, insert row above/below, delete row, expand). Right-click a header (edit field, duplicate, insert left/right, freeze, sort, group, hide, delete). |
| **Footer aggregations** | Per-column summary, type-gated (§3.8). Click to change. |
| **Group-by** | Collapsible group headers with a count and the group's aggregate. Children load lazily per group. |

### Expanded record

A modal (or a side panel — the panel is nicer and worth building second):

- Header: primary field as the title, prev/next record navigation, copy-record-URL, duplicate, delete, close.
- Body: every visible field as a labelled editor, in view order. Hidden fields collapsed under "N hidden fields".
- Right rail, two tabs: **Comments** (rich text, @mentions → notifications, edit/delete/resolve, deep-linkable) and **History** (chronological field-level changes: old → new, plus created/deleted/restored events).
- Unsaved-changes guard.

`row-form.tsx` is already ~80% of this. It's the strongest editing surface we have — build the expanded record *out of it*, don't start over.

---

## 7. Views

| View | Required config | What it does |
|---|---|---|
| **Grid** | none | §6. Group-by and footer aggregations are grid-only. |
| **Gallery** | cover field (attachment) | Cards. Editing happens in the expanded record, not on the card face. |
| **Kanban** | stack field (single-select) | Stacks from the select's options, **plus an always-present "Uncategorized" stack** for nulls. Drag between stacks writes the select value. Drag within a stack reorders. Per-stack live counts. Collapse/expand (persisted). Rename a stack → renames the option. Delete a stack → deletes the option and **moves its records to Uncategorized**. Add a record into a stack → pre-fills that stack's value. **Stack metadata will drift from the select options — build the reconciliation (append new, drop deleted, rebuild if corrupt) from day one.** |
| **Form** | none | The deepest one. See below. |
| **Calendar** | one or more date ranges `{fromField, toField?}` | Day / week / month / year. Drag to re-date, resize to change span. A side panel of un-dated records you can drag onto the calendar. |
| **Timeline / Gantt** | date range + (Gantt) a dependency field | Later. Gantt needs a whole dependency-scheduling model. |
| **Map** | geo field | Later. |

### Form view — the details that separate a real form builder from a toy

- **Per-field:** label override, help text, required, **conditional visibility** (show this field only when another answer matches), **limited select options** (offer a subset of the field's real options), and an optional barcode-scanner input.
- **Pre-fill:** build a link with values baked in. Three modes — prefilled-but-editable, prefilled-and-locked, prefilled-and-hidden.
- **Form-level:** heading, subheading, logo, banner, background, success message, redirect URL + delay, "submit another response", auto-blank, email-a-copy to collaborators.
- **Survey mode:** one field per page.
- Skipping conditional visibility and limited options is *the* most common way form builders end up feeling like toys.

### View lock modes

Three, and the permission check is two-dimensional:

- **Collaborative** — any editor+ can change the view config.
- **Locked** — nobody can, until unlocked. Data editing still works.
- **Personal** — only the owner can. Others may open it read-only.

```
canEditViewConfig = role >= editor
                 && view.lock_type !== 'locked'
                 && (view.lock_type !== 'personal' || view.owner_id === me)
```

Model this as a helper, not a boolean. Note that **editors can freely change filters/sorts/fields on collaborative views** — that matches Airtable and users expect it.

---

## 8. What has to be torn out

From the audit of the current codebase. These are not extensions — they're replacements.

| # | Blocker | Fix |
|---|---|---|
| **B1** | `StorageAdapter.getRows(id)` takes **no arguments** — no page, filter, sort, or projection. | Becomes `query(tableId, q) → { records, total, cursor }`. Cascades to every route and component. |
| **B2** | `GET /api/datasets/[id]` returns the dataset **and all rows** in one payload. | Split into `/meta` and a paginated `/records`. |
| **B3** | `MAX_ROWS = 5000`, and it **silently truncates** — no error, no UI signal. Plus zero virtualization. | Server pagination + a windowed grid. |
| **B4** | Filters, sorts, and search are **client-side, in `useState`, and never persisted.** `ViewConfig.filters` and `.sort` are declared in the types and read by nothing. | Compile to SQL, execute in Postgres, persist to the `filters`/`sorts` tables. |
| **B5** | Views live in a `views` JSONB **array** on the dataset row. | A real `views` table. Today every view edit rewrites the whole array — a lost-update race. |
| **B6** | Fields live in a `fields` JSONB array + a separate `overrides` map, keyed by IDs from a **module-level counter**. | A real `fields` table with UUID PKs. Inference proposes; the row is the truth. |
| **B7** | `dataset_rows.ord` is an **`int`**. | `numeric`. Reordering is not implementable until this changes. |
| **B8** | `updateRows` does **read-modify-write of the whole `data` JSONB in JS.** Two concurrent cell edits on one row = a lost update. | `jsonb_set` server-side, plus an `updated_at` guard. |
| **B9** | No relations, and nowhere to put them. | The `links` table. Greenfield. |
| **B10** | No `bases` → `tables` hierarchy. | Re-parent now, before there's real data. |
| **B11** | `dataset_rows` has **one index**. No GIN, no expression indexes. | §4. |
| **B12** | `records` RLS runs an `EXISTS` subquery against the parent **per row**. | Denormalize `base_id`. |
| **B13** | Authorization is `owner_id` only. No roles, no members, no sharing. | `workspace_members` / `base_members` + a role cascade. Rewrites every RLS policy. |
| **B14** | `requireAuth()` returns **`null` (allowed)** when Supabase env vars are missing, and `middleware.ts` does the same. Boot prod with a missing env var and every API route is wide open. | Make missing env a **hard boot failure**. Delete `FileStore`. |

### Keep — this code is good

- **`engine/inference.ts`** — the best code in the repo. The three-phase heuristic, the leading-zero preservation, the "corroborating evidence" rule for numerics. Port as-is.
- **`engine/import.ts`'s XLSX parser** — format-hint tallying, currency-symbol preservation via `cell.w`, accounting-negative repair, the date-serial boundary snap that fixes the IST off-by-one. Hard-won. Keep.
- **`validate.ts`** — pure, per-type, already shared by grid and form. **Start calling it server-side on write**, which we currently don't — the API will happily store `"banana"` in a currency field.
- **`Cell.tsx`** — a clean read-only renderer for all 23 types, keyed only on `(field, value)`. Exactly the right shape. It needs an editable twin.
- **`row-form.tsx`** — 80% of the expanded record.
- **`0003_boards.sql`** — fractional `position` + parent-ownership-check RLS. The pattern `records` and `views` should copy. We already wrote the right thing once.
- **`records` as one Postgres row per record** — the correct storage primitive. We dodged the fatal one.

### Quarantine
- **`/api/agent/*`** (6 routes) — a single-owner personal CRM with hardcoded field arrays, N+1 upserts, and a service-role key. Not product surface. It will break on the first migration. Flag it off or move it out **before** the schema change.
- **`vercel.json` cron at `* * * * *`** — a serial scan of every sheet connection, with a token refresh and a full sheet read each, **every minute**. Does not survive 50 users.

---

## 9. Roles

Five, cascading (each inherits everything below):

| Role | Adds |
|---|---|
| **viewer** | read records, expanded record, read comments, read record history, export |
| **commenter** | create / edit / delete / resolve comments |
| **editor** | insert / edit / delete records; **change filters, sorts, grouping, field visibility on collaborative views**; create / update / delete views; share views; undo/redo; import into an existing table |
| **creator** | create / rename / delete tables; add / edit / delete fields; manage webhooks and API tokens; all imports; share the base |
| **owner** | delete the base; billing; audit log |

**The load-bearing line is editor → creator: editors change data and views; creators change schema.** Everything else derives from the ladder.

---

## 10. Open decisions

1. **Workspaces — now or later?** They add a tenancy layer we don't need for v1 but that is expensive to insert afterward (same argument as `bases`). *Lean: put the `workspace_id` column in from day one; keep the UI single-workspace until it matters.*
2. **Realtime.** Supabase Realtime on `records` is nearly free. But the originating client must not double-apply its own edit — every mutation carries a client ID and the subscriber ignores its own. Also: a link edit must invalidate the *other* table's rollup/lookup cells.
3. **Formula compiler scope for v1.** The full function set is weeks of work. Cut to arithmetic + `IF` + `CONCAT` + the date functions and expand from there?
4. **Attachments.** Supabase Storage, signed URLs at read time, a `file_references` table for GC. Straightforward but not free.
5. **Does the existing `task-board` feature fold into this?** A board is a kanban view over a table. Once tables + kanban exist, `task-board` is redundant. Migrate it or keep it as a separate simple product?

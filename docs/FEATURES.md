# What swamp actually does

Traced from code, not from docs — every claim below was checked as a chain:
**a button a user can click → a route → a data-layer call → SQL.** "The code exists" was not
accepted as evidence, because this repo has repeatedly had complete, tested functions with
zero callers.

**Verification status, honestly:** 13 areas traced. 61 of the WORKS claims were then handed
to a separate agent told to *refute* them; 2 were demoted (§3). The remaining WORKS claims are
traced-but-unchallenged — the run hit a session limit before finishing. Treat §2 as "traced
and believed", §3 as "verified broken".

---

## 1. What this is

**A working Airtable-style database.** You import a spreadsheet, it guesses your column
types, and you get a real relational table — links between tables, lookups, rollups,
formulas — with filtering, sorting, grouping and search that all execute in Postgres rather
than in the browser. You can share a view publicly, collect responses through a form, drive
it all from a REST API with scoped tokens, and fire webhooks on changes.

The engine is the strongest part: 37 field types, a nested AND/OR filter tree, keyset
pagination, and RLS as the actual security boundary. The gaps are in polish and admin UX.

---

## 2. What works

### The grid
| | |
|---|---|
| Records | Add, edit inline, delete, duplicate, expand; copy a link to a record and open it |
| Keyboard | Arrows, Tab (wraps), type-to-replace, Escape reverts, shift+arrow range, Delete clears, Space toggles a checkbox |
| Clipboard | Cmd+C / Cmd+V, pasting past the end extends the table |
| Undo/redo | Cmd+Z, Cmd+Shift+Z, Cmd+Y, toolbar buttons — including immediately after typing |
| Fill handle | Drag the corner square to continue a numeric series |
| Bulk | Row checkboxes + a bulk delete bar; clear a cell from the right-click menu |
| Row height | Short / Medium / Tall / Extra tall |

### Fields — 37 types, 28 with a real editor
**Fully working:** text, number, currency, percent, checkbox, date, date & time, time, year,
email, phone, URL, colour, UUID, single select, multi select, status, attachment, user,
link, formula, button, barcode, QR, created time, modified time, created by, modified by.

**Render but are thinner than the name suggests:** long text (plain textarea — no rich
text), rating, duration, image URL, coordinates (no map picker), JSON, lookup, rollup, count.

Create, rename, retype, reorder, hide/show and resize a field all work.

### Query engine — all of this executes in Postgres
| | |
|---|---|
| Filters | Nested AND / OR / NOT tree; operators gated per type — text, number, date (incl. live relative windows like "is within the last 7 days"), select, multi-select, checkbox |
| Sort | Multiple fields with precedence |
| Search | Toolbar search across the table, server-side |
| Pagination | Keyset cursor — scrolls a large table without offset drift |
| Group by | Up to 3 levels, with per-group counts over the filtered set, collapsible |
| Row total | True count, and it respects the search box |

### Views
Grid, Form (builder + public submission), Gallery all work. Kanban and Calendar render but
are partial. Create / rename / delete a view; filters, sorts, field visibility, field order,
column widths, grouping and row height all persist per view.

### Relational
Link two tables, pick records with a searchable picker, then lookup / rollup (sum, avg, min,
max, count) / count across the link. Formulas compute from other fields, parse as you type,
and are stored as an AST keyed by field **id** — so the computation survives a rename.
Rollups, formulas and lookups are SQL expressions, so you can **sort by them**, and search
finds records by their linked values.

### Sharing
Public share links for a view; password protection; anonymous read-only browsing with search
and paging. Hidden fields stay hidden — excluded in SQL, not stripped afterwards — and a
visitor cannot widen the view's filter or reach the table directly. Public forms accept
submissions, with conditional fields and limited options.

### Collaboration
Comments (edit/delete your own), a members panel that lists everyone, invites by email,
accept/revoke, five roles, per-field record history, and **realtime** — the grid live-updates
when a teammate edits.

### Import / export
CSV, TSV, XLSX/XLS and JSON import, with automatic type inference and Excel cell-format hints
that steer currency/percent detection. CSV export from a table view and (opt-in) from a share
link.

### API & automations
Mint scoped tokens (2 real scopes: `records:read`, `records:write`), 90-day default expiry,
plaintext shown once. `/api/v1` gives schema discovery plus record CRUD with the full filter
tree, sort, search and pagination — and computed fields now come back from writes. A token
acts as its owner with their **live** role, so removing someone kills their tokens.
Webhooks: create/delete/enable, record + comment events, HMAC-SHA256 signing, SSRF guards,
a delivery log.

### Account
Email/password sign-up and sign-in, password reset, workspace bootstrap, first-run name
capture, profile editing, and a middleware auth gate.

---

## 3. Verified broken — you will hit these

### Link mirror fields are always empty ⚠️ the big one
Creating a link creates the mirror column on the far table — and it never populates. Link
Acme from the Companies side and Companies.Deals shows it; Deals.Companies shows nothing.
The two directions are entirely separate edge sets. The dialog tells the user *"a link is one
edge seen from both ends, and the two can never disagree."* They always disagree. The
integration test misses it because it creates the mirror and only ever reads the near side.

### A formula cannot be edited after you rename a field it uses
The computation keeps working (the AST holds field ids). But the editor re-parses the frozen
original text against current names, throws *"There is no field called Price"*, disables Save,
and the server rejects it too. The function that would fix this exists and has **zero
callers** — while two comments claim it's wired in.

### Webhooks fire once a day
The dispatcher is a Vercel cron on `0 8 * * *` and is the only thing that delivers. So a
webhook lands up to 24h after its event, and the 1m→6h retry backoff is moot — each retry
waits another full day. The delivery code itself is excellent; one line of config throttles
it. (Almost certainly Vercel's Hobby-plan cron limit.) See `docs/DEPLOY.md`.

### Editing a link/lookup/rollup/count field creates a second one
The dialog's save path always INSERTs for these types. There is also no Delete button for any
computed or relational field.

---

## 4. Missing that you might expect

| | |
|---|---|
| Column footer totals | sum/avg/min/max/count — the vocabulary exists, the engine does not. **Zero callers.** |
| Record trash + restore | Soft delete is everywhere and the restore route exists; **no UI reaches it** |
| Sheets re-sync | Initial import works; the re-sync route has **no button** |
| Rich text | Long text is a plain textarea |
| @mention delivery | Mentions are parsed and stored, and delivered to nobody |
| Export | CSV only — no XLSX, no JSON |
| Import to an existing table | New tables only — no append/upsert, no type preview |
| Personal views · duplicate a base/field/view · base icon+colour · attachment thumbnails · account deletion · map picker | absent |

---

## 5. Demo it in this order

1. **Import a CSV** → watch it infer currency, dates and a select column, and land you in a
   working grid. This is the strongest 20 seconds in the product.
2. **Filter + group + sort**, then reload — the view persists, and it's all SQL. Show the row
   total tracking the search box.
3. **Link two tables, then rollup across the link** → and *sort by the rollup*. That's the
   thing a spreadsheet can't do. (Show the near side only — see §3.)
4. **Share the view publicly** and open it in a private window. Then password-protect it.
5. **Mint a token and curl `/api/v1/meta`** → the same engine, over REST, in one command.

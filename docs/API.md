# The SWAMP API

Everything a person can do to records, a token can do — and never more.

---

## The one thing to understand

**A token is not a second identity. It is a narrower view of one that already exists.**

- A token belongs to a **person** and a **base**.
- Its effective role is **recomputed from live membership on every call**.
- Its scopes can only **narrow** that role. They can never widen it.

So: give someone a `records:write` token, then demote them to viewer, and the token stops writing — on the next request, not at the next rotation. Remove them from the base and it stops working entirely.

The alternative — storing the role on the token when it's minted — is how *"we removed him in March and his integration was still writing to prod in July"* happens.

---

## Getting a token

**Base → API → New token.** Pick scopes, pick an expiry, copy it.

You will see the plaintext **once**. The database stores a SHA-256 of it and nothing else, so "I lost my token" has exactly one answer: make another one. Any product with a better answer than that is storing your token somewhere it can read it.

| Scope | What it opens |
|---|---|
| `records:read` | Read records. Requires **viewer**. |
| `records:write` | Create, update, delete records. Requires **editor**. |
| `schema:read` | Read tables and fields. |
| `webhooks:read` | Read webhooks and their delivery log. |
| `webhooks:write` | Create and change webhooks. |

Default expiry is 90 days. A token with no expiry is a credential that outlives the reason it was created.

---

## Authentication

```
Authorization: Bearer swamp_pat_…
```

Header only. Not a query parameter — that puts your token in every access log, every `Referer` header, and every screenshot of a browser address bar.

| Status | Means |
|---|---|
| `401` | The token is not good: missing, revoked, expired, or its owner left the base. |
| `403` | The token is good, but not allowed to do this — wrong scope, or its owner's role isn't enough. |
| `404` | No such table or record **in this base**. Deliberately indistinguishable from "it doesn't exist" — otherwise a token holder could enumerate ids across the whole database. |
| `400` | Your request. The message says which field. |

---

## `GET /api/v1/meta`

Start here. It returns the base, its tables, and the **key** of every field.

```bash
curl -H "Authorization: Bearer $SWAMP_TOKEN" \
  https://your-app/api/v1/meta
```

```json
{
  "base": { "id": "…", "name": "CRM" },
  "tables": [{
    "id": "018f…",
    "name": "Deals",
    "fields": [
      { "id": "…", "name": "Company", "key": "fld_company", "type": "text",     "isPrimary": true,  "readOnly": false },
      { "id": "…", "name": "Amount",  "key": "fld_amount",  "type": "currency", "isPrimary": false, "readOnly": false },
      { "id": "…", "name": "Total",   "key": "fld_total",   "type": "rollup",   "isPrimary": false, "readOnly": true  }
    ]
  }]
}
```

### Why `fields` is keyed by key, not by name

Airtable keys by name, and it is the single most common way an integration breaks *silently*: someone renames a column in the UI on a Tuesday, and a script that has run every night for a year stops. Nobody notices for a week.

**A key never changes.** You look them up once, from this endpoint, and your integration survives every rename anyone ever makes.

---

## Records

### List

```bash
curl -H "Authorization: Bearer $SWAMP_TOKEN" \
  "https://your-app/api/v1/tables/$TABLE/records?limit=50&sort=fld_amount:desc"
```

| Param | |
|---|---|
| `limit` | 1–500. Default 50. |
| `cursor` | From the previous page's `cursor`. Opaque — pass it back, don't read it. |
| `sort` | `fld_a:desc,fld_b` — ascending by default. |
| `search` | Across every text-ish field, including computed ones. |
| `filter` | A URL-encoded filter tree (below). |
| `count=1` | Also return `total`. It's the expensive half, so it's opt-in. |

```json
{
  "records": [
    { "id": "…", "fields": { "fld_company": "Acme", "fld_amount": 5000, "fld_total": 12500 }, "createdTime": "2026-07-14T…" }
  ],
  "cursor": "eyJrZXlzIjpb…"
}
```

Computed fields — rollups, lookups, formulas, URL buttons — arrive in `fields` alongside stored ones. You cannot write them; `meta` marks them `readOnly`.

**Pagination is keyset, not offset.** Keep passing `cursor` until it stops coming back. Offset pagination over a table that people are editing shows you the same row twice and skips another.

### Filtering

The same filter tree the app's own view filters use, so the operators are the same and there is no second dialect.

```bash
FILTER='{"op":"and","children":[
  {"field":"fld_status","op":"eq","value":"Won"},
  {"field":"fld_amount","op":"gt","value":1000}
]}'

curl -G -H "Authorization: Bearer $SWAMP_TOKEN" \
  --data-urlencode "filter=$FILTER" \
  "https://your-app/api/v1/tables/$TABLE/records"
```

Operators: `eq neq gt gte lt lte btw like nlike empty notempty anyof nanyof allof nallof checked notchecked isWithin`.

Dates take a `subOp` and are resolved **at query time**, not frozen when you wrote the filter — `{"field":"fld_due","op":"isWithin","subOp":"pastNumberOfDays","value":7}` means the last 7 days *today*.

### One record

```bash
curl -H "Authorization: Bearer $SWAMP_TOKEN" \
  "https://your-app/api/v1/tables/$TABLE/records/$RECORD"
```

### Create

```bash
curl -X POST -H "Authorization: Bearer $SWAMP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"records":[{"fields":{"fld_company":"Acme","fld_amount":5000}}]}' \
  "https://your-app/api/v1/tables/$TABLE/records"
```

Up to 1000 at a time. Keys that aren't writable fields are **dropped**, not rejected — so you can read a record, change one thing, and post the whole thing back without stripping the rollups first.

Values are type-checked. `{"fld_amount": "banana"}` is a 400 that names the field.

### Update — a **merge**, not a replace

```bash
curl -X PATCH -H "Authorization: Bearer $SWAMP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"records":[{"id":"…","fields":{"fld_amount":9000}}]}' \
  "https://your-app/api/v1/tables/$TABLE/records"
```

Sending one key changes one key. The other fields are left alone.

And the merge happens **inside the UPDATE**, in Postgres — so two clients patching different cells of the same row both survive. An API that replaced the record would force every integration into a read-modify-write, and every one of them would race.

### Delete

```bash
curl -X DELETE -H "Authorization: Bearer $SWAMP_TOKEN" \
  "https://your-app/api/v1/tables/$TABLE/records?ids=$A,$B"
```

Soft. It's recoverable, and its attachments survive the grace period.

---

## Webhooks

**Base → Automations.**

We POST to your URL when something changes. You choose the events, and optionally:

- **a table** — or every table in the base;
- **fields** — fire only when *these* changed. Without this, a webhook on a busy table fires on every keystroke-sized edit and your receiver spends its life discarding events;
- **a condition** — a filter tree. *"Tell me when a deal moves to Won and is over $50k"* is a filter, and we already have a filter compiler.

Events: `record.created`, `record.updated`, `record.deleted`, `comment.created`, `button.clicked`.

### The payload

```json
{
  "event": "record.updated",
  "baseId": "…", "tableId": "…", "recordId": "…",
  "record": { "id": "…", "fields": { "fld_status": "Won" } },
  "changes": { "fld_status": { "from": "Open", "to": "Won" } },
  "actor": "…",
  "timestamp": "2026-07-14T…"
}
```

`changes` is the **diff**, not the whole record. A receiver that has to work out what changed by comparing against its own stale copy is a receiver that gets it wrong.

### Verifying it came from us

```
X-Swamp-Event:     record.updated
X-Swamp-Delivery:  018f…            ← the idempotency key
X-Swamp-Timestamp: 1784…
X-Swamp-Signature: sha256=<hmac>
```

The MAC is over **`<timestamp>.<body>`**, keyed with the webhook's secret.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, req, rawBody) {
  const ts = req.headers["x-swamp-timestamp"];

  // Reject anything old. This is the point of signing the timestamp: without the
  // freshness check, a captured delivery can be replayed forever — the body never
  // changes, so the signature stays valid.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const given = req.headers["x-swamp-signature"];

  // Not `===`. A string compare returns as soon as it finds a differing byte, so how
  // long it took tells an attacker how many leading bytes they got right.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}
```

Sign against the **raw body bytes**, before any JSON parsing. `JSON.parse` then `JSON.stringify` does not round-trip byte-for-byte, and the signature will not match.

### Delivery is at-least-once

Retries at **1m, 5m, 25m, 2h, 6h**, then the delivery is marked dead and shown in the log. A 10-second timeout. Redirects are not followed — a 302 to `169.254.169.254` would walk straight past our SSRF check.

**Key on `X-Swamp-Delivery`.** If a dispatch process dies mid-flight, we will send that delivery again. This is true of every webhook system there is, and it is why the header exists.

Every attempt is in the log: what we sent, what came back, how many times we tried. Nobody has ever debugged a webhook without one.

### What we refuse to call

A webhook is a URL *you* choose that *our server* fetches. That is the shape of an SSRF — you can't reach `169.254.169.254` (the cloud metadata endpoint, which hands out credentials to anything that asks), but we can, and a webhook asks us to.

So the destination is checked against the **resolved address**, not the hostname: a DNS record pointing at `127.0.0.1` defeats a hostname check, and people do exactly that. Private ranges, loopback, link-local and multicast are refused, and the delivery is marked dead with the reason.

---

## Attachments

Files live in private storage. The record holds a reference:

```json
{ "id": "…", "name": "quote.pdf", "size": 91234, "mime": "application/pdf",
  "path": "<baseId>/<tableId>/<uuid>-quote.pdf" }
```

**The URL is signed at read time and expires.** It is never stored, and you must not store one either: a persisted signed URL is a permanent, unauthenticated link to a private file, and it outlives every permission change you make afterwards.

Uploads go **straight to storage** — the app hands out a signed upload URL for one path and the browser PUTs the bytes there. The file never passes through a route handler.

When the last record stops pointing at a file, it is marked orphaned and collected after a grace period. The grace period is not laziness: ⌘Z is right there, and a soft-deleted record can be restored. Delete the object the instant it's unreferenced and undo brings the cell back with the file gone.

*(Today the REST API returns the `path` but not a signed URL. See the gaps below.)*

---

## The button field

Two kinds, and they are genuinely different things.

**URL.** The value *is* the href, computed per record from a formula, in Postgres. So it's a formula in every way that matters: it's merged into `fields` like any other computed column, and **you can filter and sort by it**.

```
CONCAT("https://crm.example.com/c/", {Account Id})
```

**Webhook.** Pressing it queues a delivery, server-side. The target URL and the signing secret never reach the browser — a button that fetched its own URL from the client would put both in the page source, where anyone who can open devtools can press it as often as they like. Only editors and above can press it.

---

## The gaps, honestly

- **The REST API doesn't sign attachment URLs.** It returns the `path`. Signing needs storage credentials that a token-authenticated request deliberately doesn't have, and the clean fix is a dedicated `POST /api/v1/attachments/sign` — not written yet.
- **`schema:read`, `webhooks:read` and `webhooks:write` are accepted and enforced, but no endpoint uses them yet.** `GET /api/v1/meta` currently requires `records:read`. The scopes exist so tokens minted today don't need re-minting later.
- **No rate limiting.** A token can hammer the API as hard as it likes.
- **No SSRF protection against DNS rebinding.** We resolve, we approve, `fetch` resolves again — and a hostile DNS server can answer differently the second time. Closing that means dialling the IP ourselves with a custom agent. The current check stops the accident and the casual attempt; it does not stop a determined attacker.
- **No `record.restored` event.** A restore arrives as `record.updated`.

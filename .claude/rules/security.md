# Security & authorization (strict)

- **RLS owns access.** Cookie-bound `createClient()` / `db()` for session code. Public API uses `createPublicClient()` + SECURITY DEFINER RPCs only.
- Never introduce `createServiceRoleClient` (or equivalent) into user-facing write/read product paths. Cron/admin only, and only where already established.
- Token auth: `Authorization: Bearer swamp_pat_…` only. Do not log tokens. Do not put tokens in docs examples as real values.
- A table in another base is **404**, not 403, on the public API (no existence leak).
- Webhook deliveries: SSRF checks on resolved IPs; no redirects; sign over the exact body bytes; at-least-once — receivers key on `X-Swamp-Delivery`.
- Soft-delete is the only delete for records. No hard-delete shortcuts in app code.
- Refuse requests to build exploit PoCs, credential stuffing, or attacks against any system.

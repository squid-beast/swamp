import type { WebhookKind } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Formatting a delivery for its target.
//
// The dispatcher (webhooks.ts) fires the HTTP request; this file decides what
// bytes go in the body. Kept pure and free of `server-only` so it unit-tests
// without a running server — the message-building rules are exactly the kind of
// thing that rots silently without tests.
//
// The delivery payload the trigger enqueues (see the platform migration) is:
//
//   { event, baseId, tableId, recordId,
//     record:  { id, fields },        // record.* events
//     comment: { id, body },          // comment.created
//     changes, actor, timestamp }
// ════════════════════════════════════════════════════════════════════════════

type Payload = Record<string, unknown>;

/** Slack caps a message near 40k; Discord hard-rejects over 2000. Truncate to
 *  the smaller of the two per target rather than get a 400 nobody sees. */
const LIMITS: Record<Exclude<WebhookKind, "generic">, number> = {
  slack: 3000,
  discord: 2000,
};

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Resolve one `{{token}}`. Dotted paths walk the payload (`fields.fld_email`
 *  reads `payload.record.fields.fld_email`); a bare token reads a top-level key.
 *  An unknown path renders empty — a template must never throw at 2am. */
function resolveToken(token: string, payload: Payload): string {
  const path = token.trim();
  if (!path) return "";

  // `fields.X` is sugar for the record's field bag, because that is what a user
  // actually wants to interpolate and `record.fields.X` is a mouthful.
  const parts = (path.startsWith("fields.") ? `record.${path}` : path).split(".");

  let cur: unknown = payload;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  return asText(cur);
}

/** Replace every {{token}} in the template. */
export function renderTemplate(template: string, payload: Payload): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, token) => resolveToken(token, payload));
}

/** The message used when no template is set: the event, then a compact readable
 *  dump of what changed — the record's fields, or a comment's body. */
export function defaultMessage(payload: Payload): string {
  const event = asText(payload.event) || "event";
  const lines: string[] = [`New ${event} in Swamp`];

  const record = payload.record as { fields?: Record<string, unknown> } | undefined;
  const comment = payload.comment as { body?: unknown } | undefined;

  if (record?.fields && typeof record.fields === "object") {
    for (const [key, value] of Object.entries(record.fields).slice(0, 12)) {
      const text = asText(value);
      if (text !== "") lines.push(`${key}: ${text}`);
    }
  } else if (comment?.body != null) {
    lines.push(asText(comment.body));
  }

  return lines.join("\n");
}

/** The exact string to send as the request body, for this kind of webhook. */
export function buildDeliveryBody(
  kind: WebhookKind,
  template: string | null,
  payload: Payload
): string {
  if (kind === "generic") return JSON.stringify(payload);

  const raw = template && template.trim() ? renderTemplate(template, payload) : defaultMessage(payload);
  const message = raw.slice(0, LIMITS[kind]);

  return kind === "slack"
    ? JSON.stringify({ text: message })
    : JSON.stringify({ content: message });
}

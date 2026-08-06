import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/shared/supabase/server";
import { sendEmail } from "@/shared/email/send";
import { safeFetch, SafeFetchError } from "./safe-fetch";
import { backoffMs, MAX_ATTEMPTS, sign } from "./webhook-crypto";
import { buildDeliveryBody, emailContent } from "./webhook-format";
import type { FilterNode, Webhook, WebhookDelivery, WebhookEvent, WebhookKind } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Webhooks.
//
// Two halves, and they are deliberately far apart:
//
//   The ENQUEUE half is a database trigger (see the platform migration). It runs
//   inside the transaction that changed the record, so a delivery exists if and
//   only if the change committed. Enqueueing from the app instead would mean
//   firing a webhook for a write that then rolled back — telling someone's server
//   about a record that does not exist.
//
//   The DELIVER half is here. It runs later, out of band, with retries. A webhook
//   that blocks the user's save until a third-party server responds is a webhook
//   that makes your product as slow as the slowest thing anyone has ever pointed
//   it at.
// ════════════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;

const toWebhook = (r: Row): Webhook => ({
  id: r.id as string,
  baseId: r.base_id as string,
  tableId: (r.table_id as string) ?? null,
  name: r.name as string,
  url: (r.url as string) ?? null,
  secret: r.secret as string,
  events: (r.events as WebhookEvent[]) ?? [],
  fieldIds: (r.field_ids as string[]) ?? [],
  condition: (r.condition as FilterNode) ?? null,
  kind: ((r.kind as WebhookKind) ?? "generic"),
  template: (r.template as string) ?? null,
  config: (r.config as Record<string, unknown>) ?? {},
  active: !!r.active,
  createdAt: r.created_at as string,
});

const COLUMNS =
  "id, base_id, table_id, name, url, secret, events, field_ids, condition, kind, template, config, active, created_at";

// ─── The owner's side ───────────────────────────────────────────────────────

export async function listWebhooks(baseId: string): Promise<Webhook[]> {
  const { data, error } = await createClient()
    .from("webhooks")
    .select(COLUMNS)
    .eq("base_id", baseId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listWebhooks: ${error.message}`);
  return (data ?? []).map(toWebhook);
}

export async function createWebhook(
  baseId: string,
  input: {
    name: string;
    url?: string | null;
    tableId?: string | null;
    events: WebhookEvent[];
    fieldIds?: string[];
    condition?: FilterNode | null;
    kind?: WebhookKind;
    template?: string | null;
    config?: Record<string, unknown>;
  }
): Promise<Webhook> {
  const { data, error } = await createClient()
    .from("webhooks")
    .insert({
      base_id: baseId,
      name: input.name,
      url: input.url ?? null,
      table_id: input.tableId ?? null,
      events: input.events,
      field_ids: input.fieldIds ?? [],
      condition: input.condition ?? null,
      kind: input.kind ?? "generic",
      template: input.template ?? null,
      config: input.config ?? {},
    })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toWebhook(data);
}

export async function updateWebhook(id: string, patch: Row): Promise<Webhook> {
  const row: Row = {};
  if ("name" in patch) row.name = patch.name;
  if ("url" in patch) row.url = patch.url;
  if ("events" in patch) row.events = patch.events;
  if ("fieldIds" in patch) row.field_ids = patch.fieldIds;
  if ("condition" in patch) row.condition = patch.condition;
  if ("kind" in patch) row.kind = patch.kind;
  if ("template" in patch) row.template = patch.template;
  if ("config" in patch) row.config = patch.config;
  if ("active" in patch) row.active = patch.active;

  const { data, error } = await createClient()
    .from("webhooks")
    .update(row)
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toWebhook(data);
}

export async function deleteWebhook(id: string): Promise<void> {
  const { error } = await createClient().from("webhooks").delete().eq("id", id);
  if (error) throw new Error(`deleteWebhook: ${error.message}`);
}

const toDelivery = (r: Row): WebhookDelivery => ({
  id: r.id as string,
  webhookId: r.webhook_id as string,
  event: r.event as string,
  payload: (r.payload as Row) ?? {},
  status: r.status as WebhookDelivery["status"],
  attempts: Number(r.attempts),
  nextAttemptAt: r.next_attempt_at as string,
  responseStatus: (r.response_status as number) ?? null,
  responseBody: (r.response_body as string) ?? null,
  error: (r.error as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

/** The call log. Every attempt, the status it got back, and what it sent — which
 *  is the only way anybody has ever debugged a webhook. */
export async function listDeliveries(webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
  const { data, error } = await createClient()
    .from("webhook_deliveries")
    .select("*")
    .eq("webhook_id", webhookId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listDeliveries: ${error.message}`);
  return (data ?? []).map(toDelivery);
}

/** Fire a `button` field that points at a webhook. The URL and the secret stay on
 *  the server — the browser is told only that it worked. */
export async function fireButton(recordId: string, fieldId: string): Promise<string> {
  const { data, error } = await createClient().rpc("swamp_fire_button", {
    p_record_id: recordId,
    p_field_id: fieldId,
  });

  if (error) throw new Error(error.message);
  return data as string;
}

// ─── The dispatcher ─────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

interface Claimed {
  id: string;
  webhook_id: string;
  event: string;
  payload: Row;
  attempts: number;
}

/** What a delivery needs to know about its webhook to go out. */
export interface DeliveryTarget {
  url: string | null;
  secret: string;
  kind: WebhookKind;
  template: string | null;
  config: Record<string, unknown>;
}

export interface DeliveryOutcome {
  ok: boolean;
  /** Permanent — do not retry (SSRF refusal, missing recipient, bad protocol). */
  refused?: boolean;
  responseStatus?: number;
  /** A 2 KB snippet for the log, never headers. */
  responseBody?: string;
  error?: string;
}

/**
 * Send ONE delivery, whatever its kind. The single send path — the cron
 * dispatcher and the owner's "test" button both come through here, which is
 * what makes the test button honest: it cannot drift from production because
 * it IS production.
 */
export async function deliverOne(
  hook: DeliveryTarget,
  event: string,
  deliveryId: string,
  payload: Row
): Promise<DeliveryOutcome> {
  // email has no URL — it goes through the app's sender. Best-effort by the
  // sender's own contract (no RESEND_API_KEY ⇒ skipped, reported as an error
  // here so the log says WHY nothing arrived).
  if (hook.kind === "email") {
    const to = typeof hook.config.to === "string" ? hook.config.to : "";
    if (!to) return { ok: false, refused: true, error: "email webhook has no recipient" };

    const { subject, text } = emailContent(hook.template, payload);
    const result = await sendEmail({
      to,
      subject,
      text,
      html: `<pre style="font-family:inherit;white-space:pre-wrap">${text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre>`,
    });

    if (result.ok) return { ok: true, responseStatus: 200 };
    return {
      ok: false,
      error: "skipped" in result && result.skipped ? "email is not configured (RESEND_API_KEY)" : "email send failed",
    };
  }

  if (!hook.url) return { ok: false, refused: true, error: "webhook has no URL" };

  // The body depends on the target: a generic webhook gets Swamp's signed
  // envelope; the chat kinds get their own tiny shape, built from the same
  // payload. The signature is computed over whatever actually goes on the
  // wire, so a generic receiver can still verify it.
  const body = buildDeliveryBody(hook.kind, hook.template, payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  try {
    // safeFetch pins the connection to a validated public IP (a 302 to
    // 169.254.169.254 is reported, not chased — maxRedirects 0) and caps the
    // body it reads; we keep only a 2 KB snippet for the log.
    const res = await safeFetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "swamp-webhooks/1",
        "X-Swamp-Event": event,
        "X-Swamp-Delivery": deliveryId, // the idempotency key. Receivers: use it.
        "X-Swamp-Timestamp": timestamp,
        "X-Swamp-Signature": sign(hook.secret, timestamp, body),
      },
      body,
      timeoutMs: TIMEOUT_MS,
      maxRedirects: 0,
      maxBytes: 64 * 1024,
      truncate: true,
    });

    const text = new TextDecoder().decode(res.buf).slice(0, 2000);
    return { ok: res.ok, responseStatus: res.status, responseBody: text };
  } catch (e) {
    if (e instanceof SafeFetchError && e.refused) {
      return { ok: false, refused: true, error: e.message };
    }
    return { ok: false, error: (e as Error).message || "delivery failed" };
  }
}

/**
 * Deliver what's due.
 *
 * ── The claim ──
 *
 * Two dispatch runs overlapping (a slow one, a cron that fired again) must not
 * both send the same delivery. So a run first *claims* its batch: it pushes
 * `next_attempt_at` an hour out, filtered on the rows still being due. That
 * UPDATE is atomic, so the second run's identical update matches zero rows and it
 * sends nothing.
 *
 * The cost is honest and worth stating: if this process dies mid-flight, the
 * delivery is retried an hour later, and the receiver may see it twice. Webhooks
 * are AT LEAST ONCE. Every delivery carries `X-Swamp-Delivery`, and a receiver
 * that cares must key on it — which is true of every webhook system there is, and
 * is why the header exists.
 */
export async function dispatchPending(
  db: SupabaseClient,
  limit = 50
): Promise<{ claimed: number; delivered: number; failed: number; dead: number }> {
  const now = new Date();
  const lease = new Date(now.getTime() + 3_600_000).toISOString();

  const { data: due } = await db
    .from("webhook_deliveries")
    .select("id")
    .eq("status", "pending")
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at")
    .limit(limit);

  const ids = (due ?? []).map((d) => d.id as string);
  if (!ids.length) return { claimed: 0, delivered: 0, failed: 0, dead: 0 };

  const { data: claimed } = await db
    .from("webhook_deliveries")
    .update({ next_attempt_at: lease })
    .in("id", ids)
    .eq("status", "pending")
    .lte("next_attempt_at", now.toISOString()) // ← the atomic bit
    .select("id, webhook_id, event, payload, attempts");

  const batch = (claimed ?? []) as unknown as Claimed[];
  if (!batch.length) return { claimed: 0, delivered: 0, failed: 0, dead: 0 };

  const { data: hooks } = await db
    .from("webhooks")
    .select("id, url, secret, active, kind, template, config")
    .in("id", [...new Set(batch.map((d) => d.webhook_id))]);

  const byId = new Map(
    (hooks ?? []).map((h) => [
      h.id as string,
      {
        url: (h.url as string) ?? null,
        secret: h.secret as string,
        active: !!h.active,
        kind: ((h.kind as WebhookKind) ?? "generic"),
        template: (h.template as string) ?? null,
        config: (h.config as Record<string, unknown>) ?? {},
      },
    ])
  );

  let delivered = 0;
  let failed = 0;
  let dead = 0;

  await Promise.all(
    batch.map(async (d) => {
      const hook = byId.get(d.webhook_id);
      const attempts = d.attempts + 1;

      const settle = async (patch: Row) => {
        await db.from("webhook_deliveries").update({ attempts, ...patch }).eq("id", d.id);
      };

      // The webhook was switched off after this was queued. Don't deliver, and
      // don't retry forever — the user's answer to "stop calling my server" has to
      // actually stop calling their server.
      if (!hook || !hook.active) {
        dead++;
        return settle({ status: "dead", error: "webhook is inactive or deleted" });
      }

      const out = await deliverOne(hook, d.event, d.id, d.payload);

      if (out.ok) {
        delivered++;
        return settle({
          status: "success",
          response_status: out.responseStatus ?? null,
          response_body: out.responseBody ?? null,
          error: null,
        });
      }

      // A safety refusal (private address, bad protocol, missing recipient) is
      // permanent — mark dead, don't retry. A timeout or a 500 is transient.
      if (out.refused || attempts >= MAX_ATTEMPTS) {
        dead++;
        return settle({
          status: "dead",
          response_status: out.responseStatus ?? null,
          response_body: out.responseBody ?? null,
          error: out.error ?? null,
        });
      }

      failed++;
      return settle({
        status: "pending",
        response_status: out.responseStatus ?? null,
        response_body: out.responseBody ?? null,
        error: out.error ?? null,
        next_attempt_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
      });
    })
  );

  return { claimed: batch.length, delivered, failed, dead };
}

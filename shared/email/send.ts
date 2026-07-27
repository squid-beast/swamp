import "server-only";

// ════════════════════════════════════════════════════════════════════════════
// Sending email, through Resend.
//
// One rule governs this whole file: **email is best-effort, never load-bearing.**
// An invite is valid the moment its row exists in the database — the email is a
// convenience that carries the link. So a Resend outage, a bad key, or a bounced
// address must NEVER fail the operation that triggered the email. Every caller
// fires this and moves on.
//
// If RESEND_API_KEY isn't set, this is a no-op that reports `skipped`. The product
// still works — the inviter copies the link by hand, exactly as before. Setting
// the key upgrades that to "and we email them too", with nothing else to change.
// ════════════════════════════════════════════════════════════════════════════

const ENDPOINT = "https://api.resend.com/emails";

/** Whether app-sent email is switched on. */
export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. HTML-only mail scores worse with spam filters, so
   *  every template ships one; it's optional here only for backward compat. */
  text?: string;
  /** Where a reply goes. Defaults to hello@, so a "reply to this invite" reaches
   *  a human instead of a black hole. */
  replyTo?: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true };

  const from = process.env.EMAIL_FROM || "SWAMP <hello@swampy.app>";

  // A hung third-party call must not hold a request open. Ten seconds is generous
  // for an API that normally answers in under one.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
        reply_to: opts.replyTo ?? "hello@swampy.app",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `resend ${res.status}: ${text.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

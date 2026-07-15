// ════════════════════════════════════════════════════════════════════════════
// Email bodies.
//
// These are the emails SWAMP sends ITSELF (right now: the base invite). The auth
// emails — sign-up confirmation and password reset — are sent by Supabase from
// templates you paste into its dashboard; branded copies live in docs/email/.
//
// Everything is inline-styled and table-free-ish on purpose: email clients strip
// <style> blocks and have no idea what flexbox is. What you write here is roughly
// what 2004's Outlook renders, so keep it boring and inline.
// ════════════════════════════════════════════════════════════════════════════

import { absolute } from "@/shared/seo/site";

const BRAND = "#0b0b0c";
const INK = "#0b1220";
const MUTED = "#5f6b66";
const BORDER = "#e4e8e6";

/** A shared shell so every SWAMP email looks like the same product. The logo is a
 *  hosted PNG at an absolute URL — email clients can't render inline SVG or local
 *  paths, so it has to be a real, public https:// image. */
function shell(bodyHtml: string): string {
  const logo = absolute("/logo.png");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
      <div style="margin-bottom:20px;">
        <img src="${logo}" width="26" height="26" alt="SWAMP" style="vertical-align:middle;border:0;" />
        <span style="font-size:20px;font-weight:800;letter-spacing:-0.02em;color:${BRAND};vertical-align:middle;margin-left:8px;">SWAMP</span>
      </div>
      <div style="background:#ffffff;border:1px solid ${BORDER};border-radius:12px;padding:28px;">
        ${bodyHtml}
      </div>
      <p style="color:${MUTED};font-size:12px;line-height:1.6;margin:20px 4px 0;">
        Sent by SWAMP · <a href="https://swampy.app" style="color:${MUTED};">swampy.app</a><br/>
        If this wasn't meant for you, you can ignore it. Nothing happens until you act.
      </p>
    </div>
  </body>
</html>`;
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${label}</a>`;
}

const ROLE_WORDS: Record<string, string> = {
  viewer: "view",
  commenter: "view and comment on",
  editor: "edit",
  creator: "manage",
  owner: "co-own",
};

/**
 * "You've been invited to <base>."
 *
 * The role is spelled out in plain words — "you'll be able to edit" — because
 * "you've been added as an editor" means nothing to someone who's never used the
 * product. The raw link is printed under the button because a good number of
 * corporate mail clients quietly strip the button's href.
 */
export function inviteEmail(opts: {
  url: string;
  role: string;
  baseName?: string | null;
  inviterName?: string | null;
}): { subject: string; html: string } {
  const where = opts.baseName ? `“${opts.baseName}”` : "a workspace";
  const who = opts.inviterName ? `${opts.inviterName} invited you` : "You've been invited";
  const can = ROLE_WORDS[opts.role] ?? "work in";

  const subject = opts.baseName
    ? `You're invited to ${opts.baseName} on SWAMP`
    : `You're invited to a workspace on SWAMP`;

  const html = shell(`
    <h1 style="font-size:19px;font-weight:700;color:${INK};margin:0 0 12px;">${who} to join ${where}</h1>
    <p style="font-size:15px;line-height:1.6;color:${INK};margin:0 0 8px;">
      SWAMP is a shared database, the kind of spreadsheet a team can actually use
      together. You'll be able to <strong>${can}</strong> this workspace.
    </p>
    <p style="font-size:15px;line-height:1.6;color:${INK};margin:0 0 22px;">
      The link only works for this email address, so it's safe to keep private.
    </p>
    <div style="margin:0 0 22px;">${button(opts.url, "Accept the invite")}</div>
    <p style="font-size:13px;line-height:1.6;color:${MUTED};margin:0;">
      Or paste this into your browser:<br/>
      <a href="${opts.url}" style="color:${BRAND};word-break:break-all;">${opts.url}</a>
    </p>
  `);

  return { subject, html };
}

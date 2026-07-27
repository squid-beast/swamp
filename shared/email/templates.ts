// ════════════════════════════════════════════════════════════════════════════
// Email bodies — the single source of truth for every SWAMP email.
//
// SWAMP composes the invite itself (sent through Resend). The auth emails —
// confirm-signup, reset-password, change-email — are sent by Supabase from
// templates you paste into its dashboard, but they are BUILT from the same
// shell() here: `npm run email:build` renders them into docs/email/*.html. One
// brand, one place.
//
// Everything is inline-styled and table-based on purpose: email clients strip
// <style> blocks and have no idea what flexbox is. The one exception is <head> —
// a color-scheme meta and a prefers-color-scheme block, which is the only way to
// stop Apple Mail and Outlook from auto-inverting the palette. What renders in
// the body is roughly what 2004's Outlook shows, so keep it boring and inline.
// ════════════════════════════════════════════════════════════════════════════

import { absolute } from "../seo/site";

// The identity, shared with app/og/route.tsx and app/logo.png/route.tsx so an
// invite and a pasted link finally look like the same company.
const ACCENT = "#4ade80"; // green
const DARK = "#0b0f0e"; // header band ground
const HEADER_FG = "#f2f5f4"; // wordmark on the dark band
const INK = "#0b1220"; // body copy
const MUTED = "#5f6b66";
const BORDER = "#e4e8e6";
const PAGE_BG = "#f4f6f5";
const CARD_BG = "#ffffff";

/**
 * The shared brand shell. A 600px table-based layout — the width every client
 * agrees on — with a dark header band (the OG card's radial green wash), a white
 * content card, and a footer carrying the four-square accent motif.
 *
 * `preheader` is the inbox-preview hook, hidden with the standard zero-height
 * technique and written per-email rather than defaulting to the first paragraph.
 * `footnote` is the small print under the card ("if this wasn't for you…").
 */
function shell(opts: {
  title: string;
  preheader: string;
  body: string;
  footnote: string;
}): string {
  const logo = absolute("/logo.png");
  const squares = [0.9, 0.6, 0.35, 0.2]
    .map(
      (o) =>
        `<td style="padding:0 3px;"><div style="width:9px;height:9px;border-radius:2px;background:${ACCENT};opacity:${o};font-size:1px;line-height:1px;">&nbsp;</div></td>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${opts.title}</title>
    <style>
      /* Dark clients get an intentional dark version instead of an auto-inverted
         one. Inline styles still win everywhere else; this only kicks in when the
         client actually honours the query. */
      @media (prefers-color-scheme: dark) {
        .swamp-page { background:#07100c !important; }
        .swamp-card { background:#0f1512 !important; border-color:#1d2a24 !important; }
        .swamp-ink { color:#e7ece9 !important; }
        .swamp-muted { color:#9aa8a2 !important; }
        .swamp-link { color:${ACCENT} !important; }
      }
    </style>
  </head>
  <body class="swamp-page" style="margin:0;padding:0;background:${PAGE_BG};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
    <!-- Preheader: the inbox-preview line. Hidden, but read by the client. -->
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE_BG};opacity:0;">
      ${opts.preheader}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
            <!-- Dark header band: the showcase moment, the same image a pasted
                 SWAMP link renders in Slack. -->
            <tr>
              <td style="background:${DARK};background-image:radial-gradient(circle at 85% 15%, rgba(74,222,128,0.14), transparent 55%);border-radius:16px 16px 0 0;padding:26px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right:12px;vertical-align:middle;">
                      <img src="${logo}" width="34" height="34" alt="SWAMP" style="display:block;border:0;border-radius:9px;" />
                    </td>
                    <td style="vertical-align:middle;">
                      <span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${HEADER_FG};">SWAMP</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- White content card. -->
            <tr>
              <td class="swamp-card" style="background:${CARD_BG};border:1px solid ${BORDER};border-top:0;padding:32px;">
                ${opts.body}
              </td>
            </tr>
            <!-- Footer, with the four-square accent motif at low opacity. -->
            <tr>
              <td style="padding:20px 8px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="vertical-align:middle;">
                      <p class="swamp-muted" style="color:${MUTED};font-size:12px;line-height:1.6;margin:0;">
                        Sent by SWAMP · <a href="https://swampy.app" class="swamp-link" style="color:${MUTED};text-decoration:underline;">swampy.app</a><br/>
                        ${opts.footnote}
                      </p>
                    </td>
                    <td style="vertical-align:middle;text-align:right;white-space:nowrap;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right">
                        <tr>${squares}</tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * A bulletproof call-to-action button. A padded <a> collapses in Outlook's Word
 * engine, so Outlook gets a VML roundrect and everyone else gets the <a>. Green
 * fill, white bold label; the dark ground shows through if the fill is stripped.
 */
function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" bgcolor="${ACCENT}" style="border-radius:8px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:46px;v-text-anchor:middle;width:240px;" arcsize="17%" strokecolor="${ACCENT}" fillcolor="${ACCENT}">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">${label}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="${url}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:46px;padding:0 26px;border-radius:8px;">${label}</a>
        <!--<![endif]-->
      </td>
    </tr>
  </table>`;
}

/** The card interior shared by the link-carrying emails: heading, one or two
 *  paragraphs, the button, and the copyable raw link under it. */
function linkCard(opts: {
  heading: string;
  paragraphs: string[];
  url: string;
  label: string;
}): string {
  const paras = opts.paragraphs
    .map(
      (p) =>
        `<p class="swamp-ink" style="font-size:15px;line-height:1.6;color:${INK};margin:0 0 14px;">${p}</p>`
    )
    .join("\n      ");
  return `
      <h1 class="swamp-ink" style="font-size:20px;font-weight:700;color:${INK};margin:0 0 14px;">${opts.heading}</h1>
      ${paras}
      <div style="margin:22px 0;">${button(opts.url, opts.label)}</div>
      <p class="swamp-muted" style="font-size:13px;line-height:1.6;color:${MUTED};margin:0;">
        Or paste this into your browser:<br/>
        <a href="${opts.url}" class="swamp-link" style="color:${ACCENT};word-break:break-all;">${opts.url}</a>
      </p>`;
}

/** The plain-text alternative for a link email — same content, no markup.
 *  Deliverability: HTML-only mail scores worse with spam filters. */
function linkText(opts: {
  heading: string;
  paragraphs: string[];
  url: string;
  footnote: string;
}): string {
  return [
    "SWAMP",
    "",
    opts.heading,
    "",
    ...opts.paragraphs,
    "",
    opts.url,
    "",
    "—",
    opts.footnote,
    "swampy.app",
  ].join("\n");
}

const ROLE_WORDS: Record<string, string> = {
  viewer: "view",
  commenter: "view and comment on",
  editor: "edit",
  creator: "manage",
  owner: "co-own",
};

interface Email {
  subject: string;
  html: string;
  text: string;
}

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
}): Email {
  const where = opts.baseName ? `“${opts.baseName}”` : "a workspace";
  const who = opts.inviterName ? `${opts.inviterName} invited you` : "You've been invited";
  const can = ROLE_WORDS[opts.role] ?? "work in";

  const subject = opts.baseName
    ? `You're invited to ${opts.baseName} on SWAMP`
    : `You're invited to a workspace on SWAMP`;

  const heading = `${who} to join ${where}`;
  const paragraphs = [
    `SWAMP is a shared database, the kind of spreadsheet a team can actually use together. You'll be able to <strong>${can}</strong> this workspace.`,
    `The link only works for this email address, so it's safe to keep private.`,
  ];
  const footnote = "If this wasn't meant for you, you can ignore it. Nothing happens until you act.";

  const html = shell({
    title: subject,
    preheader: `${who} to ${opts.baseName ? opts.baseName : "a workspace"} — you'll be able to ${can} it.`,
    body: linkCard({ heading, paragraphs, url: opts.url, label: "Accept the invite" }),
    footnote,
  });

  const text = linkText({
    heading,
    paragraphs: [
      `SWAMP is a shared database, the kind of spreadsheet a team can actually use together. You'll be able to ${can} this workspace.`,
      "The link only works for this email address, so it's safe to keep private.",
    ],
    url: opts.url,
    footnote,
  });

  return { subject, html, text };
}

// ── Supabase auth emails ─────────────────────────────────────────────────────
// Built from the same shell and rendered to docs/email/*.html by
// scripts/build-email-templates.ts. Supabase substitutes {{ .ConfirmationURL }},
// which is passed straight through as `url`.

export function confirmSignupEmail(url: string): Email {
  const heading = "Confirm your email";
  const footnote = "If you didn't create a SWAMP account, you can safely ignore this email.";
  const paragraphs = [
    "Welcome to SWAMP. Tap the button to confirm your address and finish setting up your account.",
  ];
  return {
    subject: "Confirm your email · SWAMP",
    html: shell({
      title: "Confirm your email",
      preheader: "Confirm your address to finish setting up your SWAMP account.",
      body: linkCard({ heading, paragraphs, url, label: "Confirm my email" }),
      footnote,
    }),
    text: linkText({ heading, paragraphs, url, footnote }),
  };
}

export function resetPasswordEmail(url: string): Email {
  const heading = "Reset your password";
  const footnote =
    "If you didn't ask to reset your password, you can ignore this and your password won't change.";
  const paragraphs = [
    "Someone asked to reset the password for your SWAMP account. Tap the button to choose a new one. The link expires in an hour.",
  ];
  return {
    subject: "Reset your password · SWAMP",
    html: shell({
      title: "Reset your password",
      preheader: "Choose a new password for your SWAMP account. The link expires in an hour.",
      body: linkCard({ heading, paragraphs, url, label: "Set a new password" }),
      footnote,
    }),
    text: linkText({ heading, paragraphs, url, footnote }),
  };
}

export function changeEmailEmail(url: string): Email {
  const heading = "Confirm your new email";
  const footnote =
    "If you didn't request this change, ignore this email and your address stays the same.";
  const paragraphs = [
    "You asked to change the email on your SWAMP account. Tap the button to confirm this new address.",
  ];
  return {
    subject: "Confirm your new email · SWAMP",
    html: shell({
      title: "Confirm your new email",
      preheader: "Confirm the new address on your SWAMP account.",
      body: linkCard({ heading, paragraphs, url, label: "Confirm new email" }),
      footnote,
    }),
    text: linkText({ heading, paragraphs, url, footnote }),
  };
}

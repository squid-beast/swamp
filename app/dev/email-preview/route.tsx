import { NextResponse } from "next/server";
import {
  changeEmailEmail,
  confirmSignupEmail,
  inviteEmail,
  resetPasswordEmail,
} from "@/shared/email/templates";

// ════════════════════════════════════════════════════════════════════════════
// Dev-only email preview.
//
//   /dev/email-preview
//
// Renders all four emails side by side with sample data, so they can be eyeballed
// without a send loop — and so the generated docs/email/ files are reviewable.
// Returns 404 in production: this is a developer tool, not a public page.
// ════════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

const SAMPLE_URL = "https://swampy.app/invite/abc123token-sample";

function esc(html: string): string {
  return html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const emails = [
    { name: "invite", email: inviteEmail({ url: SAMPLE_URL, role: "editor", baseName: "CRM", inviterName: "Dana Okafor" }) },
    { name: "confirm-signup", email: confirmSignupEmail("{{ .ConfirmationURL }}") },
    { name: "reset-password", email: resetPasswordEmail("{{ .ConfirmationURL }}") },
    { name: "change-email", email: changeEmailEmail("{{ .ConfirmationURL }}") },
  ];

  const cards = emails
    .map(
      ({ name, email }) => `
      <section style="display:flex;flex-direction:column;min-width:0;">
        <header style="font:600 13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0b1220;margin:0 0 8px;">
          <span style="display:inline-block;background:#0b0f0e;color:#4ade80;padding:2px 8px;border-radius:6px;margin-right:8px;">${name}</span>
          ${esc(email.subject)}
        </header>
        <iframe title="${name}" srcdoc="${esc(email.html)}" style="width:100%;height:640px;border:1px solid #e4e8e6;border-radius:12px;background:#fff;"></iframe>
      </section>`
    )
    .join("\n");

  const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SWAMP · email preview</title>
  </head>
  <body style="margin:0;padding:24px;background:#eef1f0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
    <h1 style="font-size:18px;color:#0b1220;margin:0 0 4px;">SWAMP email preview</h1>
    <p style="font-size:13px;color:#5f6b66;margin:0 0 20px;">Dev-only. Sample data; auth emails show the literal Supabase placeholder.</p>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;">
      ${cards}
    </div>
  </body>
</html>`;

  return new NextResponse(page, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

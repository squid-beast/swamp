// ════════════════════════════════════════════════════════════════════════════
// Render the Supabase auth emails from the shared shell.
//
//   npm run email:build
//
// The three files in docs/email/ are BUILD ARTIFACTS of shell() in
// shared/email/templates.ts — not hand-maintained copies. A brand change is one
// edit to the shell, then this script; the "four-file change nobody finishes" is
// gone. The generated files stay committed so the Supabase dashboard paste-in
// workflow is unchanged.
//
// Supabase substitutes {{ .ConfirmationURL }} at send time, so that literal is
// passed straight through as the link and survives into the committed HTML.
// ════════════════════════════════════════════════════════════════════════════

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The docs render for production, where the logo lives at https://swampy.app.
// absolute() reads this at module load, so it must be set before templates.ts is
// imported — hence the dynamic import below.
process.env.NEXT_PUBLIC_SITE_URL ||= "https://swampy.app";

const CONFIRMATION_URL = "{{ .ConfirmationURL }}";
const HEADER_RULE =
  "════════════════════════════════════════════════════════════════════════════";

/** The "paste this into Supabase" comment header, preserved verbatim per file. */
function header(dashboardName: string, note: string): string {
  return `<!-- ${HEADER_RULE}
     Supabase Auth → Email Templates → "${dashboardName}"
     ${note}
     Variable used: {{ .ConfirmationURL }}
     ${HEADER_RULE} -->`;
}

async function main() {
  const { confirmSignupEmail, resetPasswordEmail, changeEmailEmail } = await import(
    "../shared/email/templates"
  );

  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, "../docs/email");

  const files = [
    {
      file: "confirm-signup.html",
      header: header(
        "Confirm signup",
        "Paste the whole thing into the message body. Supabase fills in the link."
      ),
      email: confirmSignupEmail(CONFIRMATION_URL),
    },
    {
      file: "reset-password.html",
      header: header(
        "Reset password",
        "Paste the whole thing into the message body. Supabase fills in the link."
      ),
      email: resetPasswordEmail(CONFIRMATION_URL),
    },
    {
      file: "change-email.html",
      header: header(
        "Change Email Address",
        "Fires only if a user changes their account email. Paste the whole thing."
      ),
      email: changeEmailEmail(CONFIRMATION_URL),
    },
  ];

  for (const { file, header, email } of files) {
    const contents = `${header}\n${email.html}\n`;
    writeFileSync(resolve(outDir, file), contents, "utf8");
    console.log(`wrote docs/email/${file}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

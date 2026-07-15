import Link from "next/link";
import { pageMeta } from "@/shared/seo/metadata";
import { JsonLd, breadcrumbSchema } from "@/shared/seo/jsonld";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";

// Security.
//
// A real page, because "how do you handle my data" is the question that decides
// whether a team puts real data in — and a link to it earns the trust that a
// paragraph on the home page can't.
//
// Every claim here is something that is actually built and tested. There is a
// closing section that says what ISN'T done, because a security page with no
// limitations section is a security page nobody who knows security believes.

export const metadata = pageMeta({
  title: "Security",
  description:
    "How SWAMP handles your data: row-level security in Postgres, scoped API tokens capped by live permissions, signed webhooks, private file storage, and an append-only audit log.",
  path: "/security",
  kicker: "Security",
});

const PILLARS = [
  {
    title: "Permissions live in the database",
    body: "Every row is guarded by row-level security in Postgres, not by a check in the app. The thing that decides whether you can read a record is the same thing that stores it, so a bug in the interface cannot hand you data you shouldn't see. A second user who tries to read a row they don't own gets nothing, and there is a test that proves it.",
  },
  {
    title: "API tokens can't outlive your access",
    body: "A token acts as you, and never as more than you. Its permissions are recomputed from live membership on every single call. If your role is lowered, or you're removed from a base, the token's reach shrinks with it on the next request, with no waiting for a rotation. Tokens are stored only as a hash; the secret is shown once and then exists nowhere we can read it.",
  },
  {
    title: "Shared links leak nothing you hid",
    body: "A public view can be read and filtered, but a column you hid isn't merely hidden from the page. It's absent from the query. A visitor can't filter or search by it, so they can't work a value out from how the row count changes. Hidden means gone, not just off-screen.",
  },
  {
    title: "The audit log can't be edited",
    body: "Record history is append-only, for everyone, including the owner of the base. Entries are written by the database itself, and there is no path for a person to change or delete one. An audit log its own subject can rewrite isn't an audit log.",
  },
  {
    title: "Webhooks are signed, and can't be aimed inward",
    body: "Every delivery carries an HMAC signature over its timestamp and body, so your receiver can prove it came from us and reject a replay. And a webhook can't be pointed at a private address. The target is checked against where it actually resolves, which is what stops it being turned on your own network.",
  },
  {
    title: "Files are private by default",
    body: "Attachments live in private storage. The link to a file is signed at read time and expires. We never store a public URL, because a stored one outlives every permission change you make afterwards. Who can open a file is decided by the same row-level rules as the record it's attached to.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Security", path: "/security" },
        ])}
      />

      <div className="border-b">
        <div className="mx-auto max-w-3xl px-4 py-16 md:py-24">
          <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-primary">
            Security
          </p>
          <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight md:text-5xl">
            How your data is handled
          </h1>
          <p className="mt-6 text-[17px] leading-relaxed text-muted-foreground">
            The short version: security is enforced where your data lives, in the
            database itself, rather than in the screens in front of it. That&apos;s the
            decision everything below follows from, and it&apos;s the one that means a
            mistake in the interface can&apos;t become a data leak.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-16 md:py-20">
        <div className="grid gap-x-10 gap-y-10 md:grid-cols-2">
          {PILLARS.map(({ title, body }) => (
            <div key={title} className="flex flex-col gap-2 border-t pt-5">
              <h2 className="text-[16.5px] font-semibold tracking-tight">{title}</h2>
              <p className="text-[14.5px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        {/* The section that makes the rest believable — now a real Alert. */}
        <Alert variant="warning" className="mt-16 p-6">
          <AlertTitle className="font-display text-xl font-bold tracking-tight">
            What we haven&apos;t done yet
          </AlertTitle>
          <AlertDescription className="mt-3 text-[14.5px] leading-relaxed">
            SWAMP is in beta, and a security page that lists only strengths is one you
            shouldn&apos;t trust. So, plainly: there is no third-party security audit yet,
            no SOC 2 or ISO report, and no bug-bounty programme. The REST API has no rate
            limiting, and the webhook protection stops the common attacks but not a
            determined DNS-rebinding one. Don&apos;t put data here that would be a
            catastrophe to lose while it&apos;s this young. When any of that changes,
            it&apos;ll be said here first.
          </AlertDescription>
        </Alert>

        <div className="mt-10 text-[14.5px] text-muted-foreground">
          Found something? Email{" "}
          <a
            href="mailto:hello@swampy.app"
            className="text-foreground underline-offset-4 hover:underline"
          >
            hello@swampy.app
          </a>
          . We&apos;d genuinely rather hear it from you than not. See also our{" "}
          <Link href="/privacy" className="text-foreground underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          .
        </div>
      </div>
    </>
  );
}

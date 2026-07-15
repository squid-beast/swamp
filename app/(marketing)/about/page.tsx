import Image from "next/image";
import { pageMeta } from "@/shared/seo/metadata";
import { JsonLd, breadcrumbSchema, personSchema } from "@/shared/seo/jsonld";
import { SITE } from "@/shared/seo/site";

// About.
//
// Its own layout and its own words, not the home page with the sections swapped.
// It answers the one question a "why should I trust this" visitor has: who made
// it, and what were they trying to fix. The founder's real name is in the heading,
// the prose, and the Person JSON-LD, so a search for the name lands here.

export const metadata = pageMeta({
  title: "About",
  description:
    "SWAMP is a collaborative database built by Lohith Kumar Neerukonda: a spreadsheet that becomes a real database, with links, roles, comments and share links. Built in the open, on Postgres.",
  path: "/about",
});

const PRINCIPLES = [
  {
    title: "Your data is not our leverage",
    body: "Export any view to CSV or XLSX. Read the whole thing through an API with a token you make yourself. Getting your data back never costs money and never needs a phone call. A tool that holds your data hostage is one you were right to distrust.",
  },
  {
    title: "The database is the boundary",
    body: "Who can see what isn't a checkbox in some screen that a developer forgets to add. Postgres enforces it, one row at a time, so a bug in the interface can't hand out data it was never allowed to show. It is the least glamorous decision in the project and the one that carries the most weight.",
  },
  {
    title: "Say what isn't built",
    body: "This page and the home page only claim things that work today. No roadmap dressed up as a feature list, no “coming soon” quietly doing the selling. When a thing isn't finished, the site tells you, including on the pages meant to win you over.",
  },
];

export default function AboutPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "About", path: "/about" },
        ])}
      />
      {/* The Person record. Legitimate because the same name is rendered below,
          visible to a human, tied to the same site. */}
      <JsonLd data={personSchema()} />

      <div className="border-b">
        <div className="mx-auto max-w-3xl px-4 py-16 md:py-24">
          <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-primary">
            About
          </p>
          <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight md:text-5xl">
            Built because a spreadsheet stopped being enough
          </h1>
          <p className="mt-6 text-[17px] leading-relaxed text-muted-foreground">
            Every team&apos;s data starts in a spreadsheet. It holds up right until a
            second person opens it. Then you&apos;re mailing versions around, a column
            needs to point at another sheet, someone pastes over a formula, and nobody
            can say what changed. SWAMP is what you move to at that point.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-16 md:py-20">
        <div className="flex flex-col gap-6 text-[15.5px] leading-relaxed text-muted-foreground">
          <p>
            It&apos;s a collaborative database. You import a spreadsheet and get real
            structure back: tables that link to each other, columns with types, totals
            that keep themselves current. You look at the same records as a grid, a
            board, a calendar, or a form. You share them with your team at the role you
            pick, or with the public behind a link.
          </p>
          <p>
            Underneath it runs on Postgres, which matters more than it sounds. The
            permission rules live in the database, not in the app in front of it. The
            thing that decides whether you can see a row is the same thing that stores
            it, so there is no gap between the two for a bug to slip through.
          </p>
        </div>

        {/* ── Who built this ── the founder section, name in the heading ── */}
        <section
          aria-labelledby="founder"
          className="mt-16 rounded-2xl border bg-muted/25 p-7 sm:p-9"
        >
          <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-primary">
            Who built this
          </p>
          <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-7">
            <Image
              src={SITE.founder.image}
              alt="Lohith Kumar Neerukonda"
              width={112}
              height={112}
              className="size-24 shrink-0 rounded-2xl border object-cover sm:size-28"
            />
            <div className="flex flex-col gap-3">
              <div>
                <h2 id="founder" className="font-display text-2xl font-extrabold tracking-tight">
                  Lohith Kumar Neerukonda
                </h2>
                <p className="mt-0.5 text-[13.5px] text-muted-foreground">
                  {SITE.founder.role}
                </p>
              </div>
              <p className="text-[14.5px] leading-relaxed text-muted-foreground">
                I&apos;m Lohith. I built SWAMP after watching the same spreadsheet come
                apart on team after team: five people typing at once, no history when
                something went wrong, a share link that gave away more than it should.
                I wanted the Airtable idea, a spreadsheet that&apos;s really a database,
                without the parts that lock you in. So I put it on Postgres, built it in
                the open, and I&apos;m still building. If you try it and something breaks,
                I&apos;m the person who reads the email.
              </p>
              <p className="mt-1 text-[14px] text-muted-foreground">
                <a
                  href={SITE.founder.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  LinkedIn
                </a>
                <span className="px-2 text-muted-foreground/40">·</span>
                <a
                  href={SITE.github}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  GitHub
                </a>
                <span className="px-2 text-muted-foreground/40">·</span>
                <a
                  href={`mailto:${SITE.email}`}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  {SITE.email}
                </a>
              </p>
            </div>
          </div>

          <div className="mt-7 border-t pt-7">
            <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Also building
            </p>
            <ul className="mt-4 grid gap-6 sm:grid-cols-3">
              {SITE.founder.ventures.map((v) => (
                <li key={v.name} className="flex flex-col gap-1.5">
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[15px] font-semibold tracking-tight text-foreground underline-offset-4 hover:underline"
                  >
                    {v.name}
                  </a>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {v.blurb}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="mt-16 flex flex-col gap-8">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="border-l-2 border-primary/40 pl-5">
              <h2 className="font-display text-xl font-bold tracking-tight">{p.title}</h2>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
                {p.body}
              </p>
            </div>
          ))}
        </div>

      </div>
    </>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { Marquee } from "./marquee";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/accordion";
import { ParticleField } from "./particle-field";
import { Reveal } from "./reveal";
import { Hero } from "./hero";

// ════════════════════════════════════════════════════════════════════════════
// The home page.
//
// One H1. Every section below it is an H2, in the order a person actually asks
// the questions: what is it → how do I start → what happens when someone else
// joins → what can I do with it → is there an API → what's the catch.
//
// What is NOT here, and won't be until it's true: customer logos, a "trusted by
// 500,000 teams" line, testimonials, a G2 badge. Every one of those is a claim
// you have to maintain, and the first person who checks stops trusting the rest
// of the page.
//
// The copy leads on COLLABORATION, because that's the honest differentiator: the
// roles, the comments, the history, the share links and the forms are all built
// and all real. It does not lead on "faster than Airtable", which we haven't
// measured, or "open source", which is a licence and not a benefit.
// ════════════════════════════════════════════════════════════════════════════

const USE_CASES = [
  "CRM",
  "Content calendar",
  "Bug tracker",
  "Product roadmap",
  "Inventory",
  "Applicant tracking",
  "Sales pipeline",
  "Event planning",
  "Research database",
  "Asset library",
  "Invoice log",
  "Editorial calendar",
];

export function Landing() {
  return (
    <>
      <Hero />
      <UseCasesBand />
      <HowItWorks />
      <Collaboration />
      <Views />
      <Platform />
      <Faq />
      <FinalCta />
    </>
  );
}

// ─── Use-cases band ─────────────────────────────────────────────────────────

function UseCasesBand() {
  return (
    <section className="border-b bg-muted/20">
      <div className="mx-auto max-w-6xl px-4 py-9">
        <p className="mb-5 text-center text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          One tool, all of this
        </p>
        <Marquee items={USE_CASES} />
      </div>
    </section>
  );
}

// ─── How it works ───────────────────────────────────────────────────────────

const STEPS = [
  {
    n: "01",
    title: "Drop in a file",
    body: "CSV, XLSX, or JSON. Every column gets a type from its values — a zip code stays 02134, not 2134, which is how most importers quietly wreck a column.",
  },
  {
    n: "02",
    title: "Give it a shape",
    body: "Rename a column, change its type, point one table at another and the link runs both ways. Nothing rewrites a row, so you can change your mind and change it straight back.",
  },
  {
    n: "03",
    title: "Hand it to someone",
    body: "Invite them by email at the role you choose, or send a read-only link to a view. No account needed, and hidden columns stay hidden.",
  },
];

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="section-invert scroll-mt-20 border-b bg-background text-foreground"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
        <div className="max-w-2xl">
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.14em]">
            How it works
          </Badge>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight md:text-4xl">
            Three steps, and you never write a schema
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
            Put the data in first; the structure comes out the other side.
          </p>
        </div>

        <ol className="mt-14 grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map((step) => (
            <li key={step.n} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="font-mono-data text-[13px] font-medium text-primary">
                  {step.n}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <h3 className="font-display text-xl font-bold tracking-tight">{step.title}</h3>
              <p className="text-[14.5px] leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ─── Collaboration — the load-bearing section ───────────────────────────────

const COLLAB = [
  {
    title: "Five roles, and they mean something",
    body: "Viewer, commenter, editor, creator, owner. The one that trips people up: an editor changes data and views, a creator changes the tables and fields themselves. SWAMP spells it out.",
  },
  {
    title: "Comment without being able to break anything",
    body: "For the person who should be able to say “this looks off” without touching the data. You can edit your own comment; nobody else can, at any role.",
  },
  {
    title: "History, field by field",
    body: "It records “Alice changed Stage from Open to Won,” not “someone updated this record.” The log is append-only — nobody rewrites it, the owner included.",
  },
  {
    title: "Their edit shows up in your grid",
    body: "No refresh button, and no tug-of-war over your cursor mid-word in a cell.",
  },
  {
    title: "Send a link, not a copy",
    body: "Share a view publicly, with a password if you want. A hidden column can't be filtered or searched by a visitor, so nobody infers a salary from the row count.",
  },
  {
    title: "Forms that write straight into a table",
    body: "Conditional questions, a fixed set of options, a redirect when done. Whatever the form doesn't show, nobody can make it write.",
  },
];

function Collaboration() {
  return (
    <section id="collaboration" className="scroll-mt-20 border-b bg-muted/25">
      <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
        <div className="max-w-2xl">
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.14em]">
            Collaboration
          </Badge>
          <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight md:text-4xl">
            The part that breaks when a second person shows up
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
            A spreadsheet is fine until someone else opens it — then you&apos;re emailing
            versions around and one wrong paste is gone for good. SWAMP built this part
            first.
          </p>
        </div>

        {/* A bento grid — the wide cards (roles, history, forms) carry the load,
            the square ones sit beside them. Each card lifts on hover and rises into
            view on scroll. */}
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {COLLAB.map(({ title, body }, i) => (
            <Reveal
              key={title}
              delay={(i % 3) * 0.08}
              className={cn("h-full", (i === 0 || i === 3 || i === 4) && "lg:col-span-2")}
            >
              <div className="group flex h-full min-h-[10rem] flex-col justify-center gap-2 rounded-xl border bg-background/40 p-6 transition-[transform,background-color,border-color] duration-300 hover:-translate-y-1 hover:border-foreground/25 hover:bg-background/70">
                <h3 className="text-[15.5px] font-semibold tracking-tight">{title}</h3>
                <p className="max-w-md text-[14px] leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Views ──────────────────────────────────────────────────────────────────

const VIEWS = [
  { name: "Grid", body: "Arrow keys, Tab, Enter to edit, ⌘C/⌘V as TSV that round-trips with Excel. A fill handle that continues a series. ⌘Z through all of it." },
  { name: "Kanban", body: "Stacks from a single-select. Drag a card between them and the value changes." },
  { name: "Gallery", body: "Cards with a cover image. Click one to open the record." },
  { name: "Calendar", body: "Anything with a date, laid on a month. Drag to re-date it." },
  { name: "Form", body: "A public page that writes into the table. No account needed to fill it in." },
];

function Views() {
  return (
    <section
      id="views"
      className="section-invert scroll-mt-20 border-b bg-background text-foreground"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div>
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.14em]">
              Views
            </Badge>
            <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight md:text-4xl">
              One table. However you need to look at it.
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
              A view is a lens, not a copy. Change a value in one and it changes in all
              of them, because a single set of records sits underneath. Filters, sorts
              and widths are saved per view, so yours doesn&apos;t move someone else&apos;s.
            </p>
          </div>

          <ul className="flex flex-col divide-y border-y">
            {VIEWS.map(({ name, body }) => (
              <li key={name} className="flex flex-col gap-1 py-5">
                <h3 className="text-[15px] font-semibold tracking-tight">{name}</h3>
                <p className="text-[14px] leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ─── Platform ───────────────────────────────────────────────────────────────

function Platform() {
  return (
    <section className="border-b bg-muted/25">
      <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.14em]">
              For the developer on the team
            </Badge>
            <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight md:text-4xl">
              There&apos;s an API, and it isn&apos;t an afterthought
            </h2>

            <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                The same query engine the app uses, exposed. Scoped tokens, keyset
                pagination, a filter tree, and records keyed by a{" "}
                <strong className="font-medium text-foreground">stable field key</strong>.
                Rename a column in the UI and your nightly script keeps working.
              </p>
              <p>
                Webhooks fire on a condition you write like a filter. Every delivery is
                signed, retried, and logged.
              </p>
              <p>
                A token can never do more than the person who made it. Permissions are
                recomputed on every call, so demoting someone stops their integration on
                the next request.
              </p>
            </div>

          </div>

          {/* Real code. It's what the endpoint actually accepts and returns. */}
          <Reveal className="overflow-hidden rounded-xl border bg-card shadow-lg shadow-black/5 dark:shadow-black/30">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
              <span className="size-2.5 rounded-full bg-muted-foreground/40" />
              <span className="size-2.5 rounded-full bg-muted-foreground/50" />
              <span className="ml-2 font-mono-data text-[11.5px] text-muted-foreground">bash</span>
            </div>
            <pre className="overflow-x-auto p-5 font-mono-data text-[12.5px] leading-relaxed">
              <code>
                <span className="text-muted-foreground"># every deal over $10k, biggest first</span>
                {"\n"}
                <span className="text-primary">curl</span> -H{" "}
                <span className="text-foreground/90">
                  &quot;Authorization: Bearer $TOKEN&quot;
                </span>{" "}
                \{"\n"}
                {"  "}
                <span className="text-foreground/90">
                  &quot;$API/tables/$T/records?sort=fld_total:desc&quot;
                </span>
                {"\n\n"}
                <span className="text-muted-foreground">{"{"}</span>
                {"\n"}
                {"  "}
                <span className="text-muted-foreground">&quot;records&quot;</span>: [{"\n"}
                {"    "}
                {"{"} <span className="text-muted-foreground">&quot;id&quot;</span>:{" "}
                <span className="text-foreground/90">&quot;rec_…&quot;</span>,{" "}
                <span className="text-muted-foreground">&quot;fields&quot;</span>: {"{"}
                {"\n"}
                {"      "}
                <span className="text-muted-foreground">&quot;fld_company&quot;</span>:{" "}
                <span className="text-foreground/90">&quot;Globex&quot;</span>,{"\n"}
                {"      "}
                <span className="text-muted-foreground">&quot;fld_total&quot;</span>: 91750
                {"\n"}
                {"    "}
                {"}"} {"}"}
                {"\n"}
                {"  "}],{"\n"}
                {"  "}
                <span className="text-muted-foreground">&quot;cursor&quot;</span>:{" "}
                <span className="text-foreground/90">&quot;eyJrZXlz…&quot;</span>
                {"\n"}
                <span className="text-muted-foreground">{"}"}</span>
              </code>
            </pre>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ────────────────────────────────────────────────────────────────────
//
// These are marked up as FAQPage structured data on the page that renders them —
// which is only legitimate BECAUSE they are visible here, to a human. Marking up
// answers you don't show is cloaking, and it's the one SEO shortcut that gets a
// person from Google looking at your site by hand.

export const FAQ_ITEMS = [
  {
    q: "Is SWAMP an Airtable alternative?",
    a: "It solves the same problem: a spreadsheet a team has outgrown. You get tables that link to each other, several ways to look at the same records, roles, comments, share links, and forms. SWAMP is much younger, and Airtable has features it doesn't. Everything described on this page is built and working.",
  },
  {
    q: "Do I have to define a schema before I can import anything?",
    a: "No. Drop in a CSV, XLSX, or JSON file and every column gets a type from its values. You can change any of them later, and changing a type doesn't rewrite your data. If a guess is wrong, switch it back and nothing is lost.",
  },
  {
    q: "Can I share a table without giving someone an account?",
    a: "Yes. Publish a view as a link, with an optional password. A visitor can read it and filter it in their browser, and nothing they do is saved. A column you hid can't be filtered or searched either, so nobody can infer a value they were never shown.",
  },
  {
    q: "What happens if two people edit the same row at the same time?",
    a: "Two edits to different cells of the same row both survive, because the merge happens inside the database rather than in a browser that read the row a second ago. Two edits to the same cell resolve last-write-wins, the way every spreadsheet already does.",
  },
  {
    q: "Can I get my data out?",
    a: "Export any view to CSV or XLSX, with its filters and sorts applied. Or read everything through the REST API with a token you create yourself. There is no export fee and no lock-in step.",
  },
  {
    q: "How much does it cost?",
    a: "Nothing right now. It's in beta and there's no pricing yet. When that changes, this page says so first, and there will always be a free tier.",
  },
];

function Faq() {
  return (
    <section
      id="faq"
      className="section-invert scroll-mt-20 border-b bg-background text-foreground"
    >
      <div className="mx-auto max-w-3xl px-4 py-20 md:py-28">
        <h2 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">
          Questions people actually ask
        </h2>

        {/* An accordion, but the answers also live in the FAQPage JSON-LD on this
            page — so the rich result works whether or not a crawler expands them.
            The first one is open by default, so the page never looks empty. */}
        <Accordion
          type="single"
          collapsible
          defaultValue="faq-0"
          className="mt-8 border-t"
        >
          {FAQ_ITEMS.map(({ q, a }, i) => (
            <AccordionItem key={q} value={`faq-${i}`}>
              <AccordionTrigger className="text-[16px] font-semibold tracking-tight">
                {q}
              </AccordionTrigger>
              <AccordionContent className="text-[14.5px] leading-relaxed text-muted-foreground">
                {a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

// ─── Final CTA ──────────────────────────────────────────────────────────────

function FinalCta() {
  return (
    <section className="relative overflow-hidden">
      <ParticleField />
      <div className="relative mx-auto max-w-6xl px-4 py-24 text-center md:py-32">
        <h2 className="mx-auto max-w-2xl font-display text-3xl font-extrabold tracking-tight md:text-5xl">
          Put a spreadsheet in. See what comes out.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-muted-foreground">
          It takes about a minute, and you don&apos;t have to decide anything first.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="h-12 w-full gap-2 bg-brand px-8 text-[15px] text-brand-foreground hover:bg-brand/90 focus-visible:ring-brand sm:w-auto"
          >
            <Link href="/auth/register">
              Start free
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="ghost"
            className="h-12 w-full px-7 text-[15px] sm:w-auto"
          >
            <Link href="/auth/sign-in">I already have an account</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

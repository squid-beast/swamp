import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "About — SWAMP" };

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 md:py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">
        About SWAMP
      </h1>
      <div className="mt-8 flex flex-col gap-6 text-[15px] leading-relaxed text-muted-foreground">
        <p>
          SWAMP is a place to dump your data and get a usable interface back. Point a webhook at
          it, upload a CSV, XLSX, or JSON file, and it reads the values, infers a type for every
          column, builds a field registry, and renders a grid, board, gallery, and dashboard —
          all from the metadata, with no schema mapping.
        </p>
        <p>
          The idea is simple: most tools make you model your data before you can look at it. SWAMP
          flips that. Throw the data in first; the structure comes out the other side.
        </p>
        <p>
          It is an open project built by{" "}
          <a
            href="https://github.com/squid-beast"
            target="_blank"
            rel="noreferrer"
            className="text-foreground hover:underline"
          >
            Squid-Beast
          </a>
          . Made with a random thought 😂.
        </p>
      </div>
      <div className="mt-8">
        <Button asChild size="lg" className="h-11">
          <Link href="/app">Launch the workspace</Link>
        </Button>
      </div>
    </div>
  );
}

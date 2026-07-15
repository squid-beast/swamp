import Link from "next/link";
import { FOOTER_COLUMNS } from "../nav";
import { Mark } from "./site-nav";
import { CookieSettingsButton } from "./cookie-settings-button";

// The footer.
//
// Every link goes somewhere real. The old one pointed "Documentation" at a README
// that doesn't exist and "Changelog" at a commit list — and a footer full of dead
// ends tells a visitor the product is abandoned faster than an empty one does. It
// tells a crawler the same thing.
//
// No Careers. No Press. No Partners. We don't have those, so they aren't here.

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto max-w-6xl px-4 py-14 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="flex flex-col gap-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 font-display text-[17px] font-extrabold tracking-tight"
            >
              <Mark />
              SWAMP
            </Link>
            <p className="max-w-xs text-[13.5px] leading-relaxed text-muted-foreground">
              A shared database your team can actually use. Import a spreadsheet, get
              something you can filter, link, comment on, and hand to someone else.
            </p>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading} className="flex flex-col gap-3.5">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {col.heading}
              </h2>
              <ul className="flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.external || link.href.startsWith("mailto:") ? (
                      <a
                        href={link.href}
                        {...(link.external ? { target: "_blank", rel: "noreferrer" } : {})}
                        className="text-[13.5px] text-foreground/70 transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[13.5px] text-foreground/70 transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-[12.5px] text-muted-foreground sm:flex-row">
          <span>© {year} SWAMP</span>
          <div className="flex items-center gap-4">
            <CookieSettingsButton className="transition-colors hover:text-foreground" />
            <span>Built in the open by Squid-Beast.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

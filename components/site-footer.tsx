import Link from "next/link";

type FLink = { label: string; href: string; external?: boolean };

const COLUMNS: { heading: string; links: FLink[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "How it works", href: "/#how" },
      { label: "Open workspace", href: "/app" },
      { label: "Import data", href: "/app?import=1" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "GitHub", href: "https://github.com/squid-beast/Webhook-Manager", external: true },
      { label: "Documentation", href: "https://github.com/squid-beast/Webhook-Manager#readme", external: true },
      { label: "Changelog", href: "https://github.com/squid-beast/Webhook-Manager/commits/main", external: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms of Use", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Cookie Policy", href: "/cookie-policy" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "mailto:hello@swamp.app", external: true },
    ],
  },
];

function FooterLink({ link }: { link: FLink }) {
  const cls = "text-[13.5px] text-foreground/70 transition-colors hover:text-foreground";
  if (link.external || link.href.startsWith("mailto:")) {
    return (
      <a
        href={link.href}
        target={link.href.startsWith("mailto:") ? undefined : "_blank"}
        rel="noreferrer"
        className={cls}
      >
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={cls}>
      {link.label}
    </Link>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-auto border-t">
      {/* categorized columns */}
      <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.heading} className="flex flex-col gap-3.5">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {col.heading}
              </div>
              <ul className="flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* bottom bar: copyright left · credit centered · brand right */}
      <div className="border-t">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-3 px-4 py-6 text-[12px] text-muted-foreground sm:grid-cols-3">
          <span className="text-center sm:text-left">© {year} SWAMP</span>
          <span className="order-first text-center sm:order-none">
            Made with a random thought 😂 by Squid-Beast.
          </span>
          <span className="text-center font-display text-sm font-extrabold tracking-tight text-foreground sm:text-right">
            SWAMP
          </span>
        </div>
      </div>
    </footer>
  );
}

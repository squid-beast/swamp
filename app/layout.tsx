import type { Metadata, Viewport } from "next";
import { Inter, Manrope, DM_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/shared/lib/utils";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { Toaster } from "@/shared/ui/sonner";
import { CookieConsent } from "@/features/marketing/components/cookie-consent";
import { ConsentAnalytics } from "@/features/marketing/components/consent-analytics";
import { SITE } from "@/shared/seo/site";
import { JsonLd, organizationSchema, websiteSchema } from "@/shared/seo/jsonld";

// NocoDB's type stack, self-hosted via next/font: Inter for body (the cv01/ss01
// feature settings in globals.css are Inter's alternates), Manrope for display,
// DM Mono for data.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "sans-serif"],
});

const display = Manrope({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// DM Mono ships only 300/400/500 — no bold weight exists.
const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // Without metadataBase, every relative URL Next generates — canonical, og:image,
  // og:url — resolves against localhost. In production that means a canonical tag
  // pointing at a machine that doesn't exist, and a link that renders as a grey
  // box in Slack. It is the single most common Next.js SEO bug.
  metadataBase: new URL(SITE.url),

  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    // Every page sets a bare title; this appends the brand. One rule, no page can
    // forget it, and no page double-appends it either.
    template: `%s — ${SITE.name}`,
  },

  description: SITE.description,
  applicationName: SITE.name,
  referrer: "origin-when-cross-origin",

  // What a person would actually type to find this. Not a keyword-stuffing tag —
  // Google ignores it — but Bing and a few crawlers still read it, and it costs
  // one line.
  keywords: [
    "collaborative database",
    "shared database for teams",
    "spreadsheet database",
    "Airtable alternative",
    "no-code database",
    "team workspace",
  ],

  authors: [{ name: "Lohith Kumar Neerukonda", url: `${SITE.url}/about` }],
  creator: "Lohith Kumar Neerukonda",

  formatDetection: { telephone: false, address: false, email: false },
};

// Tells the browser which colour to paint the chrome. Two values, because the app
// is dark by default but honours the system setting.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f0e" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(sans.variable, display.variable, mono.variable)}
    >
      <head>
        {/* Site-wide, so every page carries it. The per-page schemas (breadcrumbs,
            FAQ, the product itself) are added by the pages that earn them. */}
        <JsonLd data={organizationSchema()} />
        <JsonLd data={websiteSchema()} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="bottom-right" />
          <CookieConsent />
          <ConsentAnalytics />
        </ThemeProvider>
      </body>
    </html>
  );
}

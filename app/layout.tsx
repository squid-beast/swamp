import type { Metadata } from "next";
import localFont from "next/font/local";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/shared/lib/utils";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { Toaster } from "@/shared/ui/sonner";

// Body: Selawik, bundled OFL woff2 locally. Fallback "Segoe UI", system-ui.
const selawik = localFont({
  src: [
    { path: "./fonts/Selawik-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Selawik-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Selawik-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "sans-serif"],
});

// Display: Bricolage Grotesque — heavy, characterful grotesque for headings.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SWAMP — dump any data, get a UI",
  description: "Dump webhooks, JSON, CSV, and spreadsheets into the SWAMP. It types every column and builds the UI.",
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
      className={cn(selawik.variable, display.variable, mono.variable)}
    >
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

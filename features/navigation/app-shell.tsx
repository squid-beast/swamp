"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { DatasetSummary, Money } from "@/features/datasets/types";
import { fmtUSD } from "@/shared/lib/format";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/shared/ui/sidebar";
import { Separator } from "@/shared/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb";
import { Button } from "@/shared/ui/button";
import { AppSidebar } from "./app-sidebar";
import { CommandMenu } from "./command-menu";
import { ThemeToggle } from "@/shared/components/theme-toggle";

export type ShellUser = { name: string; email: string; avatarUrl: string | null };

export function AppShell({
  datasets,
  user,
  money,
  children,
}: {
  datasets: DatasetSummary[];
  user?: ShellUser | null;
  money?: Money | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [cmdOpen, setCmdOpen] = React.useState(false);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const current = datasets.find((d) => pathname === `/app/datasets/${d.id}`);

  return (
    <SidebarProvider>
      <AppSidebar datasets={datasets} user={user} onSearch={() => setCmdOpen(true)} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          {/* Desktop toggles from inside the sidebar (ChatGPT-style); this one is for mobile. */}
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Separator orientation="vertical" className="mr-1 h-5 md:hidden" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                {current ? (
                  <BreadcrumbLink href="/app">Overview</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="font-medium">Overview</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {current && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="max-w-[40vw] truncate font-medium">
                      {current.name}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCmdOpen(true)}
              className="size-8 md:hidden"
              aria-label="Search"
            >
              <Search className="size-4" />
            </Button>
            {money && <BalanceBadge money={money} />}
            <ThemeToggle />
          </div>
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </SidebarInset>

      <CommandMenu datasets={datasets} open={cmdOpen} onOpenChange={setCmdOpen} />
    </SidebarProvider>
  );
}

// The money number, always in view — just the amount, beside the theme toggle.
// Hover for the full picture; click through to the Overview money card.
function BalanceBadge({ money }: { money: Money }) {
  const detail = [
    `Stripe balance ${fmtUSD(money.balance)}`,
    `this month ${fmtUSD(money.revenueMtd)}`,
    `pipeline ${fmtUSD(money.pipelineValue)}`,
    money.updatedAt ? `updated ${new Date(money.updatedAt).toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      href="/app"
      title={detail}
      aria-label={`Balance: ${detail}`}
      className="mr-0.5 flex h-8 items-center rounded-md border border-border/70 bg-muted/40 px-2.5 font-display text-[13px] font-bold tabular-nums tracking-tight transition-colors hover:bg-muted"
    >
      {fmtUSD(money.balance)}
    </Link>
  );
}

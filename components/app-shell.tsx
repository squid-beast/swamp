"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { DatasetSummary } from "@/core/types";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "./app-sidebar";
import { CommandMenu } from "./command-menu";
import { ThemeToggle } from "./theme-toggle";

export type ShellUser = { name: string; email: string; avatarUrl: string | null };

export function AppShell({
  datasets,
  user,
  children,
}: {
  datasets: DatasetSummary[];
  user?: ShellUser | null;
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

  const current = datasets.find((d) => pathname === `/d/${d.id}`);

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
            <ThemeToggle />
          </div>
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </SidebarInset>

      <CommandMenu datasets={datasets} open={cmdOpen} onOpenChange={setCmdOpen} />
    </SidebarProvider>
  );
}

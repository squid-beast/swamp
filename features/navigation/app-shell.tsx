"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import type { NavBase } from "@/features/tables/nav";
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
  bases,
  user,
  children,
}: {
  bases: NavBase[];
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

  // Breadcrumb: which table are we looking at, and which base is it in?
  const current = bases
    .flatMap((b) => b.tables.map((t) => ({ base: b, table: t })))
    .find(({ table }) => pathname === `/app/t/${table.id}`);

  return (
    <SidebarProvider>
      <AppSidebar bases={bases} user={user} onSearch={() => setCmdOpen(true)} />
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
                    <span className="truncate text-muted-foreground">
                      {current.base.name}
                    </span>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="max-w-[30vw] truncate font-medium">
                      {current.table.name}
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

      <CommandMenu bases={bases} open={cmdOpen} onOpenChange={setCmdOpen} />
    </SidebarProvider>
  );
}

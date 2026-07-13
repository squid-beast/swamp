"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Webhook,
  FileSpreadsheet,
  Braces,
  Database,
  Table2,
  Kanban,
  Images,
  Gauge,
  LayoutDashboard,
  Plus,
  SunMoon,
  Home,
} from "lucide-react";
import { DatasetSummary, ViewType } from "@/core/types";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

const SRC_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  json: Braces,
  webhook: Webhook,
  sheet: FileSpreadsheet,
};

const VIEW_META: Record<ViewType, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  grid: { label: "Grid", icon: Table2 },
  kanban: { label: "Board", icon: Kanban },
  gallery: { label: "Gallery", icon: Images },
  dashboard: { label: "Dashboard", icon: Gauge },
};

export function CommandMenu({
  datasets,
  open,
  onOpenChange,
}: {
  datasets: DatasetSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme, resolvedTheme } = useTheme();

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const current = datasets.find((d) => pathname === `/d/${d.id}`);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search datasets, views, actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {current && (
          <>
            <CommandGroup heading={`Views · ${current.name}`}>
              {current.recommendedViews.map((v) => {
                const meta = VIEW_META[v];
                const Icon = meta.icon;
                return (
                  <CommandItem
                    key={v}
                    value={`view ${meta.label} ${current.name}`}
                    onSelect={() => go(`/d/${current.id}?view=${v}`)}
                  >
                    <Icon />
                    {meta.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Datasets">
          {datasets.map((d) => {
            const Icon = SRC_ICON[d.source.kind] ?? Database;
            return (
              <CommandItem
                key={d.id}
                value={`dataset ${d.name}`}
                onSelect={() => go(`/d/${d.id}`)}
              >
                <Icon />
                <span className="truncate">{d.name}</span>
                <span className="ml-auto font-mono-data text-xs text-muted-foreground">
                  {d.rowCount} rows
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem value="overview home" onSelect={() => go("/app")}>
            <LayoutDashboard />
            Go to overview
          </CommandItem>
          <CommandItem value="import data upload" onSelect={() => go("/app/import")}>
            <Plus />
            Import data
          </CommandItem>
          <CommandItem value="landing marketing home page" onSelect={() => go("/")}>
            <Home />
            Landing page
          </CommandItem>
          <CommandItem
            value="toggle theme dark light"
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              onOpenChange(false);
            }}
          >
            <SunMoon />
            Toggle theme
            <CommandShortcut>⌘K then ⌥</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

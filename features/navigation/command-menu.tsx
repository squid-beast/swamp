"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Database, SunMoon, Table2, UploadCloud, UserRound } from "lucide-react";
import type { NavBase } from "@/features/tables/nav";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/shared/ui/command";

// ⌘K. Jump to any table without walking the tree.
//
// Tables carry their base name as a suffix rather than being grouped under it:
// two bases can each have a "Contacts" table, and a flat list that doesn't tell
// you which one you're picking is a list you can't use.

export function CommandMenu({
  bases,
  open,
  onOpenChange,
}: {
  bases: NavBase[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router]
  );

  const tables = bases.flatMap((b) =>
    b.tables.map((t) => ({ ...t, baseName: b.name }))
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search tables and actions…" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>

        {tables.length > 0 && (
          <CommandGroup heading="Tables">
            {tables.map((t) => (
              <CommandItem
                key={t.id}
                // The base name is part of the search value, so typing "crm cont"
                // finds Contacts inside the CRM base.
                value={`${t.name} ${t.baseName}`}
                onSelect={() => go(`/app/t/${t.id}`)}
              >
                <Table2 className="mr-2 size-3.5" />
                <span>{t.name}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {t.baseName}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {bases.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Bases">
              {bases.map((b) => (
                <CommandItem
                  key={b.id}
                  value={`${b.name} add table`}
                  onSelect={() => go(`/app/import?baseId=${b.id}`)}
                >
                  <Database className="mr-2 size-3.5" />
                  <span>{b.name}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    Add a table
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="import data csv excel" onSelect={() => go("/app/import")}>
            <UploadCloud className="mr-2 size-3.5" />
            Import data
          </CommandItem>
          <CommandItem value="profile account" onSelect={() => go("/app/profile")}>
            <UserRound className="mr-2 size-3.5" />
            Profile
          </CommandItem>
          <CommandItem
            value="toggle theme dark light"
            onSelect={() => {
              onOpenChange(false);
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
            }}
          >
            <SunMoon className="mr-2 size-3.5" />
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

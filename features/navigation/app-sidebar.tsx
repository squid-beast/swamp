"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  ChevronsUpDown,
  Database,
  LogOut,
  Plus,
  Search,
  Table2,
  UploadCloud,
  UserRound,
} from "lucide-react";
import type { NavBase } from "@/features/tables/nav";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/shared/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { createClient } from "@/shared/supabase/client";
import { SwampMark } from "@/shared/components/swamp-mark";
import { cn } from "@/shared/lib/utils";
import type { ShellUser } from "./app-shell";

// The tree: bases → tables.
//
// The old sidebar listed a flat set of "datasets", because that's all the model
// had. A base is the thing a user calls a project; a table lives inside it.

export function AppSidebar({
  bases,
  user,
  onSearch,
}: {
  bases: NavBase[];
  user?: ShellUser | null;
  onSearch: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSidebar();

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  };

  const initials =
    user?.name
      ?.split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "?";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center justify-between">
            <Link href="/app" className="flex items-center gap-2 px-2 py-1">
              {/* Same mark as the marketing site. Keyed on collapse state so it
                  redraws its links each time the sidebar opens or closes. */}
              <SwampMark key={state} animate className="size-5 shrink-0" />
              <span className="font-display text-sm font-extrabold tracking-tight group-data-[collapsible=icon]:hidden">
                SWAMP
              </span>
            </Link>
            <SidebarTrigger className="hidden md:flex" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onSearch} tooltip="Search">
                  <Search />
                  <span>Search</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/app/import"}
                  tooltip="Import data"
                >
                  <Link href="/app/import">
                    <UploadCloud />
                    <span>Import data</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Bases</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {bases.length === 0 && (
                <p className="px-2 py-1.5 text-[12px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                  No bases yet. Import a file to make one.
                </p>
              )}

              {bases.map((base) => {
                // Open the base that contains the table you're looking at.
                const hasActive = base.tables.some(
                  (t) => pathname === `/app/t/${t.id}`
                );
                return (
                  <Collapsible
                    key={base.id}
                    defaultOpen={hasActive || bases.length === 1}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={base.name}>
                          <Database />
                          <span className="truncate">{base.name}</span>
                          <ChevronRight className="ml-auto size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {base.tables.map((t) => (
                            <SidebarMenuSubItem key={t.id}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={pathname === `/app/t/${t.id}`}
                              >
                                <Link href={`/app/t/${t.id}`}>
                                  <Table2
                                    className={cn(
                                      "size-3.5",
                                      pathname === `/app/t/${t.id}` && "text-brand"
                                    )}
                                  />
                                  <span className="truncate">{t.name}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}

                          {base.tables.length === 0 && (
                            <SidebarMenuSubItem>
                              <span className="px-2 py-1 text-[12px] text-muted-foreground">
                                No tables
                              </span>
                            </SidebarMenuSubItem>
                          )}

                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild>
                              <Link href={`/app/import?baseId=${base.id}`}>
                                <Plus className="size-3.5" />
                                <span>New table</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" tooltip={user?.name ?? "Account"}>
                  <Avatar className="size-7 rounded-md">
                    <AvatarImage src={user?.avatarUrl ?? undefined} />
                    <AvatarFallback className="rounded-md text-[11px]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-[13px] font-medium">
                      {user?.name ?? "Account"}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {user?.email}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-3.5" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem asChild>
                  <Link href="/app/profile">
                    <UserRound className="mr-2 size-3.5" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 size-3.5" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronRight,
  ChevronsUpDown,
  Database,
  KeyRound,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Search,
  Sheet,
  Table2,
  Trash2,
  UploadCloud,
  UserRound,
  Users,
  Webhook,
} from "lucide-react";
import type { NavBase } from "@/features/tables/nav";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
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
import { RenameDialog } from "@/shared/components/rename-dialog";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { cn } from "@/shared/lib/utils";
import { initialsFromName } from "@/shared/lib/format";
import type { ShellUser } from "./app-shell";

// The tree: bases → tables.
//
// The old sidebar listed a flat set of "datasets", because that's all the model
// had. A base is the thing a user calls a project; a table lives inside it.
//
// ── Object management ──
//
// Until now this tree could only grow. "New table" meant "go to the import
// screen", and there was no way at all to rename or delete a table or a base —
// the data-layer functions existed with no route and no caller. The "…" menus
// below are that missing surface.
//
// Nothing here checks permissions. A viewer sees the same menu as an owner and
// the database refuses them, which is the same rule the rest of the app follows:
// RLS is the boundary, the UI is not. The one place that bites is Delete base —
// creators can update a base but only owners may delete one, so a creator's click
// comes back 42501 and we show what the server said rather than guessing in
// advance. See supabase/migrations/20260716000000_object_management.sql.

/** One dialog of each kind, driven by which action is pending — rather than a
 *  pair of dialogs per row, which is the same thing N times over in the DOM. */
type Pending =
  | { kind: "rename"; what: "base" | "table"; id: string; name: string }
  | { kind: "delete"; what: "base" | "table"; id: string; name: string }
  | { kind: "create-table"; baseId: string }
  | { kind: "create-base"; workspaceId: string }
  | null;

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
  const [pending, setPending] = React.useState<Pending>(null);

  /** Every mutation here is the same shape: call, surface the server's own words
   *  on failure, refresh on success. The message matters — "only a base owner can
   *  delete a base" is the difference between a bug and an explanation. */
  const send = async (
    url: string,
    init: RequestInit,
    fallback: string
  ): Promise<boolean> => {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? fallback);
      return false;
    }
    router.refresh();
    return true;
  };

  const renameBase = (id: string, name: string) =>
    send(`/api/bases/${id}`, { method: "PATCH", body: JSON.stringify({ name }) },
      "Could not rename the base");

  const renameTable = (id: string, name: string) =>
    send(`/api/tables/${id}`, { method: "PATCH", body: JSON.stringify({ name }) },
      "Could not rename the table");

  const deleteBase = async (id: string) => {
    if (await send(`/api/bases/${id}`, { method: "DELETE" }, "Could not delete the base")) {
      toast.success("Base deleted");
      // The base you were looking at may be gone; /app always exists.
      if (pathname.startsWith(`/app/b/${id}`)) router.push("/app");
    }
  };

  const deleteTable = async (id: string) => {
    if (await send(`/api/tables/${id}`, { method: "DELETE" }, "Could not delete the table")) {
      toast.success("Table deleted");
      if (pathname === `/app/t/${id}`) router.push("/app");
    }
  };

  const createTable = async (baseId: string, name: string) => {
    const res = await fetch("/api/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseId, name }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return toast.error(body?.error ?? "Could not create the table");
    }

    const { tableId } = await res.json();
    router.push(`/app/t/${tableId}`);
    router.refresh();
  };

  const createBase = async (workspaceId: string, name: string) => {
    if (
      await send("/api/bases", { method: "POST", body: JSON.stringify({ workspaceId, name }) },
        "Could not create the base")
    ) {
      toast.success(`Created ${name}`);
    }
  };

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  };

  const initials = initialsFromName(user?.name);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center group-data-[collapsible=icon]:justify-center">
            <Link
              href="/app"
              className="flex items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:px-0"
            >
              {/* Same mark as the marketing site. Keyed on collapse state so it
                  redraws its links each time the sidebar opens or closes. */}
              <SwampMark key={state} animate className="size-5 shrink-0" />
              <span className="font-display text-sm font-extrabold tracking-tight group-data-[collapsible=icon]:hidden">
                SWAMP
              </span>
            </Link>
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
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/app/connect"}
                  tooltip="Connect a sheet"
                >
                  <Link href="/app/connect">
                    <Sheet />
                    <span>Connect a sheet</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Bases</SidebarGroupLabel>
          {/* A base needs a workspace, and the tree already knows one. With no
              bases there is nothing to read it from — import still bootstraps. */}
          {bases.length > 0 && (
            <SidebarGroupAction
              title="New base"
              onClick={() =>
                setPending({ kind: "create-base", workspaceId: bases[0].workspaceId })
              }
            >
              <Plus />
              <span className="sr-only">New base</span>
            </SidebarGroupAction>
          )}
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

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuAction showOnHover className="right-6">
                            <MoreHorizontal />
                            <span className="sr-only">Base actions</span>
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start" className="w-44">
                          {/* Import lives here, not on the "+ New table" row.
                              Both used to be called "New table" — one made a
                              table, one opened the import screen. */}
                          <DropdownMenuItem asChild>
                            <Link href={`/app/import?baseId=${base.id}`}>
                              <UploadCloud className="mr-2 size-3.5" />
                              Import data
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({
                                kind: "rename",
                                what: "base",
                                id: base.id,
                                name: base.name,
                              })
                            }
                          >
                            <Pencil className="mr-2 size-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() =>
                              setPending({
                                kind: "delete",
                                what: "base",
                                id: base.id,
                                name: base.name,
                              })
                            }
                          >
                            <Trash2 className="mr-2 size-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {base.tables.map((t) => (
                            // relative + group/menu-item: SidebarMenuSubItem is a
                            // bare <li>, and SidebarMenuAction positions absolutely
                            // against a hover group.
                            <SidebarMenuSubItem
                              key={t.id}
                              className="group/menu-item relative"
                            >
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

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <SidebarMenuAction showOnHover>
                                    <MoreHorizontal />
                                    <span className="sr-only">Table actions</span>
                                  </SidebarMenuAction>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  side="right"
                                  align="start"
                                  className="w-44"
                                >
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      setPending({
                                        kind: "rename",
                                        what: "table",
                                        id: t.id,
                                        name: t.name,
                                      })
                                    }
                                  >
                                    <Pencil className="mr-2 size-3.5" />
                                    Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() =>
                                      setPending({
                                        kind: "delete",
                                        what: "table",
                                        id: t.id,
                                        name: t.name,
                                      })
                                    }
                                  >
                                    <Trash2 className="mr-2 size-3.5" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
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
                            {/* Says "New table", makes a table. It used to link to
                                the import screen, which is why a blank table was
                                unreachable — createTable had no caller at all.
                                asChild + a real <button>: SidebarMenuSubButton is an
                                <a> by default, and an anchor with an onClick and no
                                href is neither a button to a screen reader nor
                                reachable by keyboard. */}
                            <SidebarMenuSubButton
                              asChild
                              onClick={() =>
                                setPending({ kind: "create-table", baseId: base.id })
                              }
                            >
                              <button type="button" className="w-full">
                                <Plus className="size-3.5" />
                                <span>New table</span>
                              </button>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>

                          {/* Base settings — the pages that were built but had no
                              way in. One line each, under the base they belong to. */}
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === `/app/b/${base.id}/members`}
                            >
                              <Link href={`/app/b/${base.id}/members`}>
                                <Users className="size-3.5" />
                                <span>Members</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === `/app/b/${base.id}/api`}
                            >
                              <Link href={`/app/b/${base.id}/api`}>
                                <KeyRound className="size-3.5" />
                                <span>API tokens</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === `/app/b/${base.id}/automations`}
                            >
                              <Link href={`/app/b/${base.id}/automations`}>
                                <Webhook className="size-3.5" />
                                <span>Workflows</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === `/app/b/${base.id}/integrations`}
                            >
                              <Link href={`/app/b/${base.id}/integrations`}>
                                <Plug className="size-3.5" />
                                <span>Integrations</span>
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

      {/* ── The dialogs the "…" menus drive ── */}

      <RenameDialog
        open={pending?.kind === "rename"}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === "rename" ? `Rename ${pending.what}` : "Rename"}
        placeholder="Name"
        initialName={pending?.kind === "rename" ? pending.name : ""}
        onSave={(name) => {
          if (pending?.kind !== "rename") return;
          if (pending.what === "base") renameBase(pending.id, name);
          else renameTable(pending.id, name);
          setPending(null);
        }}
      />

      {/* Same dialog, empty initial name — nothing is "unchanged", so it commits. */}
      <RenameDialog
        open={pending?.kind === "create-table"}
        onOpenChange={(o) => !o && setPending(null)}
        title="New table"
        placeholder="Table name"
        submitLabel="Create"
        initialName=""
        onSave={(name) => {
          if (pending?.kind !== "create-table") return;
          createTable(pending.baseId, name);
          setPending(null);
        }}
      />

      <RenameDialog
        open={pending?.kind === "create-base"}
        onOpenChange={(o) => !o && setPending(null)}
        title="New base"
        placeholder="Base name"
        submitLabel="Create"
        initialName=""
        onSave={(name) => {
          if (pending?.kind !== "create-base") return;
          createBase(pending.workspaceId, name);
          setPending(null);
        }}
      />

      <ConfirmDialog
        open={pending?.kind === "delete"}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === "delete" ? `Delete ${pending.name}?` : "Delete?"}
        description={
          pending?.kind === "delete" && pending.what === "base"
            ? "The base and everything in it is removed from your sidebar. Only an owner can do this."
            : "The table and its records are removed from your sidebar."
        }
        onConfirm={() => {
          if (pending?.kind !== "delete") return;
          if (pending.what === "base") deleteBase(pending.id);
          else deleteTable(pending.id);
          setPending(null);
        }}
      />
    </Sidebar>
  );
}

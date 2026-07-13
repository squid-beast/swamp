"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Search,
  LayoutGrid,
  Kanban,
  MoreHorizontal,
  Pencil,
  Trash2,
  ArrowUpRight,
  Webhook,
  FileSpreadsheet,
  Braces,
  Database,
  UserRound,
  LogOut,
  ChevronsUpDown,
} from "lucide-react";
import { DatasetSummary } from "@/features/datasets/types";
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
  SidebarMenuAction,
  SidebarRail,
  SidebarTrigger,
} from "@/shared/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { RenameDialog } from "@/shared/components/rename-dialog";
import { createClient } from "@/shared/supabase/client";
import type { ShellUser } from "./app-shell";

const SRC_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  json: Braces,
  webhook: Webhook,
  sheet: FileSpreadsheet,
};

export function AppSidebar({
  datasets,
  user,
  onSearch,
}: {
  datasets: DatasetSummary[];
  user?: ShellUser | null;
  onSearch?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Dropdown → AlertDialog: hold the pending dataset so the confirm lives
  // outside the (closing) dropdown menu.
  const [toDelete, setToDelete] = React.useState<DatasetSummary | null>(null);
  const [toRename, setToRename] = React.useState<DatasetSummary | null>(null);
  const [signOutOpen, setSignOutOpen] = React.useState(false);

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  };

  const initials = user
    ? user.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "U"
    : "U";

  const remove = async (id: string, name: string) => {
    await fetch(`/api/datasets/${id}`, { method: "DELETE" });
    toast.success(`Deleted “${name}”`);
    if (pathname === `/app/datasets/${id}`) router.push("/app");
    router.refresh();
  };

  const rename = async (id: string, name: string) => {
    await fetch(`/api/datasets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    toast.success("Dataset renamed");
    router.refresh();
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-2 pt-2">
        <div className="flex items-center justify-between gap-1 group-data-[collapsible=icon]:justify-center">
          <Link
            href="/app"
            className="px-2 font-display text-[15px] font-extrabold tracking-tight group-data-[collapsible=icon]:hidden"
          >
            SWAMP
          </Link>
          <SidebarTrigger className="size-8 text-muted-foreground hover:text-foreground" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* top actions — like ChatGPT's New chat / Search */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/app"} tooltip="Overview">
                  <Link href="/app">
                    <LayoutGrid />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Search" onClick={onSearch}>
                  <Search />
                  <span>Search</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/app/import"} tooltip="Import data">
                  <Link href="/app/import">
                    <Plus />
                    <span>Import data</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/app/tasks"}
                  tooltip="Tasks"
                >
                  <Link href="/app/tasks">
                    <Kanban />
                    <span>Tasks</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* dataset list — like ChatGPT's chat history */}
        <SidebarGroup>
          <SidebarGroupLabel>Datasets</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {datasets.map((d) => {
                const Icon = SRC_ICON[d.source.kind] ?? Database;
                const active = pathname === `/app/datasets/${d.id}`;
                return (
                  <SidebarMenuItem key={d.id}>
                    <SidebarMenuButton asChild isActive={active} tooltip={d.name}>
                      <Link href={`/app/datasets/${d.id}`}>
                        <Icon />
                        <span className="truncate">{d.name}</span>
                      </Link>
                    </SidebarMenuButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover>
                          <MoreHorizontal />
                          <span className="sr-only">Actions</span>
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start" className="w-44">
                        <DropdownMenuItem asChild>
                          <Link href={`/app/datasets/${d.id}`}>
                            <ArrowUpRight className="text-muted-foreground" />
                            Open dataset
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setToRename(d)}>
                          <Pencil className="text-muted-foreground" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setToDelete(d)}
                        >
                          <Trash2 className="text-destructive" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                );
              })}
              {datasets.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  No datasets yet.
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {user && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent"
                  >
                    <Avatar className="size-7 rounded-md">
                      {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
                      <AvatarFallback className="rounded-md text-[11px]">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                      <span className="truncate text-[13px] font-medium">{user.name}</span>
                      <span className="truncate text-[11px] text-muted-foreground">{user.email}</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuItem asChild>
                    <Link href="/app/profile">
                      <UserRound className="text-muted-foreground" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setSignOutOpen(true)}
                  >
                    <LogOut className="text-destructive" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}

      <SidebarRail />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={toDelete ? `Delete “${toDelete.name}”?` : ""}
        description="This permanently removes the dataset and all of its rows."
        confirmLabel="Delete"
        onConfirm={() => {
          if (toDelete) remove(toDelete.id, toDelete.name);
          setToDelete(null);
        }}
      />

      <RenameDialog
        open={toRename !== null}
        onOpenChange={(o) => !o && setToRename(null)}
        initialName={toRename?.name ?? ""}
        onSave={(name) => {
          if (toRename) rename(toRename.id, name);
        }}
      />

      <ConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title="Sign out?"
        description="You'll need to sign in again to get back to your swamp."
        confirmLabel="Sign out"
        destructive={false}
        onConfirm={() => {
          setSignOutOpen(false);
          signOut();
        }}
      />
    </Sidebar>
  );
}

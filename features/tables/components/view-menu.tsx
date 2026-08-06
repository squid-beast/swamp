"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Calendar as CalendarIcon,
  Check,
  Copy,
  FileText,
  GanttChartSquare,
  Globe,
  Grid3x3,
  Images,
  Kanban as KanbanIcon,
  List as ListIcon,
  MapPin,
  CopyPlus,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import type { Field, View, ViewLock, ViewType } from "../types";

const VIEW_ICON: Record<ViewType, React.ComponentType<{ className?: string }>> = {
  grid: Grid3x3,
  gallery: Images,
  kanban: KanbanIcon,
  calendar: CalendarIcon,
  form: FileText,
  list: ListIcon,
  timeline: GanttChartSquare,
  gantt: GanttChartSquare,
  map: MapPin,
};

const LOCK_LABEL: Record<ViewLock, { label: string; hint: string; icon: React.ComponentType<{ className?: string }> }> = {
  collaborative: {
    label: "Collaborative",
    hint: "Anyone who can edit can change this view's setup.",
    icon: Users,
  },
  locked: {
    label: "Locked",
    // The distinction people miss: locking a view freezes its CONFIG, not its
    // data. You can still edit records — you just can't move the goalposts for
    // everyone else.
    hint: "Nobody can change the setup. Records can still be edited.",
    icon: Lock,
  },
  personal: {
    label: "Personal",
    hint: "Only you can change the setup. Others see it read-only.",
    icon: User,
  },
};

export function ViewMenu({
  tableId,
  views,
  view,
  fields,
  canEdit,
  onChanged,
  onRestored,
}: {
  tableId: string;
  views: View[];
  view: View;
  fields: Field[];
  canEdit: boolean;
  onChanged: () => void;
  /** Records came back from the trash — the grid must re-query to show them. */
  onRestored?: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [trashing, setTrashing] = React.useState(false);
  const [name, setName] = React.useState(view.name);

  const go = (id: string) => router.push(`/app/t/${tableId}?view=${id}`);

  const create = async (type: ViewType) => {
    // A kanban needs a select field to stack by; a calendar needs a date. Creating
    // one without is how you get a view that opens to an error — so we collect the
    // requirement at creation time by picking a sensible default, and let the user
    // change it after.
    const stackField = fields.find((f) => f.type === "singleSelect" || f.type === "status");
    const dateField = fields.find((f) => f.type === "date" || f.type === "datetime");
    const coverField = fields.find((f) => f.type === "image");

    const coordField = fields.find((f) => f.type === "coordinates");

    if (type === "kanban" && !stackField) {
      toast.error("A kanban needs a single-select or status field to stack by.");
      return;
    }
    if ((type === "calendar" || type === "timeline" || type === "gantt") && !dateField) {
      toast.error(`A ${type} needs a date field.`);
      return;
    }
    if (type === "map" && !coordField) {
      toast.error("A map needs a coordinates field.");
      return;
    }

    const config: Record<string, unknown> = {};
    if (type === "kanban") config.stackFieldId = stackField!.id;
    if (type === "calendar" || type === "timeline" || type === "gantt") {
      config.ranges = [{ fromFieldId: dateField!.id }];
    }
    if (type === "gallery" && coverField) config.coverFieldId = coverField.id;
    if (type === "map") config.coordFieldId = coordField!.id;

    const res = await fetch(`/api/tables/${tableId}/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${type[0].toUpperCase()}${type.slice(1)}`,
        type,
        config,
      }),
    });

    if (!res.ok) {
      toast.error("Could not create the view");
      return;
    }

    const body = await res.json();
    router.refresh();
    go(body.view.id);
  };

  const duplicate = async () => {
    // Server-side now, so the copy carries the filters, sorts and field visibility
    // too — not just the view row. See /api/views/[id]/duplicate.
    const res = await fetch(`/api/views/${view.id}/duplicate`, { method: "POST" });

    if (!res.ok) {
      toast.error("Could not duplicate the view");
      return;
    }

    const body = await res.json();
    router.refresh();
    go(body.view.id);
  };

  const rename = async () => {
    const res = await fetch(`/api/views/${view.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });

    setRenaming(false);
    if (!res.ok) return toast.error("Could not rename the view");

    onChanged();
    router.refresh();
  };

  const setLock = async (lockType: ViewLock) => {
    const res = await fetch(`/api/views/${view.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockType }),
    });

    if (!res.ok) return toast.error("Could not change the view mode");
    onChanged();
    router.refresh();
  };

  const [duplicatingTable, setDuplicatingTable] = React.useState(false);
  const duplicateTable = async () => {
    if (duplicatingTable) return;
    setDuplicatingTable(true);

    // The heavy lift is server-side and atomic — fields, views and every record
    // copied in one function, or none. See /api/tables/[id]/duplicate.
    const res = await fetch(`/api/tables/${tableId}/duplicate`, { method: "POST" });
    setDuplicatingTable(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return toast.error(body?.error ?? "Could not duplicate the table");
    }

    const body = await res.json();
    toast.success("Table duplicated");
    router.refresh();
    router.push(`/app/t/${body.tableId}`);
  };

  const remove = async () => {
    const res = await fetch(`/api/views/${view.id}`, { method: "DELETE" });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // "The default view cannot be deleted" arrives here. A table must always
      // have somewhere to look at it.
      return toast.error(body?.error ?? "Could not delete the view");
    }

    router.refresh();
    const other = views.find((v) => v.id !== view.id);
    if (other) go(other.id);
  };

  return (
    <div className="flex items-center gap-1">
      {/* View switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px]">
            {React.createElement(VIEW_ICON[view.type], { className: "size-3.5" })}
            <span className="max-w-[8rem] truncate">{view.name}</span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">
            Views
          </DropdownMenuLabel>

          {views.map((v) => (
            <DropdownMenuItem key={v.id} onClick={() => go(v.id)}>
              {React.createElement(VIEW_ICON[v.type], {
                className: "mr-2 size-3.5 text-muted-foreground",
              })}
              <span className="truncate">{v.name}</span>
              {v.lockType !== "collaborative" && (
                <Lock className="ml-1 size-3 text-muted-foreground" />
              )}
              {v.id === view.id && <Check className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Plus className="mr-2 size-3.5" />
              New view
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {(["grid", "gallery", "kanban", "calendar", "list", "timeline", "gantt", "map", "form"] as ViewType[]).map((t) => (
                <DropdownMenuItem key={t} onClick={() => create(t)}>
                  {React.createElement(VIEW_ICON[t], { className: "mr-2 size-3.5" })}
                  <span className="capitalize">{t}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Actions on the current view */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="size-8 p-0" aria-label="View actions">
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            disabled={!canEdit}
            onClick={() => {
              setName(view.name);
              setRenaming(true);
            }}
          >
            <Pencil className="mr-2 size-3.5" />
            Rename
          </DropdownMenuItem>

          <DropdownMenuItem onClick={duplicate}>
            <Copy className="mr-2 size-3.5" />
            Duplicate
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => setSharing(true)}>
            <Globe className="mr-2 size-3.5" />
            Share…
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-[11px] text-muted-foreground">
            Table
          </DropdownMenuLabel>

          <DropdownMenuItem disabled={duplicatingTable} onClick={duplicateTable}>
            {duplicatingTable ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <CopyPlus className="mr-2 size-3.5" />
            )}
            Duplicate table
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => setTrashing(true)}>
            <Trash className="mr-2 size-3.5" />
            Trash…
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => router.push(`/app/t/${tableId}/permissions`)}>
            <ShieldCheck className="mr-2 size-3.5" />
            Permissions…
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Lock className="mr-2 size-3.5" />
              View mode
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {(Object.keys(LOCK_LABEL) as ViewLock[]).map((mode) => {
                const { label, hint, icon } = LOCK_LABEL[mode];
                return (
                  <DropdownMenuItem
                    key={mode}
                    onClick={() => setLock(mode)}
                    className="flex-col items-start gap-0.5"
                  >
                    <span className="flex w-full items-center">
                      {React.createElement(icon, { className: "mr-2 size-3.5" })}
                      {label}
                      {view.lockType === mode && <Check className="ml-auto size-3.5" />}
                    </span>
                    <span className="pl-[1.4rem] text-[11px] text-muted-foreground">
                      {hint}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-destructive"
            disabled={view.isDefault}
            onClick={remove}
          >
            <Trash2 className="mr-2 size-3.5" />
            {view.isDefault ? "Default view — can't delete" : "Delete view"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename view</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && rename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button onClick={rename} disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShareDialog open={sharing} onOpenChange={setSharing} view={view} />

      <TrashDialog
        open={trashing}
        onOpenChange={setTrashing}
        tableId={tableId}
        primaryKey={fields.find((f) => f.isPrimary)?.key ?? fields[0]?.key ?? ""}
        onRestored={onRestored}
      />
    </div>
  );
}

// ─── Trash ──────────────────────────────────────────────────────────────────
//
// Every delete in Swamp is soft, so nothing here is a resurrection — the rows
// were only tombstoned. This lists them and flips `deleted_at` back to null via
// the restore route, which is the exact inverse of the delete the undo stack
// already relies on.

interface TrashRecord {
  id: string;
  data: Record<string, unknown>;
  deletedAt: string;
}

function TrashDialog({
  open,
  onOpenChange,
  tableId,
  primaryKey,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableId: string;
  primaryKey: string;
  onRestored?: () => void;
}) {
  const [records, setRecords] = React.useState<TrashRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/tables/${tableId}/trash`);
    setLoading(false);
    if (!res.ok) return toast.error("Could not load the trash");
    setRecords((await res.json()).records as TrashRecord[]);
  }, [tableId]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const restore = async (ids: string[]) => {
    if (!ids.length || busy) return;
    setBusy(true);
    const res = await fetch(`/api/tables/${tableId}/records/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setBusy(false);

    if (!res.ok) return toast.error("Could not restore");

    setRecords((rs) => rs.filter((r) => !ids.includes(r.id)));
    toast.success(ids.length === 1 ? "Record restored" : `${ids.length} records restored`);
    onRestored?.();
  };

  const labelOf = (r: TrashRecord) => {
    const v = r.data[primaryKey];
    return v == null || v === "" ? "Untitled record" : String(v);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Deleted records, most recent first. Restoring one puts it back exactly
            where it was — nothing here was ever really removed.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            Nothing in the trash.
          </p>
        ) : (
          <div className="flex max-h-80 flex-col gap-1 overflow-auto">
            {records.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px]">{labelOf(r)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    Deleted {new Date(r.deletedAt).toLocaleString()}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 gap-1.5 text-[12px]"
                  disabled={busy}
                  onClick={() => restore([r.id])}
                >
                  <RotateCcw className="size-3" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}

        {records.length > 1 && (
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => restore(records.map((r) => r.id))}
            >
              Restore all
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({
  open,
  onOpenChange,
  view,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: View;
}) {
  const router = useRouter();
  const [shareId, setShareId] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [allowDownload, setAllowDownload] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const url = shareId ? `${window.location.origin}/s/${shareId}` : null;

  const share = async () => {
    setBusy(true);

    const res = await fetch(`/api/views/${view.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password || undefined, allowDownload }),
    });

    setBusy(false);
    if (!res.ok) return toast.error("Could not share the view");

    const body = await res.json();
    setShareId(body.shareId);
    router.refresh();
  };

  const revoke = async () => {
    setBusy(true);
    await fetch(`/api/views/${view.id}/share`, { method: "DELETE" });
    setBusy(false);

    setShareId(null);
    setPassword("");
    toast.success("Link revoked. Anyone holding it now gets a 404.");
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share “{view.name}”</DialogTitle>
          <DialogDescription>
            Anyone with the link can see this view. They can&apos;t edit it, and they
            can&apos;t see fields you&apos;ve hidden.
          </DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input readOnly value={url} className="font-mono text-[12px]" />
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(url);
                  toast.success("Copied");
                }}
              >
                Copy
              </Button>
            </div>

            {view.type === "form" && (
              <p className="rounded-md bg-muted/50 px-2.5 py-2 text-[12px] text-muted-foreground">
                This is a form. Visitors can submit responses — but only into the
                fields the form shows.
              </p>
            )}

            <Button variant="ghost" className="text-destructive" onClick={revoke} disabled={busy}>
              Revoke link
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] text-muted-foreground">
                Password (optional)
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank for no password"
              />
              {/* Once set, it can only be replaced. There's nowhere to read it back
                  from — Postgres stores a bcrypt hash and nothing else. */}
              <p className="text-[11px] text-muted-foreground">
                You won&apos;t be able to see this again — only replace it.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <Checkbox
                checked={allowDownload}
                onCheckedChange={(v) => setAllowDownload(!!v)}
              />
              Allow visitors to download a CSV
            </label>

            <Button onClick={share} disabled={busy} className={cn(busy && "opacity-70")}>
              {busy ? "Creating…" : "Create share link"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

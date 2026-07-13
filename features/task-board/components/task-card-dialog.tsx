"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

export type CardDraft = {
  title: string;
  description: string;
  priority: string; // "none" | "low" | "medium" | "high"
  dueDate: string; // "" or YYYY-MM-DD
};

const empty: CardDraft = { title: "", description: "", priority: "none", dueDate: "" };

export function TaskCardDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: Partial<CardDraft>;
  onSave: (draft: CardDraft) => void | Promise<void>;
}) {
  const [draft, setDraft] = React.useState<CardDraft>(empty);

  React.useEffect(() => {
    // Seed the form only when the dialog opens. `initial` is a fresh object every
    // render, so depending on it would reset the user's input on any re-render.
    if (open) setDraft({ ...empty, ...initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof CardDraft>(k: K, v: CardDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const submit = () => {
    if (!draft.title.trim()) return;
    onSave({ ...draft, title: draft.title.trim(), description: draft.description.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New task" : "Edit task"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-title" className="text-[12px] text-muted-foreground">
              Title
            </Label>
            <Input
              id="card-title"
              autoFocus
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder="What needs doing?"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-desc" className="text-[12px] text-muted-foreground">
              Description
            </Label>
            <textarea
              id="card-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Add details…"
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label id="card-priority" className="text-[12px] text-muted-foreground">
                Priority
              </Label>
              <Select value={draft.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger aria-labelledby="card-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="card-due" className="text-[12px] text-muted-foreground">
                Due date
              </Label>
              <Input
                id="card-due"
                type="date"
                value={draft.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!draft.title.trim()}>
            {mode === "create" ? "Add task" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

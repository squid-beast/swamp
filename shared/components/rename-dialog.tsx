"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Controlled rename dialog: prefilled input, Enter or Save commits a trimmed,
// non-empty, changed name. Used from the dataset "…" menu.
export function RenameDialog({
  open,
  onOpenChange,
  initialName,
  title = "Rename dataset",
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  title?: string;
  onSave: (name: string) => void | Promise<void>;
}) {
  const [value, setValue] = React.useState(initialName);

  // Reset to the current name each time the dialog opens.
  React.useEffect(() => {
    if (open) setValue(initialName);
  }, [open, initialName]);

  const submit = () => {
    const next = value.trim();
    if (!next || next === initialName.trim()) {
      onOpenChange(false);
      return;
    }
    onSave(next);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          onFocus={(e) => e.target.select()}
          placeholder="Dataset name"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!value.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

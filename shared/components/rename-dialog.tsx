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

// Controlled name dialog: prefilled input, Enter or Save commits a trimmed,
// non-empty, changed name.
//
// It doubles as a CREATE prompt — pass initialName="" and nothing is "unchanged",
// so the no-op guard below stays out of the way. That's why there's no separate
// create dialog: the two differ by a placeholder and a button label, not behaviour.
export function RenameDialog({
  open,
  onOpenChange,
  initialName,
  title = "Rename",
  placeholder = "Name",
  submitLabel = "Save",
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  title?: string;
  placeholder?: string;
  submitLabel?: string;
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
          placeholder={placeholder}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";
import { toast } from "sonner";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { createClient } from "@/shared/supabase/client";
import { cn } from "@/shared/lib/utils";
import type { Attachment, Field } from "../types";

// The attachment cell.
//
// The upload goes STRAIGHT TO STORAGE. This component asks the server for a
// signed URL for one path, then PUTs the bytes there itself. The file never passes
// through a route handler, which is what keeps a 50MB upload from being 50MB of
// serverless memory and a request that dies in the middle.
//
// The cell's value is `[{ id, name, size, mime, path, url }]`. `url` is signed on
// the way out of the read path and expires — it is not stored, and this component
// must not persist it. That is why `save()` strips it before writing.

const asList = (value: unknown): Attachment[] =>
  Array.isArray(value) ? (value as Attachment[]) : [];

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentCell({
  field,
  tableId,
  value,
  onChange,
}: {
  field: Field;
  tableId?: string;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const files = asList(value);
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  // Strip the signed URL before it goes back to the database. It expires, so a
  // stored one is at best dead and at worst a public link to a private file that
  // outlives every permission change made after it.
  const save = (next: Attachment[]) =>
    onChange(next.map(({ url: _url, ...rest }) => rest));

  const upload = async (fileList: FileList) => {
    if (!tableId || busy) return;
    setBusy(true);

    const added: Attachment[] = [];

    try {
      for (const file of Array.from(fileList)) {
        const res = await fetch("/api/attachments/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableId,
            fieldId: field.id,
            name: file.name,
            size: file.size,
            mime: file.type || "application/octet-stream",
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Could not upload ${file.name}`);
        }

        const ticket = await res.json();

        const { error } = await createClient()
          .storage.from("attachments")
          .uploadToSignedUrl(ticket.path, ticket.token, file);

        if (error) throw new Error(error.message);

        added.push(ticket.attachment as Attachment);
      }

      save([...files, ...added]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div
      className="flex h-full w-full items-center gap-1 overflow-hidden px-1"
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
      onDragOver={(e) => e.preventDefault()}
      data-testid="attachment-cell"
    >
      {files.map((file) => (
        <span
          key={file.path}
          className="group flex max-w-[140px] shrink-0 items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[11px]"
          title={`${file.name} — ${human(file.size)}`}
        >
          {/* No URL means the file is gone from storage but the reference isn't.
              Render the name, don't break the row. */}
          {file.url ? (
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="truncate underline-offset-2 hover:underline"
            >
              {file.name}
            </a>
          ) : (
            <span className="truncate text-muted-foreground">{file.name}</span>
          )}

          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            className="opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => save(files.filter((f) => f.path !== file.path))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && upload(e.target.files)}
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || !tableId}
        onClick={() => input.current?.click()}
        className={cn("h-6 shrink-0 px-1", files.length && "opacity-0 hover:opacity-100")}
        aria-label="Attach a file"
      >
        <Paperclip className="size-3" />
      </Button>
    </div>
  );
}

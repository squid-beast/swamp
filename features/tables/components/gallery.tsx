"use client";

import * as React from "react";
import { ImageOff } from "lucide-react";
import type { Field, Record_ } from "../types";

// Gallery: cards with a cover image.
//
// The old GalleryView was 55 lines and had NO interactions at all — no click, no
// open, not even an onUpdateCell prop. It was a picture of a gallery. Clicking a
// card now opens the expanded record, which is the only thing anyone ever wants
// to do with one.

export function Gallery({
  fields,
  hidden,
  records,
  coverField,
  onExpand,
}: {
  fields: Field[];
  hidden: Set<string>;
  records: Record_[];
  coverField?: Field;
  onExpand: (recordId: string) => void;
}) {
  const primary = fields.find((f) => f.isPrimary);
  const cardFields = fields
    .filter((f) => !hidden.has(f.id) && !f.isPrimary && f.id !== coverField?.id)
    .slice(0, 3);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3 overflow-auto p-3">
      {records.map((r) => {
        const src = coverField ? String(r.data[coverField.key] ?? "") : "";

        return (
          <button
            key={r.id}
            onClick={() => onExpand(r.id)}
            className="flex flex-col overflow-hidden rounded-lg border text-left transition-colors hover:border-brand/50"
          >
            <div className="flex aspect-[4/3] items-center justify-center bg-muted">
              {src ? (
                // A plain <img>, not next/image. These are arbitrary remote URLs
                // from imported data — the optimizer would need every domain
                // whitelisted up front, which is not knowable.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  className="size-full object-cover"
                  onError={(e) => {
                    // A broken image URL is normal in imported data. Fail quietly
                    // to the placeholder rather than showing a torn-page icon.
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <ImageOff className="size-5 text-muted-foreground/40" />
              )}
            </div>

            <div className="flex flex-col gap-0.5 p-2.5">
              <p className="truncate text-[13px] font-medium">
                {primary ? String(r.data[primary.key] ?? "") || "Untitled" : "Untitled"}
              </p>
              {cardFields.map((f) => {
                const v = r.data[f.key];
                if (v == null || v === "") return null;
                return (
                  <p key={f.id} className="truncate text-[12px] text-muted-foreground">
                    {Array.isArray(v) ? v.join(", ") : String(v)}
                  </p>
                );
              })}
            </div>
          </button>
        );
      })}

      {records.length === 0 && (
        <p className="col-span-full py-8 text-center text-[13px] text-muted-foreground">
          Nothing to show.
        </p>
      )}
    </div>
  );
}

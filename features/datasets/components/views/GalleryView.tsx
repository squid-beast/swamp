"use client";
import { FieldMeta, Row, ViewConfig } from "@/core/types";
import { Cell } from "../cells/Cell";
import { ExpandableText } from "../cells/ExpandableText";

export function GalleryView({ fields, rows, view }: { fields: FieldMeta[]; rows: Row[]; view: ViewConfig }) {
  const imageField = fields.find((f) => f.id === view.imageField) ?? fields.find((f) => f.type === "image");
  const titleField = fields.find((f) => f.id === view.titleField) ?? fields.find((f) => f.type === "text");
  const detailFields = fields.filter((f) => !f.hidden && f.id !== imageField?.id && f.id !== titleField?.id).slice(0, 3);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {rows.map((r) => (
        <div
          key={r.__id}
          className="group overflow-hidden rounded-xl border bg-card shadow-sm transition-colors hover:border-brand/40"
        >
          {imageField && r[imageField.id] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={String(r[imageField.id])}
              alt=""
              className="h-40 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center bg-muted">
              <span className="font-display text-3xl font-extrabold text-muted-foreground/50">
                {titleField ? String(r[titleField.id] ?? "?").charAt(0) : "?"}
              </span>
            </div>
          )}
          <div className="p-3">
            {titleField && (
              <ExpandableText
                text={String(r[titleField.id] ?? "Untitled")}
                label={titleField.displayName}
                lines={2}
                maxPreviewWidth="100%"
                previewClassName="text-[13.5px] font-semibold"
              />
            )}
            <div className="flex flex-col gap-1">
              {detailFields.map((f) => (
                <div key={f.id} className="min-w-0 text-[12px]">
                  <Cell field={f} value={r[f.id]} wrap />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

import { FieldMeta, ViewConfig } from "@/features/datasets/types";

// ── Rule-based view recommendation. Reads only metadata, never raw data. ──

let vc = 0;
const vid = () => `v_${Date.now().toString(36)}_${vc++}`;

export function recommendViews(fields: FieldMeta[]): ViewConfig[] {
  const views: ViewConfig[] = [];
  const status = fields.find((f) => f.type === "status") ?? fields.find((f) => f.type === "singleSelect");
  const image = fields.find((f) => f.type === "image");
  const title =
    fields.find((f) => /name|title|subject/i.test(f.sourceName) && f.type === "text") ??
    fields.find((f) => f.type === "text");
  const numeric = fields.filter((f) => f.type === "number" || f.type === "currency" || f.type === "percent");

  // Grid is always first
  views.push({ id: vid(), type: "grid", name: "Grid" });

  if (status)
    views.push({ id: vid(), type: "kanban", name: "Board", groupBy: status.id, titleField: title?.id });

  if (image)
    views.push({ id: vid(), type: "gallery", name: "Gallery", imageField: image.id, titleField: title?.id });

  if (numeric.length || status)
    views.push({ id: vid(), type: "dashboard", name: "Dashboard" });

  return views;
}

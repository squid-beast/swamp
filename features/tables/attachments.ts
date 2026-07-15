import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/shared/supabase/server";
import { getTable } from "./repo";
import type { Attachment, Field, Record_ } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Attachments.
//
// The file goes to Supabase Storage. The record holds a REFERENCE:
//
//     [{ id, name, size, mime, path }]
//
// and the URL is signed at read time. It is never stored, and that is the whole
// design. A stored URL is a permanent, unauthenticated link to a private file —
// it survives the record being deleted, the user being removed from the base, and
// the base being made private. Every "we found our customer data on Google" story
// starts with someone persisting a signed URL because it was easier.
//
// ── The upload is direct ──
//
// The browser uploads to Storage, not through us. A 50MB file routed through a
// route handler is 50MB of serverless memory and a request that times out. We hand
// out a short-lived signed upload URL for ONE path, and that is all we do.
//
// ── The path is the permission ──
//
//     <baseId>/<tableId>/<uuid>-<name>
//
// The storage policy reads the first segment and asks swamp_can(). That is why the
// server chooses the path and the client never does: a client-chosen path is a
// client-chosen base id.
// ════════════════════════════════════════════════════════════════════════════

const BUCKET = "attachments";

/** Signed URLs last an hour. Long enough to open a PDF, short enough that one
 *  copied out of a network tab is worthless by the time it's used. */
const READ_TTL = 3600;

/** Anything a filesystem, a URL, or a person could misread. Not security — the
 *  path is server-chosen and prefixed — just hygiene. */
function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 100) || "file";
}

export interface UploadTicket {
  path: string;
  signedUrl: string;
  token: string;
  attachment: Omit<Attachment, "url">;
}

/**
 * Hand out a one-file upload URL and remember that the file exists.
 *
 * The `file_references` row is written BEFORE the upload, not after. If we wrote
 * it after, an upload that succeeded while the client crashed would leave a file
 * in storage that nothing in the database has ever heard of — unreferenced,
 * unfindable, and paid for forever. Recorded first, it is at worst an orphan the
 * collector will find.
 */
export async function requestUpload(
  tableId: string,
  fieldId: string,
  name: string,
  size: number,
  mime: string
): Promise<UploadTicket> {
  const table = await getTable(tableId);
  if (!table) throw new Error("no such table");

  const db = createClient();
  const id = randomUUID();
  const path = `${table.baseId}/${tableId}/${id}-${safeName(name)}`;

  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`upload: ${error.message}`);

  const { error: refError } = await db.from("file_references").insert({
    base_id: table.baseId,
    table_id: tableId,
    field_id: fieldId,
    path,
    name,
    size,
    mime,
  });
  if (refError) throw new Error(`upload: ${refError.message}`);

  return {
    path,
    signedUrl: data.signedUrl,
    token: data.token,
    attachment: { id, name, size, mime, path },
  };
}

/**
 * Add a signed, expiring URL to every attachment on the way out.
 *
 * Batched: one call for the whole page. Signing per row would be one HTTP request
 * to Storage per file per render, and a 50-row page with three attachment columns
 * would make 150 of them before it drew anything.
 */
export async function signAttachments(
  fields: Field[],
  records: Record_[]
): Promise<Record_[]> {
  const keys = fields.filter((f) => f.type === "attachment").map((f) => f.key);
  if (!keys.length || !records.length) return records;

  const paths = new Set<string>();

  for (const record of records) {
    for (const key of keys) {
      const value = record.data[key];
      if (!Array.isArray(value)) continue;

      for (const item of value as Attachment[]) {
        if (item?.path) paths.add(item.path);
      }
    }
  }

  if (!paths.size) return records;

  const { data } = await createClient()
    .storage.from(BUCKET)
    .createSignedUrls([...paths], READ_TTL);

  const urls = new Map(
    (data ?? [])
      .filter((d) => d.signedUrl && d.path)
      .map((d) => [d.path as string, d.signedUrl])
  );

  return records.map((record) => {
    const next = { ...record.data };

    for (const key of keys) {
      const value = next[key];
      if (!Array.isArray(value)) continue;

      next[key] = (value as Attachment[]).map((item) =>
        // A file that has been deleted out from under the record renders without a
        // URL rather than breaking the row. The reference is stale; the row is not.
        item?.path && urls.has(item.path) ? { ...item, url: urls.get(item.path) } : item
      );
    }

    return { ...record, data: next };
  });
}

/**
 * Delete files nothing points at any more.
 *
 * The `records` trigger marks a file `orphaned_at` the moment the last record stops
 * referencing it. This deletes it — but not immediately. The grace period exists
 * because removing an attachment is undoable (⌘Z is right there), and because a
 * soft-deleted record can be restored. Delete the object at the moment of the
 * un-reference and undo silently loses the file: the cell comes back, the file
 * doesn't.
 */
export async function collectGarbage(
  db: SupabaseClient,
  graceHours = 24,
  limit = 500
): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - graceHours * 3_600_000).toISOString();

  const { data: orphans } = await db
    .from("file_references")
    .select("id, path")
    .not("orphaned_at", "is", null)
    .lt("orphaned_at", cutoff)
    .limit(limit);

  if (!orphans?.length) return { deleted: 0 };

  const paths = orphans.map((o) => o.path as string);
  const { error } = await db.storage.from(BUCKET).remove(paths);

  // Storage first, the row second. The other order can leave a file with no row —
  // an orphan nothing will ever look for again. This order can at worst leave a row
  // with no file, and the next run tries again and shrugs.
  if (error) throw new Error(`gc: ${error.message}`);

  await db
    .from("file_references")
    .delete()
    .in("id", orphans.map((o) => o.id as string));

  return { deleted: paths.length };
}

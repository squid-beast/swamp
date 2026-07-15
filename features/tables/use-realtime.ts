"use client";

import * as React from "react";
import { createClient } from "@/shared/supabase/client";
import type { Record_ } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Realtime: someone else's edit appears without a refresh.
//
// ── The echo problem, which is where these always go wrong ──
//
// You edit a cell. The grid updates optimistically. The PATCH lands. Postgres
// broadcasts the change. Your OWN subscription receives it and re-applies it.
//
// Mostly that's invisible — the value is the same. But it fights anything you've
// typed since, it re-renders the row under your cursor, and if you're mid-edit it
// yanks the value out from under you. The classic symptom is "the cell reverts
// while I'm typing in it" and it is maddening to diagnose, because it only happens
// when the round trip is slower than the next keystroke.
//
// So: every mutation carries a CLIENT ID, and the subscriber ignores events it
// caused. The id lives for the lifetime of the tab.
//
// Postgres doesn't give us a place to put one, so it rides in `data` under a
// reserved key that the server strips before storing... except it can't, cheaply.
// Instead we take the simpler route that actually works: track the ids of records
// WE just wrote, and skip the next event for each. A write we made is a write we
// already applied.
//
// ── What is NOT here ──
//
// Presence (who else is looking at this table) and per-cell cursors. Presence is
// cheap to add later; per-cell cursors are a different product.
// ════════════════════════════════════════════════════════════════════════════

interface Options {
  tableId: string;
  /** Merge a record the server says changed. */
  onUpsert: (record: Record_) => void;
  /** Drop a record the server says is gone. */
  onDelete: (id: string) => void;
  /** Something changed that we can't merge locally — refetch. */
  onReload: () => void;
  enabled?: boolean;
}

export function useRealtime({
  tableId,
  onUpsert,
  onDelete,
  onReload,
  enabled = true,
}: Options) {
  // Records this tab wrote, and whose echo we should therefore ignore. A Set, not
  // a boolean flag: several writes can be in flight at once.
  const mine = React.useRef(new Set<string>());

  const claim = React.useCallback((ids: string[]) => {
    for (const id of ids) mine.current.add(id);

    // Release after a beat. If the echo never arrives (the write failed, the
    // socket dropped), we must not ignore that record's changes forever.
    setTimeout(() => {
      for (const id of ids) mine.current.delete(id);
    }, 4000);
  }, []);

  React.useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`records:${tableId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "records",
          filter: `table_id=eq.${tableId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as {
            id: string;
            data: globalThis.Record<string, unknown>;
            sort_order: string;
            created_at: string;
            updated_at: string;
            created_by: string | null;
            updated_by: string | null;
            deleted_at: string | null;
          };

          if (!row?.id) return;

          // Our own echo. Already applied optimistically; re-applying it fights
          // whatever the user has typed since.
          if (mine.current.has(row.id)) {
            mine.current.delete(row.id);
            return;
          }

          if (payload.eventType === "DELETE" || row.deleted_at) {
            onDelete(row.id);
            return;
          }

          // An INSERT belongs at a position we can't know from the payload alone —
          // it depends on the view's sort and filter, which live on the server. So
          // a new row triggers a refetch rather than a guess about where to put it.
          if (payload.eventType === "INSERT") {
            onReload();
            return;
          }

          onUpsert({
            id: row.id,
            data: row.data ?? {},
            sortOrder: Number(row.sort_order),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            createdBy: row.created_by,
            updatedBy: row.updated_by,
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tableId, enabled, onUpsert, onDelete, onReload]);

  return { claim };
}

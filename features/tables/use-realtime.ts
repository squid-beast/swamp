"use client";

import * as React from "react";
import { createClient } from "@/shared/supabase/client";
import { PALETTE_HEX, type Record_ } from "./types";

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
// ── Presence ──
//
// The same channel also carries PRESENCE: who else has this table open. It rides
// on the socket we already authenticated and opened for postgres_changes, so it
// costs no extra connection — each tab `track()`s a tiny {userId, label} payload
// and everyone gets a `sync` when the roster changes. Per-cell cursors are a
// different, heavier product; this is just the avatars.
// ════════════════════════════════════════════════════════════════════════════

/** Someone else with this table open right now. */
export interface PresenceUser {
  userId: string;
  label: string;
  color: string;
}

// A stable colour per person, so the same collaborator is the same colour for
// everyone looking. Hash the id into the shared option palette.
const PRESENCE_COLORS = Object.values(PALETTE_HEX);
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

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
  // Everyone else with this table open. Excludes this tab's own user.
  const [presence, setPresence] = React.useState<PresenceUser[]>([]);
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

  // The callbacks are rebuilt on every parent render (they close over applyLocal).
  // If they were effect deps the subscription would tear down and re-open on every
  // render — dropping events in the gap and reconnecting the socket constantly. Refs
  // let the handler read the latest callback while the effect runs exactly once per
  // table.
  const cbs = React.useRef({ onUpsert, onDelete, onReload });
  cbs.current = { onUpsert, onDelete, onReload };

  React.useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | undefined;

    // Authenticate the socket BEFORE subscribing. postgres_changes is RLS-gated:
    // an anonymous socket receives zero events, which is exactly "collaborators'
    // edits never appear without a refresh". getSession() reads the JWT the client
    // hydrated from cookies; setAuth hands it to the realtime connection.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      const me = data.session?.user;
      const myId = me?.id ?? "";
      const myLabel = me?.email ?? "Someone";

      // Recompute the roster on every sync. Presence state is keyed by user id, so
      // two tabs from the same person collapse to one chip; we drop ourselves so the
      // bar reads "who ELSE is here".
      const syncPresence = () => {
        if (!channel) return;
        const state = channel.presenceState() as Record<
          string,
          { userId?: string; label?: string }[]
        >;
        const others: PresenceUser[] = [];
        for (const [key, metas] of Object.entries(state)) {
          const userId = metas[0]?.userId ?? key;
          if (userId === myId) continue;
          others.push({ userId, label: metas[0]?.label ?? "Someone", color: colorFor(userId) });
        }
        setPresence(others);
      };

      channel = supabase
        .channel(`records:${tableId}`, { config: { presence: { key: myId } } })
        .on("presence", { event: "sync" }, syncPresence)
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
            cbs.current.onDelete(row.id);
            return;
          }

          // An INSERT belongs at a position we can't know from the payload alone —
          // it depends on the view's sort and filter, which live on the server. So
          // a new row triggers a refetch rather than a guess about where to put it.
          if (payload.eventType === "INSERT") {
            cbs.current.onReload();
            return;
          }

          cbs.current.onUpsert({
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
        .subscribe((status) => {
          // Announce ourselves only once the socket is actually up — a track() before
          // SUBSCRIBED is dropped, and the roster would then be missing whoever
          // joined first.
          if (status === "SUBSCRIBED" && myId) {
            void channel?.track({ userId: myId, label: myLabel });
          }
        });
    })();

    // A token refresh (~hourly) issues a new JWT. Without re-arming the socket the
    // subscription keeps the old token and silently stops receiving events when it
    // expires.
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    return () => {
      cancelled = true;
      auth.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tableId, enabled]);

  return { claim, presence };
}

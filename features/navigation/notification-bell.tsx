"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { createClient } from "@/shared/supabase/client";

// The notification bell. Mentions land here live.
//
// Delivery is the SAME Supabase Realtime pattern the grid uses
// (features/tables/use-realtime.ts): authenticate the socket, subscribe to
// postgres_changes on `notifications` filtered to my rows — RLS scopes the
// subscription, so a user only ever receives their own. No polling endpoint,
// no interval to tune.

interface Notification {
  id: string;
  type: string;
  payload: {
    commentId?: string;
    recordId?: string;
    tableId?: string;
    snippet?: string;
  };
  read_at: string | null;
  created_at: string;
}

export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = React.useState<Notification[]>([]);
  const [open, setOpen] = React.useState(false);
  const supabase = React.useMemo(() => createClient(), []);

  React.useEffect(() => {
    let alive = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, type, payload, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (alive && data) setItems(data as Notification[]);
    };

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session || !alive) return;

      await load();

      // RLS-gated: authenticate the socket BEFORE subscribing.
      supabase.realtime.setAuth(session.access_token);
      channel = supabase
        .channel("notifications")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${session.user.id}`,
          },
          (msg) => setItems((prev) => [msg.new as Notification, ...prev].slice(0, 20))
        )
        .subscribe();
    })();

    return () => {
      alive = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase]);

  const unread = items.filter((n) => !n.read_at).length;

  const markAllRead = async () => {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    await supabase.from("notifications").update({ read_at: now }).in("id", ids);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void markAllRead();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8" aria-label="Notifications">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-brand text-[9px] font-semibold text-brand-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        {items.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            Nothing yet. Mentions land here.
          </p>
        )}
        {items.map((n) => (
          <button
            key={n.id}
            onClick={() => {
              setOpen(false);
              if (n.payload.tableId) {
                router.push(
                  `/app/t/${n.payload.tableId}${n.payload.recordId ? `?record=${n.payload.recordId}` : ""}`
                );
              }
            }}
            className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left hover:bg-muted/60"
          >
            <span className="text-[12px] font-medium">You were mentioned</span>
            {n.payload.snippet && (
              <span className="line-clamp-2 text-[12px] text-muted-foreground">
                {n.payload.snippet}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/70">
              {new Date(n.created_at).toLocaleString()}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

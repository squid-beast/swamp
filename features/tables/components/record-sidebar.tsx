"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Check,
  History,
  Loader2,
  MessageSquare,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { createClient } from "@/shared/supabase/client";
import type { AuditEntry, Comment } from "../collaboration";
import type { Field } from "../types";

// The right rail of the expanded record: Comments and History.
//
// Two tabs, because they answer two different questions — "what does the team think
// about this record" and "what actually happened to it". Merging them into one
// activity feed sounds tidy and makes both harder to read.

export function RecordSidebar({
  recordId,
  fields,
  currentUserId,
}: {
  recordId: string;
  fields: Field[];
  currentUserId: string;
}) {
  const [tab, setTab] = React.useState<"comments" | "history">("comments");

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l">
      <div className="flex border-b">
        {(
          [
            ["comments", MessageSquare, "Comments"],
            ["history", History, "History"],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 py-2 text-[13px]",
              tab === key
                ? "border-b-2 border-brand font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "comments" ? (
        <Comments recordId={recordId} currentUserId={currentUserId} />
      ) : (
        <HistoryList recordId={recordId} fields={fields} />
      )}
    </aside>
  );
}

// ─── Comments ───────────────────────────────────────────────────────────────

function Comments({
  recordId,
  currentUserId,
}: {
  recordId: string;
  currentUserId: string;
}) {
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/records/${recordId}/comments`);
    setLoading(false);
    if (!res.ok) return;
    setComments((await res.json()).comments as Comment[]);
  }, [recordId]);

  React.useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Someone else's comment appears without reopening the record.
  //
  // The realtime payload is the raw `comments` row and lacks the joined author
  // name, so rather than merge a half-built comment we just refetch — a thread has
  // a handful of comments, not thousands, and load() already resolves the name. Our
  // own post/edit/delete also refetch, so a self-echo is at worst one extra GET.
  React.useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | undefined;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel(`comments:${recordId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "comments",
            filter: `record_id=eq.${recordId}`,
          },
          () => void load()
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [recordId, load]);

  const post = async () => {
    if (!body.trim()) return;

    const res = await fetch(`/api/records/${recordId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: body.trim() }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // A 403 here means you're a VIEWER. The commenter role exists exactly so
      // someone can say "this looks wrong" without being able to change anything —
      // and a viewer is one rung below it.
      toast.error(
        res.status === 403
          ? "You need commenter access to post here."
          : (err?.error ?? "Could not post")
      );
      return;
    }

    setBody("");
    setComments((await res.json()).comments as Comment[]);
  };

  const patch = async (id: string, patch: object) => {
    const res = await fetch(`/api/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return toast.error("Could not update the comment");
    await load();
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Could not delete the comment");
    setComments((c) => c.filter((x) => x.id !== id));
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {loading && (
          <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
        )}

        {!loading && comments.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No comments yet.
          </p>
        )}

        {comments.map((c) => (
          <div
            key={c.id}
            className={cn("flex flex-col gap-1", c.resolvedAt && "opacity-50")}
            data-testid="comment"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium">{c.authorName}</span>
              <span className="text-[11px] text-muted-foreground">
                {new Date(c.createdAt).toLocaleString()}
              </span>
              {c.updatedAt !== c.createdAt && (
                <span className="text-[11px] text-muted-foreground">(edited)</span>
              )}

              <div className="ml-auto flex gap-0.5">
                <button
                  onClick={() => patch(c.id, { resolved: !c.resolvedAt })}
                  className="text-muted-foreground hover:text-foreground"
                  title={c.resolvedAt ? "Reopen" : "Resolve"}
                >
                  <Check className="size-3" />
                </button>

                {/* You may edit your OWN comment, and only your own. A thread where
                    other people can rewrite your words is not a thread. RLS enforces
                    it; this just doesn't offer what would fail. */}
                {c.authorId === currentUserId && (
                  <>
                    <button
                      onClick={() => {
                        setEditing(c.id);
                        setDraft(c.body);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      onClick={() => remove(c.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {editing === c.id ? (
              <div className="flex flex-col gap-1">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-[3rem] rounded-md border bg-transparent px-2 py-1.5 text-[13px] outline-none focus:border-brand"
                />
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-7"
                    onClick={async () => {
                      await patch(c.id, { body: draft });
                      setEditing(null);
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-[13px]">{stripMentions(c.body)}</p>
            )}

            {c.resolvedAt && (
              <span className="text-[11px] text-muted-foreground">Resolved</span>
            )}
          </div>
        ))}
      </div>

      <div className="border-t p-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // ⌘Enter posts. Plain Enter is a newline — a comment box that submits
            // on Enter eats every multi-line thought anyone tries to have.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void post();
            }
          }}
          placeholder="Add a comment… (⌘↵ to post)"
          className="min-h-[3.5rem] w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-[13px] outline-none focus:border-brand"
          data-testid="comment-input"
        />
        <Button size="sm" className="mt-1 w-full" onClick={post} disabled={!body.trim()}>
          Comment
        </Button>
      </div>
    </>
  );
}

/** `@[Alice](uuid)` renders as `@Alice`. The id is stored; the name is shown. */
function stripMentions(body: string): string {
  return body.replace(/@\[([^\]]*)\]\([0-9a-f-]{36}\)/gi, "@$1");
}

// ─── History ────────────────────────────────────────────────────────────────

function HistoryList({ recordId, fields }: { recordId: string; fields: Field[] }) {
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    void (async () => {
      const res = await fetch(`/api/records/${recordId}/history`);
      setLoading(false);
      if (!res.ok) return;
      setEntries((await res.json()).history as AuditEntry[]);
    })();
  }, [recordId]);

  const nameOf = (key: string) => fields.find((f) => f.key === key)?.name ?? key;

  const show = (v: unknown) => {
    if (v == null || v === "") return "empty";
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      {entries.length === 0 && (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          No history yet.
        </p>
      )}

      {entries.map((e) => (
        <div key={e.id} className="flex flex-col gap-1" data-testid="history-entry">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-medium">{e.actorName}</span>
            <span className="text-[12px] text-muted-foreground">
              {e.op === "create"
                ? "created this record"
                : e.op === "delete"
                  ? "deleted it"
                  : e.op === "restore"
                    ? "restored it"
                    : "made changes"}
            </span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {new Date(e.createdAt).toLocaleString()}
            </span>
          </div>

          {/* Field-level diffs, not "something changed". "Alice changed Status from
              Open to Won" is information; "Alice updated this record" is not. */}
          {e.op === "update" &&
            Object.entries(e.changes).map(([key, change]) => (
              <p key={key} className="pl-2 text-[12px] text-muted-foreground">
                <span className="text-foreground">{nameOf(key)}</span>{" "}
                <span className="line-through">{show(change.from)}</span>
                {" → "}
                <span className="text-foreground">{show(change.to)}</span>
              </p>
            ))}
        </div>
      ))}
    </div>
  );
}

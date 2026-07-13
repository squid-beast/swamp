"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Calendar,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { createClient } from "@/shared/supabase/client";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { RenameDialog } from "@/shared/components/rename-dialog";
import { TaskCardDialog, type CardDraft } from "./task-card-dialog";
import { ExpandableText } from "@/shared/ui/expandable-text";
import { cn } from "@/shared/lib/utils";

type Board = { id: string; name: string };
type Column = { id: string; name: string; position: number };
type Card = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: string | null;
  due_date: string | null;
  position: number;
};

const rid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const PRIORITY_COLOR: Record<string, string> = { high: "rose", medium: "amber", low: "sky" };

function dueMeta(due: string | null): { label: string; overdue: boolean } | null {
  if (!due) return null;
  const d = new Date(`${due}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    overdue: d.getTime() < today.getTime(),
  };
}

export function TaskBoard({ userId }: { userId: string }) {
  const supabase = React.useMemo(() => createClient(), []);

  const [boards, setBoards] = React.useState<Board[]>([]);
  const [boardId, setBoardId] = React.useState<string>("");
  const [columns, setColumns] = React.useState<Column[]>([]);
  const [cards, setCards] = React.useState<Card[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // dialogs
  const [cardDialog, setCardDialog] = React.useState<
    { mode: "create"; columnId: string } | { mode: "edit"; card: Card } | null
  >(null);
  const [renameBoardOpen, setRenameBoardOpen] = React.useState(false);
  const [deleteBoardOpen, setDeleteBoardOpen] = React.useState(false);
  const [renameCol, setRenameCol] = React.useState<Column | null>(null);
  const [deleteCol, setDeleteCol] = React.useState<Column | null>(null);

  // drag state
  const [dragCard, setDragCard] = React.useState<string | null>(null);
  const [overCol, setOverCol] = React.useState<string | null>(null);

  // A board just created locally: skip the reload fetch so an empty SELECT that
  // races ahead of the column INSERT can't wipe the seeded default columns.
  const justCreated = React.useRef<string | null>(null);

  const board = boards.find((b) => b.id === boardId) ?? null;

  // ── load boards once ──
  React.useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("task_boards")
        .select("id,name")
        .order("updated_at", { ascending: false });
      if (!active) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setBoards(data ?? []);
      setBoardId(data?.[0]?.id ?? "");
      if (!data?.length) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  // ── load columns + cards when the board changes ──
  React.useEffect(() => {
    if (!boardId) {
      setColumns([]);
      setCards([]);
      return;
    }
    if (justCreated.current === boardId) {
      // Freshly created board — state is already seeded; don't fetch (and don't
      // let an empty SELECT clobber the optimistic default columns).
      justCreated.current = null;
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      const [cols, cds] = await Promise.all([
        supabase.from("task_columns").select("id,name,position").eq("board_id", boardId).order("position"),
        supabase
          .from("task_cards")
          .select("id,column_id,title,description,priority,due_date,position")
          .eq("board_id", boardId)
          .order("position"),
      ]);
      if (!active) return;
      setLoading(false);
      if (cols.error || cds.error) {
        toast.error(cols.error?.message ?? cds.error?.message ?? "Could not load board");
        return;
      }
      setColumns((cols.data as Column[]) ?? []);
      setCards((cds.data as Card[]) ?? []);
    })();
    return () => {
      active = false;
    };
  }, [boardId, supabase]);

  const colCards = React.useCallback(
    (colId: string) => cards.filter((c) => c.column_id === colId).sort((a, b) => a.position - b.position),
    [cards]
  );

  // Every mutation is optimistic; on a write error we roll the UI back to the
  // pre-mutation snapshot so local state never silently diverges from the DB.

  // ── board CRUD ──
  const createBoard = async () => {
    const id = rid("b");
    const defs = ["To Do", "In Progress", "Done"].map((name, i) => ({
      id: rid("col"),
      board_id: id,
      owner_id: userId,
      name,
      position: i,
    }));
    const snap = { boards, boardId, columns, cards };
    const rollback = () => {
      justCreated.current = null;
      setBoards(snap.boards);
      setColumns(snap.columns);
      setCards(snap.cards);
      setBoardId(snap.boardId);
      setRenameBoardOpen(false);
    };
    justCreated.current = id;
    setBoards((b) => [{ id, name: "Untitled board" }, ...b]);
    setColumns(defs.map((c) => ({ id: c.id, name: c.name, position: c.position })));
    setCards([]);
    setBoardId(id);
    setRenameBoardOpen(true);

    const { error } = await supabase.from("task_boards").insert({ id, owner_id: userId, name: "Untitled board" });
    if (error) {
      rollback();
      return toast.error(error.message);
    }
    const { error: colErr } = await supabase.from("task_columns").insert(defs);
    if (colErr) {
      await supabase.from("task_boards").delete().eq("id", id);
      rollback();
      toast.error(colErr.message);
    }
  };

  const renameBoard = async (name: string) => {
    const snap = boards;
    setBoards((b) => b.map((x) => (x.id === boardId ? { ...x, name } : x)));
    const { error } = await supabase
      .from("task_boards")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", boardId);
    if (error) {
      setBoards(snap);
      toast.error(error.message);
    }
  };

  const removeBoard = async () => {
    const id = boardId;
    const snapBoards = boards;
    const snapId = boardId;
    setBoards(boards.filter((b) => b.id !== id));
    setBoardId(boards.filter((b) => b.id !== id)[0]?.id ?? "");
    const { error } = await supabase.from("task_boards").delete().eq("id", id); // cascades columns + cards
    if (error) {
      setBoards(snapBoards);
      setBoardId(snapId);
      toast.error(error.message);
    }
  };

  // ── column CRUD ──
  const addColumn = async () => {
    const maxPos = columns.reduce((m, c) => Math.max(m, c.position), -1);
    const col = { id: rid("col"), board_id: boardId, owner_id: userId, name: "New column", position: maxPos + 1 };
    const snap = columns;
    setColumns((c) => [...c, { id: col.id, name: col.name, position: col.position }]);
    const { error } = await supabase.from("task_columns").insert(col);
    if (error) {
      setColumns(snap);
      toast.error(error.message);
    }
  };

  const renameColumn = async (id: string, name: string) => {
    const snap = columns;
    setColumns((c) => c.map((x) => (x.id === id ? { ...x, name } : x)));
    const { error } = await supabase.from("task_columns").update({ name }).eq("id", id);
    if (error) {
      setColumns(snap);
      toast.error(error.message);
    }
  };

  const removeColumn = async (id: string) => {
    const snapCols = columns;
    const snapCards = cards;
    setColumns((c) => c.filter((x) => x.id !== id));
    setCards((c) => c.filter((x) => x.column_id !== id));
    const { error } = await supabase.from("task_columns").delete().eq("id", id); // cascades its cards
    if (error) {
      setColumns(snapCols);
      setCards(snapCards);
      toast.error(error.message);
    }
  };

  // ── card CRUD ──
  const saveCard = async (draft: CardDraft) => {
    const priority = draft.priority === "none" ? null : draft.priority;
    const due_date = draft.dueDate || null;
    if (cardDialog?.mode === "create") {
      const colId = cardDialog.columnId;
      const maxPos = colCards(colId).reduce((m, c) => Math.max(m, c.position), 0);
      const card: Card = {
        id: rid("card"),
        column_id: colId,
        title: draft.title,
        description: draft.description || null,
        priority,
        due_date,
        position: maxPos + 1,
      };
      const snap = cards;
      setCards((c) => [...c, card]);
      const { error } = await supabase.from("task_cards").insert({
        id: card.id,
        column_id: colId,
        board_id: boardId,
        owner_id: userId,
        title: card.title,
        description: card.description,
        priority,
        due_date,
        position: card.position,
      });
      if (error) {
        setCards(snap);
        toast.error(error.message);
      }
    } else if (cardDialog?.mode === "edit") {
      const id = cardDialog.card.id;
      const snap = cards;
      const patch = { title: draft.title, description: draft.description || null, priority, due_date };
      setCards((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      const { error } = await supabase
        .from("task_cards")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        setCards(snap);
        toast.error(error.message);
      }
    }
  };

  const removeCard = async (id: string) => {
    const snap = cards;
    setCards((c) => c.filter((x) => x.id !== id));
    const { error } = await supabase.from("task_cards").delete().eq("id", id);
    if (error) {
      setCards(snap);
      toast.error(error.message);
    }
  };

  // ── drag: move a card to a column, optionally before a specific card ──
  const moveCard = async (cardId: string, targetColId: string, beforeCardId: string | null) => {
    const moving = cards.find((c) => c.id === cardId);
    if (!moving) return;
    const target = colCards(targetColId).filter((c) => c.id !== cardId);
    let position: number;
    if (!beforeCardId) {
      position = (target[target.length - 1]?.position ?? 0) + 1;
    } else {
      const idx = target.findIndex((c) => c.id === beforeCardId);
      if (idx === -1) position = (target[target.length - 1]?.position ?? 0) + 1;
      else {
        const before = target[idx];
        const prev = target[idx - 1];
        position = prev ? (prev.position + before.position) / 2 : before.position - 1;
      }
    }
    if (moving.column_id === targetColId && moving.position === position) return;
    const snap = { column_id: moving.column_id, position: moving.position };
    setCards((c) => c.map((x) => (x.id === cardId ? { ...x, column_id: targetColId, position } : x)));
    const { error } = await supabase
      .from("task_cards")
      .update({ column_id: targetColId, position, updated_at: new Date().toISOString() })
      .eq("id", cardId);
    if (error) {
      setCards((c) => c.map((x) => (x.id === cardId ? { ...x, ...snap } : x)));
      toast.error(error.message);
    }
  };

  // ── render ──
  if (error) {
    return (
      <div className="rise flex flex-col gap-4 p-4 md:p-6">
        <h1 className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">Kanban Board</h1>
        <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
          Couldn&rsquo;t load your boards: <span className="text-destructive">{error}</span>
          <div className="mt-2">
            If this is the first run, apply <code className="font-mono-data text-xs">supabase/migrations/0003_boards.sql</code> in the Supabase SQL editor.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rise flex min-w-0 flex-col gap-4 p-4 md:p-6">
      {/* board bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">Kanban Board</h1>
          {boards.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 max-w-[220px] gap-1.5">
                  <span className="truncate">{board?.name ?? "Select board"}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Boards</DropdownMenuLabel>
                {boards.map((b) => (
                  <DropdownMenuItem key={b.id} onSelect={() => setBoardId(b.id)}>
                    <span className="truncate">{b.name}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={createBoard}>
                  <Plus className="text-muted-foreground" />
                  New board
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {board && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem onSelect={() => setRenameBoardOpen(true)}>
                  <Pencil className="text-muted-foreground" />
                  Rename board
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleteBoardOpen(true)}
                >
                  <Trash2 className="text-destructive" />
                  Delete board
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={createBoard}>
          <Plus className="size-3.5" />
          New board
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : boards.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">No boards yet. Create one to start tracking tasks.</p>
          <Button className="mt-3 gap-1.5" onClick={createBoard}>
            <Plus className="size-4" />
            New board
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 items-start gap-4 overflow-x-auto pb-4">
          {columns.map((col) => {
            const list = colCards(col.id);
            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  if (!dragCard) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOverCol(col.id);
                }}
                onDragLeave={() => setOverCol((o) => (o === col.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragCard;
                  setOverCol(null);
                  setDragCard(null);
                  if (id) moveCard(id, col.id, null);
                }}
                className={cn(
                  "flex w-[300px] shrink-0 flex-col rounded-xl border bg-muted/40 transition-shadow",
                  overCol === col.id && "ring-2 ring-brand/60"
                )}
              >
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[12px] font-bold uppercase tracking-wide text-foreground">
                      {col.name}
                    </span>
                    <span className="font-mono-data text-[11px] text-muted-foreground">{list.length}</span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-6 text-muted-foreground">
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem onSelect={() => setRenameCol(col)}>
                        <Pencil className="text-muted-foreground" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setDeleteCol(col)}
                      >
                        <Trash2 className="text-destructive" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex max-h-[calc(100vh-15rem)] flex-col gap-2 overflow-y-auto p-2 pt-0">
                  {list.map((card) => {
                    const due = dueMeta(card.due_date);
                    return (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", card.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragCard(card.id);
                        }}
                        onDragEnd={() => {
                          setDragCard(null);
                          setOverCol(null);
                        }}
                        onDragOver={(e) => {
                          if (dragCard && dragCard !== card.id) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          if (!dragCard) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const id = e.dataTransfer.getData("text/plain") || dragCard;
                          setOverCol(null);
                          setDragCard(null);
                          if (id && id !== card.id) moveCard(id, col.id, card.id);
                        }}
                        onClick={() => setCardDialog({ mode: "edit", card })}
                        className="group cursor-grab rounded-lg border bg-card p-2.5 shadow-sm transition-colors hover:border-brand/40 active:cursor-grabbing"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="break-words text-[13px] font-medium leading-snug">{card.title}</div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                              >
                                <MoreHorizontal className="size-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-32" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuItem onSelect={() => setCardDialog({ mode: "edit", card })}>
                                <Pencil className="text-muted-foreground" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => removeCard(card.id)}
                              >
                                <Trash2 className="text-destructive" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        {card.description && (
                          <ExpandableText
                            text={card.description}
                            label="Description"
                            lines={2}
                            maxPreviewWidth="100%"
                            previewClassName="text-[12px] text-muted-foreground"
                            className="mt-1"
                          />
                        )}

                        {(card.priority || due) && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {card.priority && (
                              <span
                                className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase"
                                style={{
                                  color: `var(--c-${PRIORITY_COLOR[card.priority] ?? "sky"}-fg)`,
                                  background: `var(--c-${PRIORITY_COLOR[card.priority] ?? "sky"}-bg)`,
                                }}
                              >
                                {card.priority}
                              </span>
                            )}
                            {due && (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono-data text-[10.5px]",
                                  due.overdue ? "text-destructive" : "text-muted-foreground"
                                )}
                              >
                                <Calendar className="size-3" />
                                {due.label}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <button
                    onClick={() => setCardDialog({ mode: "create", columnId: col.id })}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                    Add task
                  </button>
                </div>
              </div>
            );
          })}

          <Button
            variant="outline"
            className="h-10 w-[220px] shrink-0 justify-start gap-1.5 border-dashed text-muted-foreground"
            onClick={addColumn}
          >
            <Plus className="size-4" />
            Add column
          </Button>
        </div>
      )}

      {/* dialogs */}
      <TaskCardDialog
        open={cardDialog !== null}
        onOpenChange={(o) => !o && setCardDialog(null)}
        mode={cardDialog?.mode ?? "create"}
        initial={
          cardDialog?.mode === "edit"
            ? {
                title: cardDialog.card.title,
                description: cardDialog.card.description ?? "",
                priority: cardDialog.card.priority ?? "none",
                dueDate: cardDialog.card.due_date ?? "",
              }
            : undefined
        }
        onSave={saveCard}
      />

      <RenameDialog
        open={renameBoardOpen}
        onOpenChange={setRenameBoardOpen}
        title="Rename board"
        initialName={board?.name ?? ""}
        onSave={renameBoard}
      />
      <ConfirmDialog
        open={deleteBoardOpen}
        onOpenChange={setDeleteBoardOpen}
        title={board ? `Delete “${board.name}”?` : ""}
        description="This permanently removes the board and all of its columns and tasks."
        confirmLabel="Delete"
        onConfirm={() => {
          setDeleteBoardOpen(false);
          removeBoard();
        }}
      />
      <RenameDialog
        open={renameCol !== null}
        onOpenChange={(o) => !o && setRenameCol(null)}
        title="Rename column"
        initialName={renameCol?.name ?? ""}
        onSave={(name) => {
          if (renameCol) renameColumn(renameCol.id, name);
        }}
      />
      <ConfirmDialog
        open={deleteCol !== null}
        onOpenChange={(o) => !o && setDeleteCol(null)}
        title={deleteCol ? `Delete “${deleteCol.name}”?` : ""}
        description="This permanently removes the column and every task in it."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteCol) removeColumn(deleteCol.id);
          setDeleteCol(null);
        }}
      />
    </div>
  );
}

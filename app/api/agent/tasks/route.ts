// ── /api/agent/tasks — Claude writes the daily plan onto a real task board. ──
// POST { tasks: [{title, description?, priority?, due_date?, column?}] }
//   → cards on the "AI Daily Plan" board (columns: Today / In Progress / Done),
//     created on first use. Renders in the existing board UI untouched.
// GET → board + columns + cards so the agent can read state back.

import { NextRequest, NextResponse } from "next/server";
import { agentDenied, agentOwnerId, jsonError, serviceDb, slugKey } from "@/lib/agent/service";

export const dynamic = "force-dynamic";

const BOARD_NAME = "AI Daily Plan";
const COLUMNS = ["Today", "In Progress", "Done"];

async function ensureBoard(db: ReturnType<typeof serviceDb>, ownerId: string) {
  const { data: board, error } = await db
    .from("task_boards")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", BOARD_NAME)
    .maybeSingle();
  if (error) throw error;

  let boardId = board?.id as string | undefined;
  if (!boardId) {
    boardId = `b_agent_${Math.random().toString(36).slice(2, 7)}`;
    const { error: bErr } = await db
      .from("task_boards")
      .insert({ id: boardId, owner_id: ownerId, name: BOARD_NAME });
    if (bErr) throw bErr;
  }

  const { data: cols, error: cErr } = await db
    .from("task_columns")
    .select("id,name,position")
    .eq("board_id", boardId)
    .order("position", { ascending: true });
  if (cErr) throw cErr;

  const byName = new Map((cols ?? []).map((c) => [c.name as string, c.id as string]));
  let pos = (cols ?? []).length;
  for (const name of COLUMNS) {
    if (!byName.has(name)) {
      const id = `c_agent_${slugKey(name)}_${Math.random().toString(36).slice(2, 5)}`;
      const { error: insErr } = await db
        .from("task_columns")
        .insert({ id, board_id: boardId, owner_id: ownerId, name, position: pos++ });
      if (insErr) throw insErr;
      byName.set(name, id);
    }
  }
  return { boardId, columns: byName };
}

export async function GET(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const { boardId } = await ensureBoard(db, ownerId);
    const { data: columns } = await db
      .from("task_columns")
      .select("id,name,position")
      .eq("board_id", boardId)
      .order("position", { ascending: true });
    const { data: cards } = await db
      .from("task_cards")
      .select("id,column_id,title,description,priority,due_date,position,updated_at")
      .eq("board_id", boardId)
      .order("position", { ascending: true });
    return NextResponse.json({ boardId, columns: columns ?? [], cards: cards ?? [] });
  } catch (e) {
    return jsonError(e);
  }
}

type TaskIn = {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  due_date?: string; // YYYY-MM-DD
  column?: string; // defaults to "Today"
};

export async function POST(req: NextRequest) {
  const denied = agentDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { tasks?: TaskIn[] };
    const tasks = body.tasks ?? [];
    if (!tasks.length || tasks.some((t) => !t.title)) {
      return NextResponse.json({ error: "tasks[] with title required" }, { status: 400 });
    }
    const db = serviceDb();
    const ownerId = await agentOwnerId(db);
    const { boardId, columns } = await ensureBoard(db, ownerId);

    const { data: maxCard } = await db
      .from("task_cards")
      .select("position")
      .eq("board_id", boardId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    let pos = (maxCard?.position ?? 0) + 1;

    let created = 0;
    let skipped = 0;
    for (const t of tasks) {
      const columnId = columns.get(t.column ?? "Today") ?? columns.get("Today")!;
      const cardId = `t_${slugKey(t.title)}_${(t.due_date ?? "").replace(/-/g, "")}`;
      const { data: dup } = await db
        .from("task_cards")
        .select("id")
        .eq("id", cardId)
        .maybeSingle();
      if (dup) {
        skipped++; // same task for the same day already exists — idempotent
        continue;
      }
      const { error } = await db.from("task_cards").insert({
        id: cardId,
        column_id: columnId,
        board_id: boardId,
        owner_id: ownerId,
        title: t.title,
        description: t.description ?? null,
        priority: t.priority ?? null,
        due_date: t.due_date ?? null,
        position: pos++,
      });
      if (error) throw error;
      created++;
    }
    return NextResponse.json({ boardId, created, skipped });
  } catch (e) {
    return jsonError(e);
  }
}

import "server-only";
import { createClient } from "@/shared/supabase/server";
import type { Role } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Comments, record history, and members.
// ════════════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;

function db() {
  return createClient();
}

// ─── Comments ───────────────────────────────────────────────────────────────

export interface Comment {
  id: string;
  recordId: string;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pull @mentions out of the body.
 *
 * The body stores `@[Name](uuid)` — the id, not the name. Same reason formulas
 * store field ids: a person can change their display name, and a mention that
 * stops resolving because someone got married is a bad mention.
 */
export function extractMentions(body: string): string[] {
  const ids = new Set<string>();
  const re = /@\[[^\]]*\]\(([0-9a-f-]{36})\)/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) ids.add(m[1]);

  return [...ids];
}

export async function listComments(recordId: string): Promise<Comment[]> {
  const { data, error } = await db()
    .from("comments")
    .select("id, record_id, author_id, body, mentions, resolved_by, resolved_at, created_at, updated_at")
    .eq("record_id", recordId)
    .order("created_at");

  if (error) throw new Error(`listComments: ${error.message}`);
  if (!data?.length) return [];

  // Names come from `profiles`, and a comment whose author has been deleted still
  // has to render — hence the fallback rather than a join that would drop the row.
  const authorIds = [...new Set(data.map((c) => c.author_id as string))];
  const { data: profiles } = await db()
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", authorIds);

  const names = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      [p.first_name, p.last_name].filter(Boolean).join(" ") || "Someone",
    ])
  );

  return data.map((c: Row) => ({
    id: c.id as string,
    recordId: c.record_id as string,
    authorId: c.author_id as string,
    authorName: names.get(c.author_id as string) ?? "Someone",
    body: c.body as string,
    mentions: (c.mentions as string[]) ?? [],
    resolvedBy: (c.resolved_by as string) ?? null,
    resolvedAt: (c.resolved_at as string) ?? null,
    createdAt: c.created_at as string,
    updatedAt: c.updated_at as string,
  }));
}

export async function addComment(
  baseId: string,
  tableId: string,
  recordId: string,
  authorId: string,
  body: string
): Promise<void> {
  const { error } = await db().from("comments").insert({
    base_id: baseId,
    table_id: tableId,
    record_id: recordId,
    author_id: authorId,
    body,
    mentions: extractMentions(body),
  });

  if (error) throw new Error(`addComment: ${error.message}`);
}

export async function updateComment(id: string, body: string): Promise<void> {
  const { error } = await db()
    .from("comments")
    .update({ body, mentions: extractMentions(body) })
    .eq("id", id);

  if (error) throw new Error(`updateComment: ${error.message}`);
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await db().from("comments").delete().eq("id", id);
  if (error) throw new Error(`deleteComment: ${error.message}`);
}

export async function resolveComment(id: string, resolved: boolean, userId: string): Promise<void> {
  const { error } = await db()
    .from("comments")
    .update(
      resolved
        ? { resolved_by: userId, resolved_at: new Date().toISOString() }
        : { resolved_by: null, resolved_at: null }
    )
    .eq("id", id);

  if (error) throw new Error(`resolveComment: ${error.message}`);
}

// ─── History ────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  op: "create" | "update" | "delete" | "restore";
  actorId: string | null;
  actorName: string;
  /** { fieldKey: { from, to } } — only what actually changed. */
  changes: Record<string, { from: unknown; to: unknown }>;
  createdAt: string;
}

export async function listHistory(recordId: string, limit = 50): Promise<AuditEntry[]> {
  const { data, error } = await db()
    .from("record_audit")
    .select("id, op, actor_id, changes, created_at")
    .eq("record_id", recordId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listHistory: ${error.message}`);
  if (!data?.length) return [];

  const actorIds = [...new Set(data.map((e) => e.actor_id).filter(Boolean))] as string[];
  const { data: profiles } = await db()
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", actorIds.length ? actorIds : ["00000000-0000-0000-0000-000000000000"]);

  const names = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      [p.first_name, p.last_name].filter(Boolean).join(" ") || "Someone",
    ])
  );

  return data.map((e: Row) => ({
    id: e.id as string,
    op: e.op as AuditEntry["op"],
    actorId: (e.actor_id as string) ?? null,
    // A row with no actor is an import, a cron, or a form submission from a
    // stranger. "System" is honest; blank is confusing.
    actorName: e.actor_id ? (names.get(e.actor_id as string) ?? "Someone") : "System",
    changes: (e.changes as AuditEntry["changes"]) ?? {},
    createdAt: e.created_at as string,
  }));
}

// ─── Members & invites ──────────────────────────────────────────────────────

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  /** True when the role comes from the workspace rather than this base. */
  inherited: boolean;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  token: string;
  createdAt: string;
}

export async function listMembers(baseId: string): Promise<Member[]> {
  const [{ data: baseRows }, { data: base }] = await Promise.all([
    db().from("base_members").select("user_id, role").eq("base_id", baseId),
    db().from("bases").select("workspace_id").eq("id", baseId).single(),
  ]);

  const { data: wsRows } = await db()
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", base!.workspace_id);

  // A per-base role OVERRIDES the workspace role. Show both, and say which is
  // which — "why can Bob edit this?" is a question people ask, and "he's an editor
  // on the workspace" is the answer.
  const byUser = new Map<string, { role: Role; inherited: boolean }>();

  for (const r of wsRows ?? []) {
    byUser.set(r.user_id as string, { role: r.role as Role, inherited: true });
  }
  for (const r of baseRows ?? []) {
    byUser.set(r.user_id as string, { role: r.role as Role, inherited: false });
  }

  const ids = [...byUser.keys()];
  if (!ids.length) return [];

  const { data: profiles } = await db()
    .from("profiles")
    .select("id, first_name, last_name, email")
    .in("id", ids);

  return (profiles ?? []).map((p) => {
    const entry = byUser.get(p.id as string)!;
    return {
      userId: p.id as string,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Someone",
      email: (p.email as string) ?? "",
      role: entry.role,
      inherited: entry.inherited,
    };
  });
}

export async function listInvites(baseId: string): Promise<Invite[]> {
  const { data, error } = await db()
    .from("base_invites")
    .select("id, email, role, token, created_at")
    .eq("base_id", baseId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listInvites: ${error.message}`);

  return (data ?? []).map((r: Row) => ({
    id: r.id as string,
    email: r.email as string,
    role: r.role as Role,
    token: r.token as string,
    createdAt: r.created_at as string,
  }));
}

export async function inviteToBase(
  baseId: string,
  email: string,
  role: Role,
  invitedBy: string
): Promise<Invite> {
  const { data, error } = await db()
    .from("base_invites")
    .upsert(
      {
        base_id: baseId,
        email: email.toLowerCase().trim(),
        role,
        invited_by: invitedBy,
        // Re-inviting someone replaces the old invite rather than stacking a
        // second one — otherwise the first token stays live forever.
        accepted_at: null,
        accepted_by: null,
      },
      { onConflict: "base_id,email" }
    )
    .select("id, email, role, token, created_at")
    .single();

  if (error) throw new Error(`inviteToBase: ${error.message}`);

  return {
    id: data.id,
    email: data.email,
    role: data.role,
    token: data.token,
    createdAt: data.created_at,
  };
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await db().from("base_invites").delete().eq("id", id);
  if (error) throw new Error(`revokeInvite: ${error.message}`);
}

export async function setMemberRole(
  baseId: string,
  userId: string,
  role: Role
): Promise<void> {
  const { error } = await db()
    .from("base_members")
    .upsert({ base_id: baseId, user_id: userId, role }, { onConflict: "base_id,user_id" });

  if (error) throw new Error(`setMemberRole: ${error.message}`);
}

export async function removeMember(baseId: string, userId: string): Promise<void> {
  const { error } = await db()
    .from("base_members")
    .delete()
    .eq("base_id", baseId)
    .eq("user_id", userId);

  if (error) throw new Error(`removeMember: ${error.message}`);
}

export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await db().rpc("swamp_accept_invite", { p_token: token });
  if (error) throw new Error(error.message);
  return data as string;
}

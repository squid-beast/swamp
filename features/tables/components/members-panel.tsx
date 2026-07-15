"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Mail, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import type { Invite, Member } from "../collaboration";
import type { Role } from "../types";

// Who's in this base, and who's been asked.
//
// The role descriptions are not decoration. "Why can Bob edit this?" is a question
// people ask, and a dropdown of bare words doesn't answer it.

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "viewer", label: "Viewer", hint: "Can read records and comments." },
  { value: "commenter", label: "Commenter", hint: "Can also comment." },
  { value: "editor", label: "Editor", hint: "Can also edit records and views." },
  // The load-bearing line in the whole permission model. Editors change DATA and
  // VIEWS; creators change SCHEMA. Worth spelling out here, because it's the one
  // people get wrong when they hand out access.
  { value: "creator", label: "Creator", hint: "Can also change tables and fields." },
  { value: "owner", label: "Owner", hint: "Can also delete the base." },
];

export function MembersPanel({
  baseId,
  baseName,
  members: initialMembers,
  invites: initialInvites,
  currentUserId,
}: {
  baseId: string;
  baseName: string;
  members: Member[];
  invites: Invite[];
  currentUserId: string;
}) {
  const [members, setMembers] = React.useState(initialMembers);
  const [invites, setInvites] = React.useState(initialInvites);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("editor");
  const [busy, setBusy] = React.useState(false);

  const reload = async () => {
    const res = await fetch(`/api/bases/${baseId}/members`);
    if (!res.ok) return;
    const body = await res.json();
    setMembers(body.members as Member[]);
    setInvites(body.invites as Invite[]);
  };

  const invite = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);

    const res = await fetch(`/api/bases/${baseId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role }),
    });

    setBusy(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // The policy refuses an invite at a role above your own — otherwise an editor
      // invites themselves back as an owner from a second address.
      toast.error(err?.error ?? "Could not send the invite");
      return;
    }

    setEmail("");
    await reload();
    toast.success("Invite created — copy the link and send it to them.");
  };

  const changeRole = async (userId: string, next: Role) => {
    const res = await fetch(`/api/bases/${baseId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: next }),
    });

    if (!res.ok) return toast.error("Could not change the role");
    await reload();
  };

  const remove = async (userId: string) => {
    const res = await fetch(`/api/bases/${baseId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    if (!res.ok) return toast.error("Could not remove them");
    await reload();
  };

  const revoke = async (id: string) => {
    // Deleting the row kills the token. There's no "expired" state to reason
    // about — the invite either exists or it doesn't.
    const res = await fetch(`/api/invites/${id}`, { method: "DELETE" });

    if (!res.ok) return toast.error("Could not revoke the invite");
    setInvites((i) => i.filter((x) => x.id !== id));
  };

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">
        {baseName} — people
      </h1>

      <section className="mt-6 flex flex-col gap-2 rounded-xl border p-4">
        <Label className="text-[12px] text-muted-foreground">Invite someone</Label>

        <div className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && invite()}
            placeholder="name@company.com"
            className="flex-1"
          />

          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={invite} disabled={!email.trim() || busy} className="gap-1.5">
            <Mail className="size-3.5" />
            Invite
          </Button>
        </div>

        <p className="text-[12px] text-muted-foreground">
          {ROLES.find((r) => r.value === role)?.hint}
        </p>
      </section>

      {invites.length > 0 && (
        <section className="mt-4 flex flex-col gap-2">
          <h2 className="text-[13px] font-medium">Pending invites</h2>

          {invites.map((i) => (
            <div
              key={i.id}
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
              data-testid="invite"
            >
              <span className="truncate text-[13px]">{i.email}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {i.role}
              </span>

              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 gap-1.5 text-[12px]"
                onClick={() => {
                  const url = `${window.location.origin}/invite/${i.token}`;
                  void navigator.clipboard.writeText(url);
                  toast.success("Invite link copied");
                }}
              >
                <Copy className="size-3" />
                Copy link
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-destructive"
                onClick={() => revoke(i.id)}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}

          <p className="text-[12px] text-muted-foreground">
            {/* The token alone isn't enough — accepting checks that the signed-in
                user's email matches the address the invite was sent to. Forwarding
                the link doesn't get anyone in. */}
            An invite link only works for the address it was sent to.
          </p>
        </section>
      )}

      <section className="mt-6 flex flex-col gap-2">
        <h2 className="text-[13px] font-medium">Members</h2>

        {members.map((m) => (
          <div
            key={m.userId}
            className="flex items-center gap-2 rounded-lg border px-3 py-2"
            data-testid="member"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium">
                {m.name}
                {m.userId === currentUserId && (
                  <span className="ml-1 text-[11px] text-muted-foreground">(you)</span>
                )}
              </span>
              <span className="truncate text-[12px] text-muted-foreground">{m.email}</span>
            </div>

            {m.inherited && (
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                title="This role comes from the workspace, not from this base."
              >
                from workspace
              </span>
            )}

            <Select
              value={m.role}
              onValueChange={(v) => changeRole(m.userId, v as Role)}
            >
              <SelectTrigger className="ml-auto h-8 w-32 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-destructive"
              disabled={m.userId === currentUserId}
              onClick={() => remove(m.userId)}
              aria-label={`Remove ${m.name}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </section>
    </main>
  );
}

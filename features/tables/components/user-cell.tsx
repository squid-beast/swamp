"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { initialsFromName } from "@/shared/lib/format";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import type { Field } from "../types";

// ════════════════════════════════════════════════════════════════════════════
// People in a cell.
//
// Three field types land here, because they are all the same problem — a uuid
// that has to become a name:
//
//   user        writable; one person, or several if options.allowMultiple
//   createdBy   read-only, stamped by the database
//   modifiedBy  read-only, stamped by the database
//
// The uuid is what's stored, and that is deliberate: a person can change their
// display name, and a cell that stored "Ada Lovelace" would quietly rot the day
// she married. Same reason formulas store field ids and the REST envelope keys by
// field key.
//
// ── Why the roster is fetched, and cached per base ──
//
// A name is not in `record.data` — only the id is. Resolving it needs the base's
// roster, and a grid can easily have 500 user cells on screen, so a fetch per cell
// is a non-starter. One in-flight promise per base, shared by every cell, and the
// roster of a base is small and changes rarely.
//
// Note this cache is module-level and lives for the tab's lifetime. That is right
// for a roster and wrong for almost anything else; if you add someone to the base,
// their name appears on the next full load. The alternative — revalidating per
// render — costs a request per grid scroll to fix a staleness nobody has noticed.
// ════════════════════════════════════════════════════════════════════════════

export interface RosterEntry {
  userId: string;
  name: string;
  email: string;
}

const rosters = new Map<string, Promise<Map<string, RosterEntry>>>();

function rosterOf(baseId: string): Promise<Map<string, RosterEntry>> {
  let p = rosters.get(baseId);
  if (!p) {
    p = fetch(`/api/bases/${baseId}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then(
        (body: { members?: RosterEntry[] }) =>
          new Map((body.members ?? []).map((m) => [m.userId, m]))
      )
      .catch((e) => {
        // Don't cache a failure forever — a network blip would otherwise leave
        // every user cell in this base blank until the tab is reloaded.
        rosters.delete(baseId);
        throw e;
      });
    rosters.set(baseId, p);
  }
  return p;
}

/** Exported so a test, or a members panel that just changed the roster, can force
 *  the next cell to re-read it. */
export function forgetRoster(baseId?: string) {
  if (baseId) rosters.delete(baseId);
  else rosters.clear();
}

function useRoster(baseId: string) {
  const [roster, setRoster] = React.useState<Map<string, RosterEntry> | null>(null);

  React.useEffect(() => {
    let alive = true;
    rosterOf(baseId)
      .then((r) => alive && setRoster(r))
      .catch(() => alive && setRoster(new Map()));
    return () => {
      alive = false;
    };
  }, [baseId]);

  return roster;
}

/** The ids in a cell. `user` may hold an array; createdBy/modifiedBy never do. */
function idsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" && value ? [value] : [];
}

function Person({ entry, id }: { entry?: RosterEntry; id: string }) {
  // A uuid that isn't in the roster is a real case, not a bug: the person was
  // removed from the base, or deleted their account, and the record they touched
  // still has to render. Show that someone did it rather than a raw uuid, which
  // means nothing to anyone.
  const name = entry?.name ?? "Someone";
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={entry?.email ?? id}>
      <Avatar className="size-4 shrink-0">
        <AvatarFallback className="text-[8px]">{initialsFromName(name)}</AvatarFallback>
      </Avatar>
      <span className="truncate text-[13px]">{name}</span>
    </span>
  );
}

export function UserCell({
  field,
  value,
  onChange,
  editable = false,
}: {
  field: Field;
  value: unknown;
  onChange?: (next: unknown) => void;
  /** createdBy/modifiedBy are stamped by the database and never editable. */
  editable?: boolean;
}) {
  const roster = useRoster(field.baseId);
  const ids = idsOf(value);
  const multiple = !!field.options.allowMultiple;

  const body =
    ids.length === 0 ? (
      <Minus className="size-3.5 text-muted-foreground/30" />
    ) : (
      <span className="flex min-w-0 items-center gap-2">
        {ids.map((id) => (
          <Person key={id} id={id} entry={roster?.get(id)} />
        ))}
      </span>
    );

  if (!editable || !onChange) return body;

  const toggle = (id: string) => {
    if (!multiple) {
      onChange(ids[0] === id ? null : id);
      return;
    }
    onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full min-w-0 items-center text-left outline-none">
        {body}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto">
        {[...(roster?.values() ?? [])].map((m) => (
          <DropdownMenuItem key={m.userId} onSelect={() => toggle(m.userId)}>
            <Check
              className={cn(
                "mr-2 size-3.5",
                ids.includes(m.userId) ? "opacity-100" : "opacity-0"
              )}
            />
            <Person entry={m} id={m.userId} />
          </DropdownMenuItem>
        ))}
        {!roster?.size && (
          <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No members</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

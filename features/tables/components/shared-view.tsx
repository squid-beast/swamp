"use client";

import * as React from "react";
import { Download, Loader2, Lock, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";
import type { SharedMeta } from "../sharing";
import type { Cursor, Record_ } from "../types";
import { CellView } from "./cell";
import { FormRuntime } from "./form-runtime";
import { Gallery } from "./gallery";

// The public face of a shared view.
//
// Read-only, always. A visitor can search and page; they cannot edit, and there is
// no code path here that could — every cell is rendered with a no-op onChange, and
// the server wouldn't accept the write anyway (anon has no grant on `records`).
//
// The one exception is a FORM, which is the only public write in the product.

export function SharedView({
  shareId,
  meta,
  password,
}: {
  shareId: string;
  meta: SharedMeta;
  password?: string;
}) {
  if (meta.view.type === "form") {
    return <FormRuntime shareId={shareId} meta={meta} password={password} />;
  }
  return <SharedRecords shareId={shareId} meta={meta} password={password} />;
}

function SharedRecords({
  shareId,
  meta,
  password,
}: {
  shareId: string;
  meta: SharedMeta;
  password?: string;
}) {
  const [records, setRecords] = React.useState<Record_[]>([]);
  const [cursor, setCursor] = React.useState<Cursor | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = React.useCallback(
    async (c: Cursor | null) => {
      const res = await fetch(`/api/s/${shareId}/records`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(password ? { "x-swamp-share-password": password } : {}),
        },
        body: JSON.stringify({
          spec: { ...(debounced ? { search: debounced } : {}), limit: 100, cursor: c },
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { records: Record_[]; next: Cursor | null };
    },
    [shareId, password, debounced]
  );

  React.useEffect(() => {
    setLoading(true);
    void fetchPage(null).then((page) => {
      setLoading(false);
      if (!page) return;
      setRecords(page.records);
      setCursor(page.next);
    });
  }, [fetchPage]);

  const loadMore = async () => {
    if (!cursor) return;
    const page = await fetchPage(cursor);
    if (!page) return;
    setRecords((r) => [...r, ...page.records]);
    setCursor(page.next);
  };

  const allowDownload = meta.view.shareOptions?.allowDownload;

  if (meta.view.type === "gallery") {
    return (
      <main className="flex min-h-screen flex-col">
        <SharedHeader
          meta={meta}
          search={search}
          onSearchChange={setSearch}
          shareId={shareId}
          allowDownload={allowDownload}
        />
        <Gallery
          fields={meta.fields}
          hidden={new Set()}
          records={records}
          coverField={meta.fields.find((f) => f.type === "image")}
          onExpand={() => {}}
        />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col">
      <SharedHeader
        meta={meta}
        search={search}
        onSearchChange={setSearch}
        shareId={shareId}
        allowDownload={allowDownload}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr>
                {meta.fields.map((f) => (
                  <th
                    key={f.id}
                    className="truncate border-b border-r px-3 py-2 text-left font-medium"
                  >
                    {f.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30" data-testid="shared-row">
                  {meta.fields.map((f) => (
                    <td key={f.id} className="max-w-[20rem] border-b border-r px-3 py-1.5">
                      {/* No onChange that does anything. A shared view is read-only,
                          and it's read-only here as well as at the database — belt
                          and braces, because a UI that looks editable and silently
                          fails is worse than one that doesn't offer. */}
                      <CellView field={f} value={r.data[f.key]} onChange={() => {}} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {cursor && (
          <div className="flex justify-center py-4">
            <Button variant="outline" size="sm" onClick={loadMore}>
              Load more
            </Button>
          </div>
        )}

        {!loading && records.length === 0 && (
          <p className="py-12 text-center text-[13px] text-muted-foreground">
            Nothing to show.
          </p>
        )}
      </div>
    </main>
  );
}

function SharedHeader({
  meta,
  search,
  onSearchChange,
  shareId,
  allowDownload,
}: {
  meta: SharedMeta;
  search: string;
  onSearchChange: (s: string) => void;
  shareId: string;
  allowDownload?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <h1 className="font-display text-lg font-extrabold tracking-tight">
        {meta.table.name}
      </h1>
      <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        <Lock className="size-3" />
        Read-only
      </span>

      <div className="relative ml-auto w-56">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="h-8 pl-7 text-[13px]"
        />
      </div>

      {allowDownload && (
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px]">
          <a href={`/api/s/${shareId}/export`} download>
            <Download className="size-3.5" />
            Export
          </a>
        </Button>
      )}
    </header>
  );
}

/** The password gate. Rendered when the link needs one, or the one given was wrong. */
export function SharePasswordGate({ wrong }: { wrong?: boolean }) {
  const [password, setPassword] = React.useState("");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-3 p-6">
      <Lock className="size-6 text-muted-foreground" />
      <h1 className="text-[15px] font-medium">This view is password-protected</h1>

      <form
        className="flex w-full flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          // The password goes in the query so the server component can read it on
          // the next render. It never goes to the database as plaintext — Postgres
          // hashes it — but it does land in browser history, which is why the
          // fetches use a header instead once we're past this gate.
          const url = new URL(window.location.href);
          url.searchParams.set("p", password);
          window.location.href = url.toString();
        }}
      >
        <Input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={cn(wrong && "border-destructive")}
        />
        {wrong && (
          <p className="text-[12px] text-destructive">That password isn&apos;t right.</p>
        )}
        <Button type="submit" disabled={!password}>
          Continue
        </Button>
      </form>
    </main>
  );
}

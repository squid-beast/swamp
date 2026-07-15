"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Cursor, QuerySpec, Record_ } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// The read path, client side.
//
// What this replaces:
//
//     const [rows, setRows] = useState<Row[]>(allRowsFromTheServer)
//
// The old grid received EVERY row as a prop, held them all in memory, and
// filtered/sorted them in JavaScript with TanStack Table. The server capped the
// payload at 5,000 rows and truncated silently past that — row 5,001 simply did
// not exist, and nothing told you.
//
// Here, the filter/sort/search live in the QUERY SPEC, the spec goes to Postgres,
// and we hold one window of results plus a cursor. Changing a filter refetches
// from the server; it does not re-filter an array.
// ════════════════════════════════════════════════════════════════════════════

const PAGE = 100;

interface State {
  records: Record_[];
  cursor: Cursor | null;
  total: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const EMPTY: State = {
  records: [],
  cursor: null,
  total: null,
  loading: true,
  loadingMore: false,
  error: null,
};

export function useRecords(tableId: string, spec: QuerySpec) {
  const [state, setState] = React.useState<State>(EMPTY);
  const [nonce, setNonce] = React.useState(0);

  // The spec is an object rebuilt on every render, so it can't be a dependency
  // directly — it would refetch forever. Serialising it means we refetch when the
  // filter actually CHANGES, not when the parent happens to re-render.
  const specKey = JSON.stringify(spec);

  // Guards a slow first page from overwriting a fast second one: if you change
  // the filter twice quickly, only the newest request may land.
  const generation = React.useRef(0);

  const fetchPage = React.useCallback(
    async (cursor: Cursor | null, gen: number) => {
      const res = await fetch(`/api/tables/${tableId}/records?count=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: { ...(JSON.parse(specKey) as QuerySpec), limit: PAGE, cursor },
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to load records");

      // A stale response from a filter the user has already moved on from.
      if (gen !== generation.current) return null;

      return body as { records: Record_[]; next: Cursor | null; total: number };
    },
    [tableId, specKey]
  );

  // First page; whenever the spec changes; and whenever something happened that
  // only the server knows the outcome of — a link edit changes this record's
  // rollups AND the linked record's, and guessing at that from the client is how
  // you end up showing a stale total.
  React.useEffect(() => {
    const gen = ++generation.current;
    setState((s) => ({ ...s, loading: true, error: null }));

    fetchPage(null, gen)
      .then((page) => {
        if (!page) return;
        setState({
          records: page.records,
          cursor: page.next,
          total: page.total,
          loading: false,
          loadingMore: false,
          error: null,
        });
      })
      .catch((e: Error) => {
        if (gen !== generation.current) return;
        setState({ ...EMPTY, loading: false, error: e.message });
      });
  }, [fetchPage, nonce]);

  /** Next page. Idempotent — safe to call from a scroll handler that fires often. */
  const loadMore = React.useCallback(() => {
    setState((s) => {
      if (s.loadingMore || s.loading || !s.cursor) return s;

      const gen = generation.current;
      const cursor = s.cursor;

      void (async () => {
        try {
          const page = await fetchPage(cursor, gen);
          if (!page) return;
          setState((prev) => ({
            ...prev,
            records: [...prev.records, ...page.records],
            cursor: page.next,
            loadingMore: false,
          }));
        } catch (e) {
          setState((prev) => ({ ...prev, loadingMore: false }));
          toast.error((e as Error).message);
        }
      })();

      return { ...s, loadingMore: true };
    });
  }, [fetchPage]);

  /**
   * Apply a change to the loaded window without touching the server.
   *
   * This is what the command stack drives. Mutations no longer live in this hook
   * — they're Commands, so they can be undone. This hook's job is the READ path:
   * fetch a page, hold a window, ask for more. That separation is what makes undo
   * possible at all.
   */
  const applyLocal = React.useCallback(
    (fn: (records: Record_[]) => Record_[]) => {
      setState((s) => ({ ...s, records: fn(s.records) }));
    },
    []
  );

  /** Refetch from the server. For changes whose result only the server knows. */
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, loadMore, applyLocal, reload };
}

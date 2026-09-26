// The cross-project session list, kept live by the event stream.
//
// Backed by TanStack Query: the first page loads up front and older pages
// arrive through the cursor as the list is scrolled. The service pushes session
// lifecycle events (`session.created` / `.deleted` / `.execution.*`), and each
// one invalidates the list. The service is local, so re-fetching is cheaper and
// far more robust than editing the paged cache by hand. The only interval left
// is a slow watchdog for a stream that went quiet without erroring.

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { sessionsKey, sessionsQuery } from "../lib/queries";
import type { OcSession } from "../types";

/** A last-resort refetch, for a stream that silently stopped delivering. */
const WATCHDOG_MS = 60000;

/** Only events that change the list matter; text/reasoning/tool deltas do not. */
function isListEvent(type: string): boolean {
  return (
    type.startsWith("session.execution.") ||
    type === "session.created" ||
    type === "session.deleted" ||
    type === "session.forked" ||
    type === "session.renamed" ||
    type === "session.moved" ||
    type === "session.metadata.updated" ||
    type === "session.model.selected" ||
    type === "session.agent.selected"
  );
}

/** Drop duplicate ids across pages, keeping the newest occurrence. */
function dedupe(pages: OcSession[][]): OcSession[] {
  const seen = new Set<string>();
  const out: OcSession[] = [];
  for (const page of pages) {
    for (const session of page) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      out.push(session);
    }
  }
  return out;
}

export function useSessions() {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery(sessionsQuery);

  const sessions = useMemo(
    () => dedupe(query.data?.pages.map((page) => page.sessions) ?? []),
    [query.data],
  );
  const version = query.data?.pages[0]?.version ?? "";

  // Live updates from the event stream, plus a resync on (re)connect and while
  // the tab regains visibility. Events are debounced, so a turn's start and
  // finish collapse into one refetch.
  useEffect(() => {
    let timer: number | undefined;
    const invalidate = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: sessionsKey });
      }, 400);
    };

    const source = new EventSource("/api/events");
    source.addEventListener("open", invalidate);
    source.addEventListener("oc", (message) => {
      let event: { type?: string };
      try {
        event = JSON.parse((message as MessageEvent<string>).data);
      } catch {
        return;
      }
      if (isListEvent(event.type ?? "")) invalidate();
    });

    const watchdog = window.setInterval(invalidate, WATCHDOG_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      source.close();
      window.clearInterval(watchdog);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queryClient]);

  return {
    sessions,
    version,
    error: query.error ? String(query.error) : null,
    loading: query.isLoading,
    hasMore: query.hasNextPage,
    loadMore: async () => {
      await query.fetchNextPage();
    },
    refresh: async () => {
      await query.refetch();
    },
  };
}

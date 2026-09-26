// The cross-project session list, kept live by the event stream.
//
// The service pushes session lifecycle events (`session.created` /
// `.deleted` / `.execution.*` / `.title`), so the list updates without polling.
// The first page loads up front; older pages arrive through the cursor as the
// list is scrolled. The only interval left is a slow watchdog for a stream that
// reported no error but went quiet.

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSessions } from "../api";
import type { OcSession } from "../types";

/** A last-resort refetch, for a stream that silently stopped delivering. */
const WATCHDOG_MS = 60000;

/** Only events that change the list matter; text/reasoning/tool deltas do not. */
function isListEvent(type: string): boolean {
  return (
    type.startsWith("session.execution.") ||
    type === "session.created" ||
    type === "session.updated" ||
    type === "session.deleted" ||
    type === "session.title" ||
    type === "session.moved"
  );
}

/** Insert or replace a session by id, keeping a new one at the head. */
function upsert(list: OcSession[], session: OcSession): OcSession[] {
  const index = list.findIndex((entry) => entry.id === session.id);
  if (index === -1) return [session, ...list];
  const next = list.slice();
  next[index] = { ...next[index], ...session };
  return next;
}

export function useSessions() {
  const [sessions, setSessions] = useState<OcSession[]>([]);
  const [version, setVersion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  // The page token only advances through `loadMore`; a refresh never rewinds it.
  const cursor = useRef<string | null>(null);
  const initialized = useRef(false);
  const loadingMore = useRef(false);

  /** Fetch page one and fold it over what is loaded, so older pages survive. */
  const refresh = useCallback(async () => {
    try {
      const response = await fetchSessions();
      setVersion(response.version);
      if (!initialized.current) {
        initialized.current = true;
        cursor.current = response.cursor?.next ?? null;
      }
      setHasMore(cursor.current !== null);
      setSessions((previous) => {
        const head = response.sessions;
        const ids = new Set(head.map((session) => session.id));
        const tail = previous.filter((session) => !ids.has(session.id));
        return [...head, ...tail];
      });
      setError(null);
    } catch (fetchError: unknown) {
      setError(String(fetchError));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fetch the next older page and append the sessions not already shown. */
  const loadMore = useCallback(async () => {
    if (loadingMore.current || cursor.current === null) return;
    loadingMore.current = true;
    try {
      const response = await fetchSessions(cursor.current);
      cursor.current = response.cursor?.next ?? null;
      setHasMore(cursor.current !== null);
      setSessions((previous) => {
        const seen = new Set(previous.map((session) => session.id));
        return [
          ...previous,
          ...response.sessions.filter((session) => !seen.has(session.id)),
        ];
      });
    } catch (fetchError: unknown) {
      setError(String(fetchError));
    } finally {
      loadingMore.current = false;
    }
  }, []);

  // Live updates from the event stream, plus a resync on (re)connect.
  useEffect(() => {
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 500);
    };

    const source = new EventSource("/api/events");
    source.addEventListener("open", () => void refresh());
    source.addEventListener("oc", (message) => {
      let event: { type?: string; data?: Record<string, unknown> };
      try {
        event = JSON.parse((message as MessageEvent<string>).data);
      } catch {
        return;
      }
      const type = event.type ?? "";
      if (!isListEvent(type)) return;
      const data = event.data ?? {};
      const id = (data.sessionID as string) ?? (data.id as string);
      if (!id) return;

      if (type === "session.deleted") {
        setSessions((previous) =>
          previous.filter((session) => session.id !== id),
        );
        return;
      }
      if (type === "session.created") {
        const session = { ...(data as unknown as OcSession), id };
        setSessions((previous) => upsert(previous, session));
        return;
      }
      if (type === "session.execution.started") {
        setSessions((previous) =>
          previous.map((session) =>
            session.id === id ? { ...session, active: true } : session,
          ),
        );
        return;
      }
      if (type.startsWith("session.execution.")) {
        setSessions((previous) =>
          previous.map((session) =>
            session.id === id
              ? {
                  ...session,
                  active: false,
                  time: { ...session.time, updated: Date.now() },
                }
              : session,
          ),
        );
        return;
      }
      // `session.updated` / `session.title` / `session.moved`: fold a known
      // title in, otherwise ask the service (debounced).
      if (typeof data.title === "string") {
        setSessions((previous) =>
          previous.map((session) =>
            session.id === id ? { ...session, title: data.title as string } : session,
          ),
        );
      } else {
        scheduleRefresh();
      }
    });

    const watchdog = window.setInterval(() => void refresh(), WATCHDOG_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      source.close();
      window.clearInterval(watchdog);
      window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { sessions, version, error, loading, hasMore, loadMore, refresh };
}

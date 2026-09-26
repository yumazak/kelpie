import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSession } from "./api";
import { Chat } from "./components/Chat";
import { Home } from "./components/Home";
import { useSessions } from "./hooks/useSessions";
import { consumePendingSession } from "./lib/push";
import type { OcSession } from "./types";

export default function App() {
  const { sessions, error, loading, hasMore, loadMore, refresh } = useSessions();
  const [selected, setSelected] = useState<OcSession | null>(null);
  const openedFromUrl = useRef(false);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  // The popstate handler runs outside React, so it reads the latest list here.
  const sessionsRef = useRef<OcSession[]>([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const sessionUrl = (id: string) => `/?session=${encodeURIComponent(id)}`;

  /** Open a session and leave a history entry, so the back gesture returns. */
  const openSession = useCallback((session: OcSession, replace = false) => {
    setSelected(session);
    const url = sessionUrl(session.id);
    if (replace) {
      window.history.replaceState({ session: session.id }, "", url);
    } else {
      window.history.pushState({ session: session.id }, "", url);
    }
  }, []);

  // A notification tap left its target in Cache Storage (and the URL).
  useEffect(() => {
    void consumePendingSession().then((id) => {
      if (id) setPendingSession(id);
    });
  }, []);

  // Open the tapped session once the list arrives, with Home behind it. A
  // target that is not on the first page is fetched directly by id.
  useEffect(() => {
    if (openedFromUrl.current || loading) return;
    const target =
      pendingSession ??
      new URLSearchParams(window.location.search).get("session");
    if (!target) {
      openedFromUrl.current = true;
      return;
    }
    const fromList = sessions.find((entry) => entry.id === target);
    if (fromList) {
      // A deep link lands directly on the Chat URL; rewrite the current entry
      // to Home so the back gesture has somewhere to go.
      if (new URLSearchParams(window.location.search).get("session")) {
        window.history.replaceState(null, "", "/");
      }
      // eslint-disable-next-line react/set-state-in-effect
      openSession(fromList);
      openedFromUrl.current = true;
      return;
    }
    let cancelled = false;
    void fetchSession(target)
      .then((session) => {
        if (cancelled) return;
        if (new URLSearchParams(window.location.search).get("session")) {
          window.history.replaceState(null, "", "/");
        }
        openSession(session);
      })
      .catch(() => {
        /* the session may be gone; stay on Home */
      })
      .finally(() => {
        if (!cancelled) openedFromUrl.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [sessions, loading, pendingSession, openSession]);

  // Back gesture / browser back: read the URL and follow it.
  useEffect(() => {
    const onPopState = () => {
      const id = new URLSearchParams(window.location.search).get("session");
      if (!id) {
        // eslint-disable-next-line react/set-state-in-effect
        setSelected(null);
        return;
      }
      const session = sessionsRef.current.find((entry) => entry.id === id);
      setSelected(session ?? null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (selected) {
    const live = sessions.find((session) => session.id === selected.id);
    return (
      <Chat
        key={selected.id}
        session={live ?? selected}
        onBack={() => window.history.back()}
      />
    );
  }

  return (
    <Home
      sessions={sessions}
      error={error}
      loading={loading}
      hasMore={hasMore}
      onLoadMore={loadMore}
      onSelect={openSession}
      onRefresh={refresh}
    />
  );
}

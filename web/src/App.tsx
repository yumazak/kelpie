import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSessions } from "./api";
import { Chat } from "./components/Chat";
import { Home } from "./components/Home";
import { consumePendingSession } from "./lib/push";
import type { OcSession, OcSessionsResponse } from "./types";

const SESSIONS_POLL_MS = 3000;

export default function App() {
  const [state, setState] = useState<OcSessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OcSession | null>(null);
  const openedFromUrl = useRef(false);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  // The popstate handler runs outside React, so it reads the latest list here.
  const stateRef = useRef<OcSessionsResponse | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

  // Open the tapped session once the list arrives, with Home behind it.
  useEffect(() => {
    if (openedFromUrl.current || !state) return;
    const target =
      pendingSession ??
      new URLSearchParams(window.location.search).get("session");
    if (!target) {
      openedFromUrl.current = true;
      return;
    }
    const session = state.sessions.find((entry) => entry.id === target);
    if (session) {
      // A deep link lands directly on the Chat URL; rewrite the current entry
      // to Home so the back gesture has somewhere to go.
      if (new URLSearchParams(window.location.search).get("session")) {
        window.history.replaceState(null, "", "/");
      }
      // eslint-disable-next-line react/set-state-in-effect
      openSession(session);
      openedFromUrl.current = true;
    }
  }, [state, pendingSession, openSession]);

  // Back gesture / browser back: read the URL and follow it.
  useEffect(() => {
    const onPopState = () => {
      const id = new URLSearchParams(window.location.search).get("session");
      if (!id) {
        // eslint-disable-next-line react/set-state-in-effect
        setSelected(null);
        return;
      }
      const session = stateRef.current?.sessions.find((entry) => entry.id === id);
      setSelected(session ?? null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetchSessions()
        .then((next) => {
          if (!active) return;
          setState(next);
          setError(null);
        })
        .catch((fetchError: unknown) => {
          if (active) setError(String(fetchError));
        });
    };
    load();
    const id = window.setInterval(load, SESSIONS_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  if (selected) {
    const live = state?.sessions.find((session) => session.id === selected.id);
    return (
      <Chat
        key={selected.id}
        session={live ?? selected}
        onBack={() => window.history.back()}
      />
    );
  }

  return <Home state={state} error={error} onSelect={openSession} />;
}

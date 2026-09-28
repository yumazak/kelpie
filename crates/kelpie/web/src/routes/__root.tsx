import { Outlet, createRootRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useSessions } from "../hooks/useSessions";
import { consumePendingSession } from "../lib/push";
import { SessionsProvider } from "../lib/sessions-context";

/** The id of the session the URL names, if the URL names one. */
function sessionIdFromUrl(): string | undefined {
  const match = window.location.pathname.match(/^\/sessions\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/** The app shell: one session list, and whichever screen the URL names. */
export const Route = createRootRoute({ component: Root });

function Root() {
  const sessions = useSessions();
  const navigate = useNavigate();
  const followedDeepLink = useRef(false);

  // Cold start. A notification tap arrives one of two ways: the launched PWA
  // lands on `/sessions/<id>`, or (on iOS) it starts at the start URL and the
  // service worker leaves the id in Cache Storage. Follow exactly one, once —
  // navigating for both would stack duplicate entries, and the back gesture
  // would land on one of them (or outside the app).
  useEffect(() => {
    if (followedDeepLink.current) return;
    followedDeepLink.current = true;
    const fromUrl = sessionIdFromUrl();
    if (fromUrl) {
      // Replace the launched entry with the list, then push the session on top,
      // so back returns to the list. The two must be sequential: issued in the
      // same tick the router collapses them and the list entry never lands.
      void navigate({ to: "/", replace: true }).then(() =>
        navigate({
          to: "/sessions/$sessionId",
          params: { sessionId: fromUrl },
        }),
      );
      return;
    }
    void consumePendingSession().then((id) => {
      if (id) {
        void navigate({
          to: "/sessions/$sessionId",
          params: { sessionId: id },
        });
      }
    });
  }, [navigate]);

  // Foreground: a notification tapped while the app was suspended. Only move
  // when it names a session other than the one already on screen; the session
  // screen refreshes itself, so an identical id needs no navigation.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void consumePendingSession().then((id) => {
        if (!id || id === sessionIdFromUrl()) return;
        void navigate({
          to: "/sessions/$sessionId",
          params: { sessionId: id },
        });
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [navigate]);

  return (
    <SessionsProvider value={sessions}>
      <Outlet />
    </SessionsProvider>
  );
}

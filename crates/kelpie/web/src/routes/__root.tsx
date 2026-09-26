import { Outlet, createRootRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useSessions } from "../hooks/useSessions";
import { consumePendingSession } from "../lib/push";
import { SessionsProvider } from "../lib/sessions-context";

/** The app shell: one session list, and whichever screen the URL names. */
export const Route = createRootRoute({ component: Root });

function Root() {
  const sessions = useSessions();
  const navigate = useNavigate();
  const rewroteDeepLink = useRef(false);

  // A notification tap opens `/sessions/<id>`, but iOS may launch the installed
  // PWA at its start URL and drop the path; the service worker stashes the id
  // in Cache Storage. Follow it at startup and whenever the app returns to the
  // foreground — the tap that woke it may have happened while it was suspended.
  useEffect(() => {
    const follow = () => {
      void consumePendingSession().then((id) => {
        if (id) {
          void navigate({
            to: "/sessions/$sessionId",
            params: { sessionId: id },
          });
        }
      });
    };
    follow();
    const onVisible = () => {
      if (document.visibilityState === "visible") follow();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [navigate]);

  // A cold deep link should leave the list behind it, so the back gesture
  // returns there instead of leaving the app.
  useEffect(() => {
    if (rewroteDeepLink.current) return;
    rewroteDeepLink.current = true;
    const match = window.location.pathname.match(/^\/sessions\/([^/]+)/);
    if (!match) return;
    void navigate({ to: "/", replace: true });
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: decodeURIComponent(match[1]) },
    });
  }, [navigate]);

  return (
    <SessionsProvider value={sessions}>
      <Outlet />
    </SessionsProvider>
  );
}

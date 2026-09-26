import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Home } from "../components/Home";
import { useSessionsContext } from "../lib/sessions-context";

/** `/` — every session, across every project. */
export const Route = createFileRoute("/")({ component: ListScreen });

function ListScreen() {
  const { sessions, error, loading, hasMore, loadMore, refresh } =
    useSessionsContext();
  const navigate = useNavigate();
  return (
    <Home
      sessions={sessions}
      error={error}
      loading={loading}
      hasMore={hasMore}
      onLoadMore={loadMore}
      onRefresh={refresh}
      onSelect={(session) =>
        void navigate({
          to: "/sessions/$sessionId",
          params: { sessionId: session.id },
        })
      }
    />
  );
}

import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Chat } from "../components/Chat";
import { ErrorState } from "../components/ErrorState";
import { sessionQuery } from "../lib/queries";
import { useSessionsContext } from "../lib/sessions-context";
import type { OcSession } from "../types";

/** `/sessions/$sessionId` — one conversation. */
export const Route = createFileRoute("/sessions/$sessionId")({
  component: SessionScreen,
});

function SessionScreen() {
  const { sessionId } = Route.useParams();
  const { sessions } = useSessionsContext();
  const navigate = useNavigate();
  const router = useRouter();

  // The list is live, so prefer the entry it already holds; a notification tap
  // can name a session that is not on the first page, so fetch it by id then.
  const fromList = sessions.find((entry) => entry.id === sessionId);
  const fallback = useQuery({ ...sessionQuery(sessionId), enabled: !fromList });
  const session: OcSession | undefined = fromList ?? fallback.data;

  if (fallback.error) {
    return (
      <ErrorState
        detail={String(fallback.error)}
        onRetry={() => void navigate({ to: "/" })}
      />
    );
  }
  if (!session) {
    return <div className="h-full animate-pulse bg-background" />;
  }
  return (
    <Chat
      key={session.id}
      session={session}
      onBack={() => router.history.back()}
    />
  );
}

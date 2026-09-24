import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";

import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { fetchForms, fetchMessages, fetchPermissions, sendPrompt } from "../api";
import { useLiveMessage } from "../hooks/useLiveMessage";
import { toThreadMessages } from "../lib/convert";
import type { OcForm, OcPermission, OcSession } from "../types";
import { HarnessDock } from "./HarnessDock";
import { RuntimeProvider } from "./RuntimeProvider";

/** Fallback poll: the live event stream is primary, but a missed event (a
 *  reconnect, a dropped frame) is healed here within a couple of seconds. */
const POLL_MS = 2000;

function signature(messages: ThreadMessageLike[]): string {
  if (messages.length === 0) return "0";
  const last = messages[messages.length - 1];
  return `${messages.length}:${JSON.stringify(last?.content).length}`;
}

export function Chat({
  session,
  onBack,
}: {
  session: OcSession;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [permissions, setPermissions] = useState<OcPermission[]>([]);
  const [forms, setForms] = useState<OcForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const stale = useRef(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetchMessages(session.id);
      if (stale.current) return;
      const next = toThreadMessages(response.data);
      setMessages((previous) =>
        signature(previous) === signature(next) ? previous : next,
      );
      setError(null);
    } catch (fetchError: unknown) {
      if (!stale.current) setError(String(fetchError));
    } finally {
      if (!stale.current) setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    stale.current = false;
    // `reload` only touches state after its awaits; the linter cannot see that.
    // eslint-disable-next-line react/set-state-in-effect
    void reload();
    const id = window.setInterval(() => {
      void reload();
    }, POLL_MS);
    return () => {
      stale.current = true;
      window.clearInterval(id);
    };
  }, [reload]);

  // The pending permission / form lists. Best-effort: a failure just leaves
  // the last dock state.
  const refreshDock = useCallback(async () => {
    try {
      const [nextPermissions, nextForms] = await Promise.all([
        fetchPermissions(session.id),
        fetchForms(session.id),
      ]);
      if (stale.current) return;
      setPermissions(nextPermissions);
      setForms(nextForms);
    } catch {
      /* the dock is best-effort */
    }
  }, [session.id]);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void refreshDock();
    const id = window.setInterval(() => {
      void refreshDock();
    }, 3000);
    return () => window.clearInterval(id);
  }, [refreshDock]);

  // The in-progress assistant turn, streamed from the service. It sits on top
  // of the fetched list and is dropped when `step.ended` refetches.
  const live = useLiveMessage(session.id, reload, refreshDock);
  const rendered = live ? [...messages, live] : messages;

  const handleNew = useCallback(
    async (text: string) => {
      await sendPrompt(session.id, text);
      void reload();
    },
    [session.id, reload],
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 rounded-lg px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {session.title || session.id}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {[session.agent, session.location?.directory]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {loading && <ChatSkeleton />}
        {error && <div className="p-6 text-sm text-destructive">{error}</div>}
        {!loading && !error && (
          <RuntimeProvider messages={rendered} onNew={handleNew}>
            <Thread
              components={{ Welcome }}
              dock={
                permissions.length > 0 || forms.length > 0 ? (
                  <HarnessDock
                    sessionId={session.id}
                    permissions={permissions}
                    forms={forms}
                    onReplied={refreshDock}
                  />
                ) : undefined
              }
            />
          </RuntimeProvider>
        )}
      </div>
    </div>
  );
}

/** Shown for a session with no turns yet. */
function Welcome() {
  return (
    <div className="mb-6 px-2 text-sm text-muted-foreground">
      メッセージを送って会話を始めましょう
    </div>
  );
}

/** A chat-shaped placeholder while the first fetch lands. */
function ChatSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
      <div className="ml-auto h-9 w-1/3 animate-pulse rounded-2xl bg-muted" />
      <div className="flex flex-col gap-2">
        <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-12 w-full animate-pulse rounded-xl bg-muted" />
      <div className="ml-auto h-9 w-2/5 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

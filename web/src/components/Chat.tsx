import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";

import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import {
  fetchForms,
  fetchMessages,
  fetchPermissions,
  interruptSession,
  sendPrompt,
  type PromptFile,
} from "../api";
import { useLiveMessage } from "../hooks/useLiveMessage";
import { toThreadMessages } from "../lib/convert";
import type { OcForm, OcPermission, OcSession } from "../types";
import { ErrorState } from "./ErrorState";
import { HarnessDock } from "./HarnessDock";
import { RuntimeProvider } from "./RuntimeProvider";

/** Fallback poll: the live event stream is primary, but a missed event (a
 *  reconnect, a dropped frame) is healed here within a couple of seconds. */
const POLL_MS = 2000;

/**
 * An empty assistant message marked as running. assistant-ui's `GroupedParts`
 * turns this into its own "thinking" indicator (a pulsing dot) before the first
 * token lands.
 */
const THINKING: ThreadMessageLike = {
  id: "live",
  role: "assistant",
  status: { type: "running" },
  content: [],
};

function signature(messages: ThreadMessageLike[]): string {
  if (messages.length === 0) return "0";
  const last = messages[messages.length - 1];
  return `${messages.length}:${JSON.stringify(last?.content).length}`;
}

/** The text of a message, for matching the optimistic bubble to the real one. */
function textOf(message: ThreadMessageLike): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export function Chat({
  session,
  onBack,
}: {
  session: OcSession;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [optimistic, setOptimistic] = useState<ThreadMessageLike | null>(null);
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
      // The sent message is the server's now; drop the local stand-in.
      setOptimistic((current) =>
        current && next.some((m) => m.role === "user" && textOf(m) === textOf(current))
          ? null
          : current,
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

  // The pending permission / form lists. Best-effort.
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

  const { live, running } = useLiveMessage(session.id, reload, refreshDock);

  const handleNew = useCallback(
    async (text: string, files: PromptFile[]) => {
      // Show the message at once, before the round trip lands.
      const body = text || "（添付）";
      const local: ThreadMessageLike = {
        id: `local-${Date.now()}`,
        role: "user",
        content: [
          {
            type: "text",
            text: files.length > 0 ? `${body}\n📎 ${files.length}件` : body,
          },
        ],
      };
      setOptimistic(local);
      try {
        await sendPrompt(session.id, text, files);
      } catch (sendError) {
        setOptimistic(null);
        throw sendError;
      }
      void reload();
    },
    [session.id, reload],
  );

  const handleStop = useCallback(async () => {
    try {
      await interruptSession(session.id);
    } catch {
      /* the turn may already be over */
    }
    void reload();
  }, [session.id, reload]);

  const isRunning = running || session.active === true;
  const rendered = [
    ...messages,
    ...(optimistic ? [optimistic] : []),
    ...(live ? [live] : isRunning ? [THINKING] : []),
  ];

  // The running indicator and the stop button are assistant-ui's own (the
  // `indicator` part and the composer's cancel action); the dock is only for
  // permissions and forms.
  const dock =
    permissions.length > 0 || forms.length > 0 ? (
      <HarnessDock
        sessionId={session.id}
        permissions={permissions}
        forms={forms}
        onReplied={refreshDock}
      />
    ) : undefined;

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 rounded-lg px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="戻る"
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
        {error && <ErrorState detail={error} onRetry={() => void reload()} />}
        {!loading && !error && (
          <RuntimeProvider
            messages={rendered}
            isRunning={isRunning}
            onNew={handleNew}
            onCancel={handleStop}
          >
            <Thread components={{ Welcome }} dock={dock} />
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

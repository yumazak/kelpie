import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/elements/tool-group.aui";
import {
  QuestionContext,
  QuestionTool,
  isQuestionForm,
} from "@/components/assistant-ui/elements/question.aui";
import {
  Thread,
  type ThreadGroupPart,
} from "@/components/assistant-ui/elements/thread.aui";
import {
  cancelInboxItem,
  interruptSession,
  replyForm,
  replyPermission,
  sendPrompt,
  viewSession,
  type PromptFile,
} from "../api";
import { useLiveMessage } from "../hooks/useLiveMessage";
import {
  ComposerSkillsContext,
  type AttachedSkill,
} from "../lib/composer-skills";
import { attachApprovals, toThreadMessages } from "../lib/convert";
import { isUnread } from "../lib/read";
import {
  formsKey,
  formsQuery,
  inboxKey,
  inboxQuery,
  loadOlderMessages,
  messagesKey,
  messagesQuery,
  permissionsKey,
  permissionsQuery,
  sessionsKey,
} from "../lib/queries";
import type { OcSession } from "../types";
import { ErrorState } from "./ErrorState";
import { HarnessDock } from "./HarnessDock";
import { RuntimeProvider } from "./RuntimeProvider";
import { SkillChips, SkillPickerButton } from "./SkillPicker";

/**
 * An empty assistant message marked as running. assistant-ui's `GroupedParts`
 * turns this into its own "thinking" indicator (a pulsing dot) before the first
 * token lands.
 */
const THINKING: ThreadMessageLike = {
  id: "thinking",
  role: "assistant",
  status: { type: "running" },
  content: [],
};

/** Per-tool renderers. A `question` is answered inline, not as a JSON card. */
const KELPIE_TOOLS = { question: QuestionTool };

function signature(messages: ThreadMessageLike[]): string {
  // Every message's id and content length. The old `length:lastContentLength`
  // form was useless here: the message list is capped at 200, so `length` is
  // nearly constant, and a change to any message but the last went unnoticed —
  // updates were dropped and the thread showed stale turns.
  return messages
    .map(
      (message) =>
        `${message.id ?? ""}:${JSON.stringify(message.content).length}`,
    )
    .join("|");
}

export function Chat({
  session,
  onBack,
}: {
  session: OcSession;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  // Skills are scoped to the project, so the session's own directory picks them.
  const directory = session.location?.directory ?? "";
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [optimistic, setOptimistic] = useState<ThreadMessageLike | null>(null);
  const [attachedSkills, setAttachedSkills] = useState<AttachedSkill[]>([]);
  // The message count when the optimistic bubble went up. Once the server's
  // list grows past it, the real message has landed and the stand-in can go.
  const optimisticAt = useRef<number | null>(null);
  const messagesRef = useRef<ThreadMessageLike[]>([]);

  // No interval poll: the event stream drives updates, TanStack Query refetches
  // on focus, and a reconnect resyncs through `useLiveMessage`'s open handler.
  const messagesResult = useQuery(messagesQuery(session.id));
  const permissionsResult = useQuery(permissionsQuery(session.id));
  const formsResult = useQuery(formsQuery(session.id));
  const inboxResult = useQuery(inboxQuery(session.id));

  const permissions = permissionsResult.data ?? [];
  const forms = formsResult.data ?? [];
  const error = messagesResult.error ? String(messagesResult.error) : null;
  const loading = messagesResult.isLoading;

  // Keep the rendered list stable when the server's copy is unchanged, so a
  // poll that returns the same turns does not re-render the whole thread.
  useEffect(() => {
    const next = toThreadMessages(messagesResult.data?.data ?? []);
    setMessages((previous) =>
      signature(previous) === signature(next) ? previous : next,
    );
  }, [messagesResult.data]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // The sent message is the server's now; drop the local stand-in. Matching on
  // the count, not the text, also clears it for a skill-only send, whose
  // server-side text differs from what the composer showed.
  useEffect(() => {
    const at = optimisticAt.current;
    if (at !== null && messages.length > at) {
      optimisticAt.current = null;
      setOptimistic(null);
    }
  }, [messages]);

  // Mark the session read while it is on screen: once for the turn it was
  // opened on, and again whenever a turn finishes while we are looking. A
  // session with no completed turn has nothing to mark. opencode shares
  // `time.viewed`, so this clears the marker for other clients too.
  const idle = session.time?.idle;
  const unread = isUnread(session);
  useEffect(() => {
    if (!unread || idle === undefined) return;
    let cancelled = false;
    void viewSession(session.id, idle)
      .then(() => {
        if (!cancelled) {
          void queryClient.invalidateQueries({ queryKey: sessionsKey });
        }
      })
      .catch(() => {
        /* best effort — opening the session again retries */
      });
    return () => {
      cancelled = true;
    };
  }, [unread, idle, session.id, queryClient]);

  const invalidateMessages = useCallback(
    () => queryClient.invalidateQueries({ queryKey: messagesKey(session.id) }),
    [queryClient, session.id],
  );
  const invalidateDock = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: permissionsKey(session.id) }),
        queryClient.invalidateQueries({ queryKey: formsKey(session.id) }),
      ]).then(() => undefined),
    [queryClient, session.id],
  );
  const invalidateInbox = useCallback(
    () => queryClient.invalidateQueries({ queryKey: inboxKey(session.id) }),
    [queryClient, session.id],
  );

  // Returning to the foreground — e.g. a notification tap while this session
  // was already on screen, so `Chat` never remounted — must show the latest
  // turns, so resync.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void invalidateMessages();
      void invalidateDock();
      void invalidateInbox();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [invalidateMessages, invalidateDock, invalidateInbox]);

  const { live, running } = useLiveMessage(
    session.id,
    invalidateMessages,
    invalidateDock,
    invalidateInbox,
  );

  // A skill is attached to the next message. The picker button and the chips
  // read this through context; `handleNew` sends it as `skills: [{ id }]`.
  const toggleSkill = useCallback((skill: AttachedSkill) => {
    setAttachedSkills((current) =>
      current.some((entry) => entry.id === skill.id)
        ? current.filter((entry) => entry.id !== skill.id)
        : [...current, skill],
    );
  }, []);
  const attachedValue = useMemo(
    () => ({ directory, skills: attachedSkills, toggle: toggleSkill }),
    [directory, attachedSkills, toggleSkill],
  );

  const handleNew = useCallback(
    async (text: string, files: PromptFile[], delivery?: "queue" | "steer") => {
      // A prompt sent while a turn is running goes into opencode's inbox. The
      // inbox list (the "送信待ち" row) is where it shows, so no stand-in is
      // needed here — it would only duplicate that row.
      const queued = delivery === "queue";
      if (!queued) {
        // Show the message at once, before the round trip lands. The skill and
        // attachment notes match how the server's copy renders them.
        const notes = [
          ...attachedSkills.map((skill) => `🧩 ${skill.name}`),
          ...files.map((file) => `📎 ${file.name ?? "添付"}`),
        ];
        const body = [text, notes.join("\n")].filter(Boolean).join("\n");
        const local: ThreadMessageLike = {
          id: `local-${Date.now()}`,
          role: "user",
          content: [{ type: "text", text: body || "（添付）" }],
        };
        setOptimistic(local);
        optimisticAt.current = messagesRef.current.length;
      }
      try {
        await sendPrompt(
          session.id,
          text,
          files,
          attachedSkills.map((skill) => ({ id: skill.id })),
          delivery,
        );
      } catch (sendError) {
        setOptimistic(null);
        optimisticAt.current = null;
        throw sendError;
      }
      setAttachedSkills([]);
      if (queued) void invalidateInbox();
      else void invalidateMessages();
    },
    [session.id, attachedSkills, invalidateMessages, invalidateInbox],
  );

  // Drop a queued prompt from the session's inbox.
  const handleRemoveQueued = useCallback(
    (inboxId: string) => {
      void cancelInboxItem(session.id, inboxId)
        .catch(() => {
          /* already delivered or dropped — the refetch will settle it */
        })
        .finally(() => void invalidateInbox());
    },
    [session.id, invalidateInbox],
  );

  const handleStop = useCallback(async () => {
    try {
      await interruptSession(session.id);
    } catch {
      /* the turn may already be over */
    }
    void invalidateMessages();
  }, [session.id, invalidateMessages]);

  const handlePermissionReply = useCallback(
    async (id: string, decision: "once" | "always" | "reject") => {
      await replyPermission(session.id, id, decision);
      await invalidateDock();
      void invalidateMessages();
    },
    [session.id, invalidateDock, invalidateMessages],
  );

  const handleFormReply = useCallback(
    async (formId: string, answer: Record<string, unknown>) => {
      await replyForm(session.id, formId, answer);
      await invalidateDock();
      void invalidateMessages();
    },
    [session.id, invalidateDock, invalidateMessages],
  );

  const handleLoadOlder = useCallback(
    () => loadOlderMessages(session.id),
    [session.id],
  );

  // The pending permissions ride along on the tool calls they gate.
  const withApprovals = useMemo(
    () => attachApprovals(messages, permissions),
    [messages, permissions],
  );

  // A question is rendered inline where it was asked; every other form docks.
  const questionContext = useMemo(
    () => ({ forms, onReply: handleFormReply }),
    [forms, handleFormReply],
  );
  const dockForms = useMemo(
    () => forms.filter((form) => !isQuestionForm(form)),
    [forms],
  );

  const isRunning = running || session.active === true;
  // The live overlay can hold only reasoning while the model thinks. Keep the
  // "考え中" indicator on screen until visible text starts, so a turn does not
  // look idle (or finished) during the reasoning phase.
  const liveText =
    live &&
    Array.isArray(live.content) &&
    live.content.some((part) => part.type === "text" && part.text);
  const rendered = [
    ...withApprovals,
    ...(optimistic ? [optimistic] : []),
    ...(live ? [live] : []),
    ...(isRunning && !liveText ? [THINKING] : []),
  ];

  // The running indicator, the stop button and the permission approvals are
  // all assistant-ui's own; the dock is only for forms.
  const dock =
    dockForms.length > 0 ? (
      <HarnessDock
        sessionId={session.id}
        forms={dockForms}
        onReplied={invalidateDock}
      />
    ) : undefined;

  // opencode's inbox, as the "送信待ち" rows above the composer. The skill and
  // attachment notes are added the same way the thread renders a sent message.
  const queued = useMemo(
    () =>
      (inboxResult.data ?? [])
        .filter((item) => item.type === "user")
        .map((item) => {
          const notes = [
            ...(item.payload?.skills ?? []).map(
              (skill) => `🧩 ${skill.name ?? skill.id}`,
            ),
            ...(item.payload?.files ?? []).map(
              (file) => `📎 ${file.name ?? "添付"}`,
            ),
          ];
          return {
            id: item.id,
            text: [item.payload?.text, ...notes].filter(Boolean).join("\n"),
          };
        })
        .filter((item) => item.text !== ""),
    [inboxResult.data],
  );

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
        {error ? (
          <ErrorState detail={error} onRetry={() => void invalidateMessages()} />
        ) : (
          <ComposerSkillsContext.Provider value={attachedValue}>
            <RuntimeProvider
              messages={rendered}
              isRunning={isRunning}
              isLoading={loading}
              onNew={handleNew}
              onCancel={handleStop}
              onPermissionReply={handlePermissionReply}
            >
              <QuestionContext.Provider value={questionContext}>
                <Thread
                  components={{
                    Welcome,
                    ComposerHeader: SkillChips,
                    ComposerTools: SkillPickerButton,
                    ToolGroup: KelpieToolGroup,
                    ToolByName: KELPIE_TOOLS,
                  }}
                  dock={dock}
                  queued={queued}
                  onRemoveQueued={handleRemoveQueued}
                  onLoadOlder={handleLoadOlder}
                  autoFocus={false}
                />
              </QuestionContext.Provider>
            </RuntimeProvider>
          </ComposerSkillsContext.Provider>
        )}
      </div>
    </div>
  );
}

/**
 * The tool group, but one holding a pending approval opens itself — the
 * permission would otherwise be hidden behind a collapsed "1 tool call".
 */
function KelpieToolGroup({
  group,
  children,
}: {
  group: ThreadGroupPart;
  children?: ReactNode;
}) {
  const needsAction = group.counts.requiresAction > 0;
  const [open, setOpen] = useState(needsAction);
  const [wasNeedingAction, setWasNeedingAction] = useState(needsAction);
  // A permission can arrive after the group mounted collapsed; open it then.
  if (needsAction !== wasNeedingAction) {
    setWasNeedingAction(needsAction);
    if (needsAction) setOpen(true);
  }

  return (
    <ToolGroupRoot variant="ghost" open={open} onOpenChange={setOpen}>
      <ToolGroupTrigger
        count={group.indices.length}
        active={group.counts.running > 0}
      />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
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


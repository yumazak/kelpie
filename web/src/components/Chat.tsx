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
  interruptSession,
  replyForm,
  replyPermission,
  sendPrompt,
  type PromptFile,
} from "../api";
import { useLiveMessage } from "../hooks/useLiveMessage";
import {
  ComposerSkillsContext,
  type AttachedSkill,
} from "../lib/composer-skills";
import { attachApprovals, toThreadMessages } from "../lib/convert";
import {
  formsKey,
  formsQuery,
  messagesKey,
  messagesQuery,
  permissionsKey,
  permissionsQuery,
} from "../lib/queries";
import type { OcSession } from "../types";
import { ErrorState } from "./ErrorState";
import { HarnessDock } from "./HarnessDock";
import { RuntimeProvider } from "./RuntimeProvider";
import { SkillChips, SkillPickerButton } from "./SkillPicker";

/** Fallback poll: the live event stream is primary; the stream also resyncs on
 *  (re)connect. This is only a slow watchdog for a stream that reported no
 *  error but stopped delivering. */
const POLL_MS = 10000;

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

/** Per-tool renderers. A `question` is answered inline, not as a JSON card. */
const KELPIE_TOOLS = { question: QuestionTool };

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

  // The poll is only a fallback: the event stream is primary, and a landed
  // step invalidates these immediately. This catches a stream that went quiet
  // without erroring.
  const messagesResult = useQuery({
    ...messagesQuery(session.id),
    refetchInterval: POLL_MS,
  });
  const permissionsResult = useQuery({
    ...permissionsQuery(session.id),
    refetchInterval: POLL_MS,
  });
  const formsResult = useQuery({
    ...formsQuery(session.id),
    refetchInterval: POLL_MS,
  });

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

  const { live, running } = useLiveMessage(
    session.id,
    invalidateMessages,
    invalidateDock,
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
    async (text: string, files: PromptFile[]) => {
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
      try {
        await sendPrompt(
          session.id,
          text,
          files,
          attachedSkills.map((skill) => ({ id: skill.id })),
        );
      } catch (sendError) {
        setOptimistic(null);
        optimisticAt.current = null;
        throw sendError;
      }
      setAttachedSkills([]);
      void invalidateMessages();
    },
    [session.id, attachedSkills, invalidateMessages],
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
  const rendered = [
    ...withApprovals,
    ...(optimistic ? [optimistic] : []),
    ...(live ? [live] : isRunning ? [THINKING] : []),
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


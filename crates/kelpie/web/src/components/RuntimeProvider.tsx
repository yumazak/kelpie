import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  createMessageQueue,
  useExternalStoreRuntime,
  type AppendMessage,
  type CompleteAttachment,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import type { PromptFile } from "../api";

// kelpie owns the transcript; assistant-ui renders it. `ExternalStoreRuntime`
// is the seam: messages in, and `onNew` out — a submitted composer message
// (with any attachments) becomes a prompt on the session.

/** Base64 of a UTF-8 string, for a `data:` URI. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Turn assistant-ui attachments into opencode `FileAttachment`s. An image
 * arrives as a `data:` URL already; a text attachment is inlined as one.
 */
function filesFromAttachments(
  attachments: readonly CompleteAttachment[] | undefined,
): PromptFile[] {
  const files: PromptFile[] = [];
  for (const attachment of attachments ?? []) {
    for (const part of attachment.content) {
      if (part.type === "image" && typeof part.image === "string") {
        files.push({ uri: part.image, name: part.filename ?? attachment.name });
      } else if (part.type === "file" && typeof part.data === "string") {
        files.push({
          uri: `data:${part.mimeType || "application/octet-stream"};base64,${part.data}`,
          name: part.filename ?? attachment.name,
        });
      } else if (part.type === "text" && typeof part.text === "string") {
        files.push({
          uri: `data:text/plain;base64,${toBase64(part.text)}`,
          name: attachment.name,
        });
      }
    }
  }
  return files;
}

export function RuntimeProvider({
  messages,
  isRunning,
  isLoading,
  onNew,
  onCancel,
  onPermissionReply,
  children,
}: {
  messages: ThreadMessageLike[];
  isRunning: boolean;
  isLoading?: boolean;
  onNew: (text: string, files: PromptFile[]) => Promise<void>;
  onCancel: () => Promise<void>;
  onPermissionReply: (
    id: string,
    decision: "once" | "always" | "reject",
  ) => Promise<void>;
  children: ReactNode;
}) {
  // Both the plain send and the queued send funnel through here.
  const sendAppend = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
      const files = filesFromAttachments(message.attachments);
      if (!text.trim() && files.length === 0) return;
      await onNew(text, files);
    },
    [onNew],
  );

  // A message composed while a turn is still running goes straight to the
  // session — opencode queues / steers it — instead of the composer blocking.
  // `createMessageQueue` is assistant-ui's opt-in for keeping it usable.
  const queue = useMemo(
    () =>
      createMessageQueue({
        run: (message) => {
          void sendAppend(message);
        },
        cancel: () => {
          void onCancel();
        },
      }),
    [sendAppend, onCancel],
  );

  // Drive the queue's busy/idle edges: while a turn runs, a composed message is
  // held and shown as pending; it dispatches when the turn ends.
  useEffect(() => {
    if (isRunning) queue.notifyBusy();
    else queue.notifyIdle();
  }, [isRunning, queue]);

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    // While a turn is in flight, assistant-ui swaps the composer's send button
    // for its own cancel button and emits a "thinking" indicator part.
    isRunning,
    // While the first fetch lands, assistant-ui renders its own history
    // skeleton instead of our own placeholder.
    isLoading,
    onCancel,
    // The tool card renders the approval; its answer comes back here.
    onRespondToToolApproval: (options) => {
      const decision =
        options.optionId === "always"
          ? "always"
          : options.optionId === "reject" || options.approved === false
            ? "reject"
            : "once";
      return onPermissionReply(options.approvalId, decision);
    },
    messages,
    convertMessage: (message) => message,
    // The composer's attach button needs an adapter; without one it does
    // nothing. Images and text are the two a phone can usefully pick.
    adapters: {
      attachments: new CompositeAttachmentAdapter([
        new SimpleImageAttachmentAdapter(),
        new SimpleTextAttachmentAdapter(),
      ]),
    },
    // Keep the composer usable during a run: a submitted message goes to the
    // session through the queue instead of being blocked.
    queue: queue.adapter,
    onNew: sendAppend,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

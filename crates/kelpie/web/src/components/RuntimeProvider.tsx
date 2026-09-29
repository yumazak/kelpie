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
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

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
  onNew: (
    text: string,
    files: PromptFile[],
    delivery?: "queue" | "steer",
  ) => Promise<void>;
  onCancel: () => Promise<void>;
  onPermissionReply: (
    id: string,
    decision: "once" | "always" | "reject",
  ) => Promise<void>;
  children: ReactNode;
}) {
  // Read through a ref so the composer's submit callback stays stable across
  // the running/idle edge while still knowing which state it fired in.
  const runningRef = useRef(isRunning);
  useEffect(() => {
    runningRef.current = isRunning;
  }, [isRunning]);

  // Both the plain send and the queued send funnel through here.
  const sendAppend = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
      const files = filesFromAttachments(message.attachments);
      if (!text.trim() && files.length === 0) return;
      // A prompt composed while a turn is in flight joins opencode's own inbox
      // and runs when the turn ends; it never interrupts. The inbox list is
      // what the thread shows as "送信待ち", so both clients see one queue.
      await onNew(text, files, runningRef.current ? "queue" : undefined);
    },
    [onNew],
  );

  // assistant-ui only keeps the composer usable during a run when a queue
  // adapter is present — without one the send button is replaced by cancel.
  // This queue is a pass-through: `run` fires as soon as the prompt is
  // submitted and hands it to the session, so nothing is ever held locally.
  const queue = useMemo(
    () =>
      createMessageQueue({
        run: (message) => {
          void sendAppend(message);
          // `advance()` marks the queue running before calling `run`. The
          // prompt is already on its way, so clear that here: otherwise the
          // next compose would be held behind this one.
          queue.notifyIdle();
        },
      }),
    [sendAppend],
  );

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
    // Keep the composer usable during a run. The adapter is a pass-through (see
    // above): it only advertises the `queue` capability so the send button stays
    // available while a turn is in flight.
    queue: queue.adapter,
    onNew: sendAppend,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

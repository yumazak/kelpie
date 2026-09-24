import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  useExternalStoreRuntime,
  type AppendMessage,
  type CompleteAttachment,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ReactNode } from "react";

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
  children,
}: {
  messages: ThreadMessageLike[];
  isRunning: boolean;
  isLoading?: boolean;
  onNew: (text: string, files: PromptFile[]) => Promise<void>;
  onCancel: () => Promise<void>;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    // While a turn is in flight, assistant-ui swaps the composer's send button
    // for its own cancel button and emits a "thinking" indicator part.
    isRunning,
    // While the first fetch lands, assistant-ui renders its own history
    // skeleton instead of our own placeholder.
    isLoading,
    onCancel,
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
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
      const files = filesFromAttachments(message.attachments);
      if (!text.trim() && files.length === 0) return;
      await onNew(text, files);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

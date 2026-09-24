import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ReactNode } from "react";

// kelpie owns the transcript; assistant-ui renders it. `ExternalStoreRuntime`
// is the seam: messages in, and `onNew` out — a submitted composer message
// becomes a reply typed into the pane.
export function RuntimeProvider({
  messages,
  onNew,
  children,
}: {
  messages: ThreadMessageLike[];
  onNew: (text: string) => Promise<void>;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    isRunning: false,
    messages,
    convertMessage: (message) => message,
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
      if (!text.trim()) return;
      await onNew(text);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

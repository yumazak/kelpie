// Build the in-progress assistant turn from the service's live deltas.
//
// opencode streams `session.text.delta` / `session.reasoning.delta` while the
// model writes, so the phone can render token by token instead of waiting for
// the turn to land in the message list. The authoritative list is still fetched
// on `session.step.ended`; this is only the optimistic overlay.

import { useEffect, useRef, useState } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";

type LivePart = { kind: "text" | "reasoning"; text: string };

type Part = Exclude<NonNullable<ThreadMessageLike["content"]>, string>[number];

function partOf(entry: LivePart): Part {
  return entry.kind === "text"
    ? { type: "text", text: entry.text }
    : { type: "reasoning", text: entry.text };
}

export function useLiveMessage(
  sessionId: string,
  onStepEnd: () => Promise<void>,
  onDockEvent: () => void,
): { live: ThreadMessageLike | null; running: boolean } {
  const [live, setLive] = useState<ThreadMessageLike | null>(null);
  const [running, setRunning] = useState(false);
  const parts = useRef(new Map<string, LivePart>());

  useEffect(() => {
    const source = new EventSource(
      `/api/events?session=${encodeURIComponent(sessionId)}`,
    );

    const rebuild = () => {
      const content = [...parts.current.values()].map(partOf);
      if (content.length === 0) {
        setLive(null);
        return;
      }
      setLive({ id: "live", role: "assistant", content });
    };

    const append = (key: string, kind: LivePart["kind"], delta: string) => {
      const entry = parts.current.get(key) ?? { kind, text: "" };
      entry.text += delta;
      parts.current.set(key, entry);
      rebuild();
    };

    const replace = (key: string, kind: LivePart["kind"], text: string) => {
      const entry = parts.current.get(key);
      parts.current.set(key, { kind, text: text || entry?.text || "" });
      rebuild();
    };

    const onEvent = (message: MessageEvent<string>) => {
      let event: { type?: string; data?: Record<string, unknown> };
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      const type = event.type ?? "";
      const data = event.data ?? {};
      const ordinal = String(data.ordinal ?? 0);

      switch (type) {
        case "session.execution.started":
          setRunning(true);
          break;
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
          setRunning(false);
          break;
        case "session.text.started":
          parts.current.set(`text:${ordinal}`, { kind: "text", text: "" });
          rebuild();
          break;
        case "session.text.delta":
          append(`text:${ordinal}`, "text", String(data.delta ?? ""));
          break;
        case "session.text.ended":
          replace(`text:${ordinal}`, "text", String(data.text ?? ""));
          break;
        case "session.reasoning.started":
          parts.current.set(`reasoning:${ordinal}`, {
            kind: "reasoning",
            text: "",
          });
          rebuild();
          break;
        case "session.reasoning.delta":
          append(`reasoning:${ordinal}`, "reasoning", String(data.delta ?? ""));
          break;
        case "session.reasoning.ended":
          replace(`reasoning:${ordinal}`, "reasoning", String(data.text ?? ""));
          break;
        case "session.step.ended":
          // The turn is authoritative in the message list now; refetch, then
          // drop the overlay.
          void onStepEnd().finally(() => {
            parts.current.clear();
            setLive(null);
          });
          break;
        default:
          // A permission or form is pending; the dock re-fetches its lists.
          if (type.startsWith("permission.") || type.startsWith("form.")) {
            onDockEvent();
          }
          break;
      }
    };

    source.addEventListener("oc", onEvent as EventListener);
    return () => source.close();
  }, [sessionId, onStepEnd, onDockEvent]);

  return { live, running };
}

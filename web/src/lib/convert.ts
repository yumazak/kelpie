// Map opencode v2 messages onto assistant-ui's `ThreadMessageLike`.
//
// v2 is already structured: a `user` message carries `text`, an `assistant`
// message carries `content[]` of text / reasoning / tool parts. Nothing is
// scraped, so this is a straight rename.

import type { ThreadMessageLike, ToolCallMessagePart } from "@assistant-ui/react";

import type { OcMessage, OcPermission } from "../types";

type Part = Exclude<NonNullable<ThreadMessageLike["content"]>, string>[number];

/** A tool part's `state.content` is an array of `{ text }`; flatten it. */
function toolResult(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .map((entry) =>
        entry && typeof entry === "object" && "text" in entry
          ? String((entry as { text?: unknown }).text ?? "")
          : "",
      )
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n");
  }
  if (content == null) return undefined;
  return JSON.stringify(content);
}

/** A one-line gist of a tool call. */
function toolSummary(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const object = input as Record<string, unknown>;
  for (const key of [
    "command",
    "filePath",
    "file_path",
    "path",
    "pattern",
    "query",
    "url",
    "description",
  ]) {
    if (typeof object[key] === "string") return object[key] as string;
  }
  return "";
}

export { toolSummary };

/** A pending permission, as assistant-ui's tool-approval request. */
function approvalOf(
  permission: OcPermission,
): NonNullable<ToolCallMessagePart["approval"]> {
  return {
    id: permission.id,
    prompt: permission.message || permission.action || "この操作を許可しますか？",
    options: [
      { id: "once", kind: "allow-once", label: "許可" },
      { id: "always", kind: "allow-always", label: "常に許可" },
      { id: "reject", kind: "reject-once", label: "拒否" },
    ],
  };
}

/**
 * Attach each pending permission to the tool call it gates, so assistant-ui's
 * own tool card renders the approval inline. A permission with no tool source,
 * or one whose tool call already ran, is left alone.
 */
export function attachApprovals(
  messages: ThreadMessageLike[],
  permissions: OcPermission[],
): ThreadMessageLike[] {
  const pending = permissions.filter(
    (permission) => permission.source?.type === "tool",
  );
  if (pending.length === 0) return messages;

  return messages.map((message) => {
    // Assistant messages are keyed `a-<opencode message id>`.
    const rawId = message.id?.replace(/^a-/, "");
    const forMessage = pending.filter(
      (permission) => permission.source?.messageID === rawId,
    );
    if (forMessage.length === 0 || !Array.isArray(message.content)) {
      return message;
    }
    const content = message.content.map((part) => {
      if (part.type !== "tool-call") return part;
      const permission = forMessage.find(
        (candidate) => candidate.source?.id === part.toolCallId,
      );
      // A tool that already produced a result cannot be awaiting approval.
      if (!permission || part.result !== undefined) return part;
      return { ...part, approval: approvalOf(permission) };
    });
    return { ...message, content };
  });
}

/** The names of a user message's attachments, for a one-line note. */
function fileNames(files: unknown): string[] {
  if (!Array.isArray(files)) return [];
  return files
    .map((file) =>
      file && typeof file === "object" && "name" in file
        ? String((file as { name?: unknown }).name ?? "")
        : "",
    )
    .filter(Boolean);
}

export function toThreadMessages(messages: OcMessage[]): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];

  messages.forEach((message, index) => {
    const createdAt = message.time?.created
      ? new Date(message.time.created)
      : undefined;

    if (message.type === "user") {
      const text = typeof message.text === "string" ? message.text : "";
      const content: Part[] = [];
      if (text.trim()) content.push({ type: "text", text });
      const names = fileNames(message.files);
      if (names.length > 0) {
        content.push({
          type: "text",
          text: names.map((name) => `📎 ${name}`).join("\n"),
        });
      }
      if (content.length === 0) return;
      out.push({
        id: `u-${message.id ?? index}`,
        role: "user",
        createdAt,
        content,
      });
      return;
    }

    if (message.type !== "assistant") return;

    const content: Part[] = [];
    for (const part of message.content ?? []) {
      if (part.type === "text") {
        content.push({ type: "text", text: String(part.text ?? "") });
      } else if (part.type === "reasoning") {
        content.push({ type: "reasoning", text: String(part.text ?? "") });
      } else if (part.type === "tool") {
        const state = part.state ?? {};
        // While the input streams, `state.input` is raw text, not an object.
        const input = state.input;
        const streaming = typeof input === "string";
        content.push({
          type: "tool-call",
          toolCallId: part.id ?? `tool-${index}`,
          toolName: part.name ?? "tool",
          args: streaming ? {} : input,
          argsText: streaming ? input : JSON.stringify(input ?? {}),
          result: toolResult(state.content),
          isError: state.status === "error",
        } as Part);
      }
    }
    if (content.length === 0) return;
    out.push({
      id: `a-${message.id ?? index}`,
      role: "assistant",
      createdAt,
      content,
    });
  });

  return out;
}

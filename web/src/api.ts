import type {
  OcForm,
  OcMessagesResponse,
  OcPermission,
  OcSession,
  OcSessionsResponse,
  OcSkill,
} from "./types";

/** The API is same-origin; the dev server proxies `/api` to `kelpie serve`. */
async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      detail = [body.code, body.message].filter(Boolean).join(": ") || detail;
    } catch {
      /* not JSON — keep the status line */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

/** One page of sessions, newest first. Pass `cursor` for the next page. */
export function fetchSessions(cursor?: string): Promise<OcSessionsResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return getJson<OcSessionsResponse>(`/api/sessions${query}`);
}

/** One session, by id. */
export async function fetchSession(sessionId: string): Promise<OcSession> {
  const body = await getJson<{ data: OcSession }>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  return body.data;
}

/** One session's messages. */
export function fetchMessages(sessionId: string): Promise<OcMessagesResponse> {
  return getJson<OcMessagesResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
}

/** An opencode `FileAttachment`: a `file://` or `data:` URI. */
export interface PromptFile {
  uri: string;
  name?: string;
  description?: string;
}

/** An opencode `Prompt.SkillAttachment`: the skill's id. */
export interface PromptSkill {
  id: string;
}

/** The skills registered for a project directory. Skills are scoped to where
 *  the session runs, so it passes its own `location.directory`. */
export async function fetchSkills(directory?: string): Promise<OcSkill[]> {
  const query = directory ? `?directory=${encodeURIComponent(directory)}` : "";
  const body = await getJson<{ data: OcSkill[] }>(`/api/skills${query}`);
  return body.data ?? [];
}

/** Send a prompt to a session, with optional attachments and attached skills. */
export async function sendPrompt(
  sessionId: string,
  text: string,
  files: PromptFile[] = [],
  skills: PromptSkill[] = [],
): Promise<void> {
  const payload: Record<string, unknown> = { text };
  if (files.length > 0) payload.files = files;
  if (skills.length > 0) payload.skills = skills;
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (response.ok) return;
  let detail = `${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    detail = [body.code, body.message].filter(Boolean).join(": ") || detail;
  } catch {
    /* keep the status line */
  }
  throw new Error(detail);
}

/** Interrupt the running turn. */
export function interruptSession(sessionId: string): Promise<void> {
  return postJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/interrupt`,
    {},
  );
}

/** Delete a session and its child sessions. Destructive. */
export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (response.ok) return;
  let detail = `${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    detail = [body.code, body.message].filter(Boolean).join(": ") || detail;
  } catch {
    /* keep the status line */
  }
  throw new Error(detail);
}

/** Pending permission requests for a session. */
export async function fetchPermissions(
  sessionId: string,
): Promise<OcPermission[]> {
  const body = await getJson<{ data: OcPermission[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/permissions`,
  );
  return body.data ?? [];
}

/** Pending forms for a session. */
export async function fetchForms(sessionId: string): Promise<OcForm[]> {
  const body = await getJson<{ data: OcForm[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/forms`,
  );
  return body.data ?? [];
}

async function postJson(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  let detail = `${response.status} ${response.statusText}`;
  try {
    const parsed = (await response.json()) as { code?: string; message?: string };
    detail = [parsed.code, parsed.message].filter(Boolean).join(": ") || detail;
  } catch {
    /* keep the status line */
  }
  throw new Error(detail);
}

/** `decision` is `once` / `always` / `reject`. */
export function replyPermission(
  sessionId: string,
  requestId: string,
  decision: "once" | "always" | "reject",
): Promise<void> {
  return postJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/reply`,
    { decision },
  );
}

/** Answer a form: field key → value. */
export function replyForm(
  sessionId: string,
  formId: string,
  answer: Record<string, unknown>,
): Promise<void> {
  return postJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/forms/${encodeURIComponent(formId)}/reply`,
    { answer },
  );
}

/** The VAPID public key the browser subscribes with. */
export function fetchPushKey(): Promise<{ publicKey: string | null }> {
  return getJson<{ publicKey: string | null }>("/api/push/key");
}

/** Register this device for push. */
export function subscribePush(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<void> {
  return postJson("/api/push/subscribe", subscription);
}

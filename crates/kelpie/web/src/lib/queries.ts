// The query keys and query options the app shares.
//
// Keys are centralised so the event stream, the screens, and the mutations all
// point at the same cache entries. The list is an infinite query (older pages
// arrive through the cursor); everything else is a plain query keyed by session.

import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
  fetchForms,
  fetchInbox,
  fetchMessages,
  fetchPermissions,
  fetchProjects,
  fetchSession,
  fetchSessions,
  fetchSkills,
} from "../api";
import { queryClient } from "../query";
import type { OcMessage, OcMessagesResponse } from "../types";

export const sessionsKey = ["sessions"] as const;
export const projectsKey = ["projects"] as const;
export const sessionKey = (id: string) => ["session", id] as const;
export const messagesKey = (id: string) => ["messages", id] as const;
export const inboxKey = (id: string) => ["inbox", id] as const;
export const permissionsKey = (id: string) => ["permissions", id] as const;
export const formsKey = (id: string) => ["forms", id] as const;
export const skillsKey = (directory: string) => ["skills", directory] as const;

/** The cross-project list, newest first, paged through opencode's cursor. */
export const sessionsQuery = infiniteQueryOptions({
  queryKey: sessionsKey,
  queryFn: ({ pageParam }) => fetchSessions(pageParam),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last) => last.cursor?.next ?? undefined,
});

/** The repository names the list groups by. Worktrees change from outside the
 *  app and rarely, so this is cached rather than refetched with each event. */
export const projectsQuery = queryOptions({
  queryKey: projectsKey,
  queryFn: fetchProjects,
  staleTime: 5 * 60 * 1000,
});

export const sessionQuery = (id: string) =>
  queryOptions({
    queryKey: sessionKey(id),
    queryFn: () => fetchSession(id),
  });

/** Page sizes. A session opens on the newest page, pulls older pages as the
 *  reader scrolls up, and re-reads only a small newest slice on refresh. */
const MESSAGES_PAGE = 40;
const MESSAGES_POLL = 25;
/** The fallback when a burst outruns the refresh slice. */
const MESSAGES_FULL = 200;

/** Fold a freshly fetched newest slice over the history already cached:
 *  refresh the messages present in both, append the new ones. */
function mergeNewest(previous: OcMessage[], page: OcMessage[]): OcMessage[] {
  const fresh = new Map(page.map((message) => [message.id, message]));
  const updated = previous.map((message) => fresh.get(message.id) ?? message);
  const seen = new Set(previous.map((message) => message.id));
  const added = page.filter((message) => !seen.has(message.id));
  return [...updated, ...added];
}

export const messagesQuery = (id: string) =>
  queryOptions({
    queryKey: messagesKey(id),
    queryFn: async (): Promise<OcMessagesResponse> => {
      const previous = queryClient.getQueryData<OcMessagesResponse>(
        messagesKey(id),
      );
      if (!previous || previous.data.length === 0) {
        return fetchMessages(id, { limit: MESSAGES_PAGE });
      }
      const page = await fetchMessages(id, { limit: MESSAGES_POLL });
      const known = new Set(previous.data.map((message) => message.id));
      // If the newest slice does not reach back into the history we already
      // have, a burst added more messages than the slice covers. Taking the
      // full list then is rare and cheap enough, and avoids showing a gap.
      if (!page.data.some((message) => known.has(message.id))) {
        return fetchMessages(id, { limit: MESSAGES_FULL });
      }
      return { ...previous, data: mergeNewest(previous.data, page.data) };
    },
  });

/** Load one page of older messages into the cache. Returns whether the page
 *  brought anything new (so the caller can tell it reached the start). */
export async function loadOlderMessages(id: string): Promise<boolean> {
  const previous = queryClient.getQueryData<OcMessagesResponse>(
    messagesKey(id),
  );
  const cursor = previous?.cursor?.next ?? null;
  if (!previous || !cursor) return false;
  const page = await fetchMessages(id, { limit: MESSAGES_PAGE, cursor });
  const seen = new Set(previous.data.map((message) => message.id));
  const older = page.data.filter((message) => !seen.has(message.id));
  if (older.length === 0) return false;
  queryClient.setQueryData<OcMessagesResponse>(messagesKey(id), {
    data: [...older, ...previous.data],
    cursor: page.cursor,
  });
  return true;
}

export const permissionsQuery = (id: string) =>
  queryOptions({
    queryKey: permissionsKey(id),
    queryFn: () => fetchPermissions(id),
  });

/** The prompts opencode is holding for a running turn. The service owns this
 *  queue, so it is refetched rather than kept locally. */
export const inboxQuery = (id: string) =>
  queryOptions({
    queryKey: inboxKey(id),
    queryFn: () => fetchInbox(id),
  });

export const formsQuery = (id: string) =>
  queryOptions({
    queryKey: formsKey(id),
    queryFn: () => fetchForms(id),
  });

/** The skills offered for a project. They come from disk and change rarely, so
 *  they are cached rather than refetched on every composer open. */
export const skillsQuery = (directory: string) =>
  queryOptions({
    queryKey: skillsKey(directory),
    queryFn: () => fetchSkills(directory || undefined),
    staleTime: 5 * 60 * 1000,
  });

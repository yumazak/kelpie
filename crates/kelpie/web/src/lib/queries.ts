// The query keys and query options the app shares.
//
// Keys are centralised so the event stream, the screens, and the mutations all
// point at the same cache entries. The list is an infinite query (older pages
// arrive through the cursor); everything else is a plain query keyed by session.

import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
  fetchForms,
  fetchMessages,
  fetchPermissions,
  fetchProjects,
  fetchSession,
  fetchSessions,
  fetchSkills,
} from "../api";
import { queryClient } from "../query";
import type { OcMessagesResponse } from "../types";

export const sessionsKey = ["sessions"] as const;
export const projectsKey = ["projects"] as const;
export const sessionKey = (id: string) => ["session", id] as const;
export const messagesKey = (id: string) => ["messages", id] as const;
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

/** How much history to load when a session first opens, and how much to re-read
 *  on every refresh. A full list is megabytes, so refreshes pull only the
 *  newest slice and fold it over the history already in the cache. */
const MESSAGES_FULL = 200;
const MESSAGES_POLL = 25;

/** Fold a freshly fetched newest slice over the history already cached:
 *  refresh the messages present in both, append the new ones. */
function mergeMessages(
  previous: OcMessagesResponse,
  page: OcMessagesResponse,
): OcMessagesResponse {
  const fresh = new Map(page.data.map((message) => [message.id, message]));
  const updated = previous.data.map(
    (message) => fresh.get(message.id) ?? message,
  );
  const seen = new Set(previous.data.map((message) => message.id));
  const added = page.data.filter((message) => !seen.has(message.id));
  return {
    ...previous,
    cursor: page.cursor ?? previous.cursor,
    data: [...updated, ...added],
  };
}

export const messagesQuery = (id: string) =>
  queryOptions({
    queryKey: messagesKey(id),
    queryFn: async () => {
      const previous = queryClient.getQueryData<OcMessagesResponse>(
        messagesKey(id),
      );
      const page = await fetchMessages(
        id,
        previous ? MESSAGES_POLL : MESSAGES_FULL,
      );
      return previous ? mergeMessages(previous, page) : page;
    },
  });

export const permissionsQuery = (id: string) =>
  queryOptions({
    queryKey: permissionsKey(id),
    queryFn: () => fetchPermissions(id),
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

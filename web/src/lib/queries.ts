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
  fetchSession,
  fetchSessions,
} from "../api";

export const sessionsKey = ["sessions"] as const;
export const sessionKey = (id: string) => ["session", id] as const;
export const messagesKey = (id: string) => ["messages", id] as const;
export const permissionsKey = (id: string) => ["permissions", id] as const;
export const formsKey = (id: string) => ["forms", id] as const;

/** The cross-project list, newest first, paged through opencode's cursor. */
export const sessionsQuery = infiniteQueryOptions({
  queryKey: sessionsKey,
  queryFn: ({ pageParam }) => fetchSessions(pageParam),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last) => last.cursor?.next ?? undefined,
});

export const sessionQuery = (id: string) =>
  queryOptions({
    queryKey: sessionKey(id),
    queryFn: () => fetchSession(id),
  });

export const messagesQuery = (id: string) =>
  queryOptions({
    queryKey: messagesKey(id),
    queryFn: () => fetchMessages(id),
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

import { createContext, useContext } from "react";

import type { useSessions } from "../hooks/useSessions";

/**
 * The session list, fetched once by the root route and shared by both screens.
 * Keeping it in one place means one event stream and one cache entry, no
 * matter how many routes read it.
 */
export type SessionsValue = ReturnType<typeof useSessions>;

const SessionsContext = createContext<SessionsValue | null>(null);

export const SessionsProvider = SessionsContext.Provider;

export function useSessionsContext(): SessionsValue {
  const value = useContext(SessionsContext);
  if (!value) throw new Error("useSessionsContext outside the root route");
  return value;
}

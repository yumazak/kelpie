import type { OcSession } from "../types";

/**
 * Whether a session has a turn the viewer has not seen. opencode stamps
 * `time.idle` on every completed turn and `time.viewed` when a client reports
 * having displayed it (`POST /api/session/{id}/view`). A session is unread when
 * the last completed turn is newer than the last one seen.
 *
 * A session with no completed turn yet is never unread — there is nothing to
 * have missed. `time.viewed` is shared across every client, so reading the
 * session in the TUI clears the marker here too.
 */
export function isUnread(session: OcSession): boolean {
  const idle = session.time?.idle;
  if (idle === undefined) return false;
  const viewed = session.time?.viewed;
  return viewed === undefined || viewed < idle;
}

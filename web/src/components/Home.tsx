import { cn } from "@/lib/utils";
import type { OcSession, OcSessionsResponse } from "../types";
import { NotifyButton } from "./NotifyButton";

function basename(path?: string): string {
  if (!path) return "(unknown)";
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

function relative(ms?: number): string {
  if (!ms) return "";
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function statusColor(session: OcSession): string {
  if (session.outcome === "failed") return "bg-red-500";
  if (session.outcome === "interrupted") return "bg-amber-400";
  if (session.time?.idle) return "bg-emerald-500";
  return "bg-amber-400";
}

/** Every session, grouped by the directory it ran in. */
export function Home({
  state,
  error,
  onSelect,
}: {
  state: OcSessionsResponse | null;
  error: string | null;
  onSelect: (session: OcSession) => void;
}) {
  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }
  if (!state) {
    return <div className="p-6 text-sm text-muted-foreground">接続中…</div>;
  }

  const groups = new Map<string, OcSession[]>();
  for (const session of state.sessions) {
    const key = session.location?.directory ?? "(unknown)";
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const latest = (sessions: OcSession[]) =>
      Math.max(...sessions.map((session) => session.time?.updated ?? 0));
    return latest(b[1]) - latest(a[1]);
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <header className="mb-5 flex items-center justify-between">
        <div className="text-lg font-semibold">kelpie</div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">
            opencode · {state.sessions.length} sessions
          </div>
          <NotifyButton />
        </div>
      </header>

      {ordered.length === 0 && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          セッションがありません
        </div>
      )}

      {ordered.map(([directory, sessions]) => (
        <section key={directory} className="mb-6">
          <h2 className="mb-2 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {basename(directory)}
          </h2>
          <div className="flex flex-col gap-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-accent"
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    statusColor(session),
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {session.title || session.id}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[session.agent, relative(session.time?.updated)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

import { useState } from "react";
import { EllipsisVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deleteSession } from "../api";
import type { OcSession, OcSessionsResponse } from "../types";

type Tab = "recent" | "all";

/** "Recently worked on": updated within the last day. */
const RECENT_MS = 24 * 60 * 60 * 1000;

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
  if (session.active) return "animate-pulse bg-sky-400";
  if (session.outcome === "failed") return "bg-red-500";
  if (session.outcome === "interrupted") return "bg-amber-400";
  if (session.time?.idle) return "bg-emerald-500";
  return "bg-amber-400";
}

/** Every session, grouped by the directory it ran in, behind two tabs. */
export function Home({
  state,
  error,
  onSelect,
  onRefresh,
}: {
  state: OcSessionsResponse | null;
  error: string | null;
  onSelect: (session: OcSession) => void;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("recent");
  const [pendingDelete, setPendingDelete] = useState<OcSession | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }
  if (!state) {
    return <div className="p-6 text-sm text-muted-foreground">接続中…</div>;
  }

  // The list re-renders on every poll, so reading the clock here is what keeps
  // "recent" current.
  // eslint-disable-next-line react/purity
  const cutoff = Date.now() - RECENT_MS;
  const recent = state.sessions.filter(
    (session) => (session.time?.updated ?? 0) > cutoff,
  );
  const shown = tab === "recent" ? recent : state.sessions;

  const groups = new Map<string, OcSession[]>();
  for (const session of shown) {
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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await deleteSession(pendingDelete.id);
      await onRefresh();
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <header className="mb-4 flex items-center justify-between">
        <div className="text-lg font-semibold">kelpie</div>
        <div className="text-xs text-muted-foreground">opencode</div>
      </header>

      <div className="mb-4 flex gap-1 rounded-xl bg-muted/50 p-1 text-sm">
        <TabButton
          active={tab === "recent"}
          onClick={() => setTab("recent")}
          label="最近"
          count={recent.length}
        />
        <TabButton
          active={tab === "all"}
          onClick={() => setTab("all")}
          label="すべて"
          count={state.sessions.length}
        />
      </div>

      {ordered.length === 0 && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {tab === "recent"
            ? "24時間以内のセッションはありません"
            : "セッションがありません"}
        </div>
      )}

      {ordered.map(([directory, sessions]) => (
        <section key={directory} className="mb-6">
          <h2 className="mb-2 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {basename(directory)}
          </h2>
          <div className="flex flex-col gap-1">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-1 rounded-xl hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => onSelect(session)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left"
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
                <button
                  type="button"
                  aria-label="セッションの操作"
                  onClick={() => setPendingDelete(session)}
                  className="mr-1 rounded-lg p-2 text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <EllipsisVertical className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>セッションを削除</DialogTitle>
            <DialogDescription>
              「{pendingDelete?.title || pendingDelete?.id}
              」を削除します。子セッションも含めて元に戻せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-lg px-3 py-1.5 transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label} <span className="text-xs opacity-70">{count}</span>
    </button>
  );
}

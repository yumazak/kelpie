import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EllipsisVertical } from "lucide-react";
import {
  AssistantRuntimeProvider,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type ExternalStoreThreadData,
  type ThreadMessageLike,
} from "@assistant-ui/react";

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
import type { OcSession } from "../types";
import { ErrorState } from "./ErrorState";
import { NotifyButton } from "./NotifyButton";
import { Dots } from "./loading-ui/dots";
import { Skeleton } from "./ui/skeleton";

/** The display data a row needs, carried on each thread's `custom`. */
type Row = {
  directory: string;
  agent?: string;
  updated?: number;
  active?: boolean;
  outcome?: string;
  /** Timestamp of the last idle transition, when there is one. */
  idle?: number;
};

/** Opens the row menu for the session with this id. */
const MoreContext = createContext<(id: string) => void>(() => {});

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

function dotClass(row: Partial<Row>): string {
  if (row.active) return "animate-pulse bg-sky-400";
  if (row.outcome === "failed") return "bg-red-500";
  if (row.outcome === "interrupted") return "bg-amber-400";
  if (row.idle) return "bg-emerald-500";
  return "bg-amber-400";
}

/** A session as an assistant-ui thread list entry. */
function toThread(session: OcSession): ExternalStoreThreadData<"regular"> {
  return {
    status: "regular",
    id: session.id,
    title: session.title || session.id,
    custom: {
      directory: session.location?.directory ?? "",
      agent: session.agent,
      updated: session.time?.updated,
      active: session.active === true,
      outcome: session.outcome,
      idle: session.time?.idle,
    } satisfies Row as unknown as Record<string, unknown>,
  };
}

/** Every session, grouped by the directory it ran in. Older pages stream in as
 *  the list is scrolled. */
export function Home({
  sessions,
  error,
  loading,
  hasMore,
  onLoadMore,
  onSelect,
  onRefresh,
}: {
  sessions: OcSession[];
  error: string | null;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  onSelect: (session: OcSession) => void;
  onRefresh: () => Promise<void>;
}) {
  const [pendingDelete, setPendingDelete] = useState<OcSession | null>(null);
  const [busy, setBusy] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll: pull the next page as the sentinel nears the viewport.
  // `sessions.length` in the deps re-arms the observer after each append, so a
  // list still shorter than the screen keeps loading.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void onLoadMore();
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, sessions.length]);

  if (error) {
    return <ErrorState detail={error} onRetry={() => void onRefresh()} />;
  }
  if (loading && sessions.length === 0) {
    return <HomeSkeleton />;
  }

  const groups = new Map<string, OcSession[]>();
  for (const session of sessions) {
    const key = session.location?.directory ?? "(unknown)";
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const latest = (items: OcSession[]) =>
      Math.max(...items.map((session) => session.time?.updated ?? 0));
    return latest(b[1]) - latest(a[1]);
  });

  // assistant-ui builds its thread-list runtime once, at mount, from the
  // threads it is handed, and only syncs a new set afterwards (in an effect).
  // Rendering a larger set before that sync would index past the runtime and
  // throw. Remount whenever the displayed set changes, so the runtime always
  // matches what is on screen.
  const listKey = ordered
    .flatMap(([, items]) => items.map((session) => session.id))
    .join("|");

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

  const openMenu = (id: string) =>
    setPendingDelete(sessions.find((session) => session.id === id) ?? null);

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-5">
      <header className="mb-4 flex items-center justify-between">
        <div className="text-lg font-semibold">kelpie</div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">opencode</div>
          <NotifyButton />
        </div>
      </header>

      {sessions.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          セッションがありません
        </div>
      ) : (
        <MoreContext.Provider value={openMenu}>
          <HomeThreadList key={listKey} groups={ordered} onSelect={onSelect} />
        </MoreContext.Provider>
      )}

      <div ref={sentinelRef} className="h-8" aria-hidden />
      {hasMore && (
        <div className="flex items-center justify-center gap-2 pb-4 text-xs text-muted-foreground">
          <Dots className="h-1.5 w-5" />
          読み込み中
        </div>
      )}

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

/**
 * assistant-ui's thread list, grouped by directory. The runtime carries only
 * the list — the messages live in the chat's own runtime — so switching a
 * thread just navigates.
 */
function HomeThreadList({
  groups,
  onSelect,
}: {
  groups: Array<[string, OcSession[]]>;
  onSelect: (session: OcSession) => void;
}) {
  const { threads, indexOf, byId } = useMemo(() => {
    const threads: ExternalStoreThreadData<"regular">[] = [];
    const indexOf = new Map<string, number>();
    const byId = new Map<string, OcSession>();
    for (const [, sessions] of groups) {
      for (const session of sessions) {
        indexOf.set(session.id, threads.length);
        byId.set(session.id, session);
        threads.push(toThread(session));
      }
    }
    return { threads, indexOf, byId };
  }, [groups]);

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: [],
    convertMessage: (message) => message,
    onNew: async () => {},
    adapters: {
      threadList: {
        threads,
        onSwitchToThread: (id) => {
          const session = byId.get(id);
          if (session) onSelect(session);
        },
      },
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadListPrimitive.Root className="flex flex-col">
        {groups.map(([directory, sessions]) => (
          <section key={directory} className="mb-6">
            <h2 className="mb-2 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {basename(directory)}
            </h2>
            <div className="flex flex-col gap-1">
              {sessions.map((session) => (
                <ThreadListPrimitive.ItemByIndex
                  key={session.id}
                  index={indexOf.get(session.id) ?? 0}
                  components={{ ThreadListItem: KelpieThreadListItem }}
                />
              ))}
            </div>
          </section>
        ))}
      </ThreadListPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

/** One session row, rendered by assistant-ui's thread list item primitives. */
function KelpieThreadListItem() {
  const item = useAuiState((state) => state.threadListItem);
  const openMenu = useContext(MoreContext);
  const row = (item.custom ?? {}) as Partial<Row>;

  return (
    <ThreadListItemPrimitive.Root className="flex items-center gap-1 rounded-xl hover:bg-accent">
      <ThreadListItemPrimitive.Trigger className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left">
        <span className={cn("size-2 shrink-0 rounded-full", dotClass(row))} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            <ThreadListItemPrimitive.Title fallback={item.id} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[row.agent, relative(row.updated)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </ThreadListItemPrimitive.Trigger>
      <button
        type="button"
        aria-label="セッションの操作"
        onClick={() => openMenu(item.id)}
        className="mr-1 rounded-lg p-2 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <EllipsisVertical className="size-4" />
      </button>
    </ThreadListItemPrimitive.Root>
  );
}

/** A list-shaped placeholder while the first fetch lands. */
function HomeSkeleton() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <Skeleton className="mb-4 h-6 w-24" />
      <Skeleton className="mb-5 h-9 w-full rounded-xl" />
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <Skeleton key={row} className="mb-2 h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

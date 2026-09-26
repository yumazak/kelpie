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
import { isUnread } from "../lib/read";
import type { OcProject, OcSession } from "../types";
import { ErrorState } from "./ErrorState";
import { NotifyButton } from "./NotifyButton";
import { Dots } from "./loading-ui/dots";
import { Skeleton } from "./ui/skeleton";

/** The display data a row needs, carried on each thread's `custom`. */
type Row = {
  agent?: string;
  updated?: number;
  active?: boolean;
  outcome?: string;
  /** Timestamp of the last idle transition, when there is one. */
  idle?: number;
  /** A completed turn the viewer has not seen yet. */
  unread?: boolean;
  /** Waiting on the user: a permission prompt or a form. */
  pending?: "permission" | "form" | null;
};

/** The sessions of one worktree (directory) inside a repository. */
type DirectoryGroup = {
  directory: string;
  label: string;
  sessions: OcSession[];
};

/** A repository. opencode groups the worktrees of one repository under a single
 *  `projectID`, so all of its checkouts land in one repo group. */
type RepoGroup = {
  key: string;
  name: string;
  directories: DirectoryGroup[];
};

/** Opens the row menu for the session with this id. */
const MoreContext = createContext<(id: string) => void>(() => {});

function basename(path?: string): string {
  if (!path) return "(unknown)";
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/** The newest update in a set of sessions, for ordering groups by recency. */
function latest(sessions: OcSession[]): number {
  return Math.max(...sessions.map((session) => session.time?.updated ?? 0));
}

/** The label for a worktree inside its repository. The main checkout reads
 *  "main"; every other directory is a worktree, named by its branch (the last
 *  path segment). Until `/api/projects` lands we only know the path, so a
 *  directory whose basename matches the repo is treated as the main checkout. */
function directoryLabel(
  directory: string,
  project: OcProject | undefined,
  repoName: string,
): string {
  if (project?.base) {
    return directory === project.base ? "main" : basename(directory);
  }
  const label = basename(directory);
  return label === repoName ? "main" : label;
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
  // A session waiting on the user outranks everything else: it needs an answer.
  if (row.pending) return "bg-orange-400";
  if (row.active) return "animate-pulse bg-sky-400";
  if (row.outcome === "failed") return "bg-red-500";
  if (row.outcome === "interrupted") return "bg-amber-400";
  // The green dot marks an unread completed turn; once read it is gone.
  if (row.unread) return "bg-emerald-500";
  if (row.idle) return "";
  return "bg-amber-400";
}

/** Hover text for the status dot, where one helps. */
function dotLabel(row: Partial<Row>): string | undefined {
  if (row.pending === "permission") return "許可待ち";
  if (row.pending === "form") return "回答待ち";
  return undefined;
}

/** A session as an assistant-ui thread list entry. */
function toThread(session: OcSession): ExternalStoreThreadData<"regular"> {
  return {
    status: "regular",
    id: session.id,
    title: session.title || session.id,
    custom: {
      agent: session.agent,
      updated: session.time?.updated,
      active: session.active === true,
      outcome: session.outcome,
      idle: session.time?.idle,
      unread: isUnread(session),
      pending: session.pending ?? null,
    } satisfies Row as unknown as Record<string, unknown>,
  };
}

/** Every session, grouped by repository and then by the directory (worktree)
 *  it ran in. Older pages stream in as the list is scrolled. */
export function Home({
  sessions,
  projects,
  error,
  loading,
  hasMore,
  onLoadMore,
  onSelect,
  onRefresh,
}: {
  sessions: OcSession[];
  /** Repository names, keyed by `projectID`. Empty until `/api/projects` lands,
   *  in which case grouping falls back to the bare directory. */
  projects: OcProject[];
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

  // Group by repository first (all of a repository's worktrees share one
  // `projectID`), then by the directory each session ran in.
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const byProject = new Map<string, Map<string, OcSession[]>>();
  for (const session of sessions) {
    const directory = session.location?.directory ?? "";
    const key = session.projectID ?? `directory:${directory || "(unknown)"}`;
    const directories = byProject.get(key) ?? new Map<string, OcSession[]>();
    const list = directories.get(directory) ?? [];
    list.push(session);
    directories.set(directory, list);
    byProject.set(key, directories);
  }

  const ordered: RepoGroup[] = [...byProject.entries()]
    .map(([key, directories]) => {
      const project = projectById.get(key);
      const name =
        project?.name || basename(project?.canonical || [...directories.keys()][0]);
      const groups = [...directories.entries()]
        .map(([directory, list]) => ({
          directory,
          label: directoryLabel(directory, project, name),
          sessions: list,
        }))
        .sort((a, b) => latest(b.sessions) - latest(a.sessions));
      return { key, name, directories: groups };
    })
    .sort(
      (a, b) =>
        Math.max(...b.directories.map((group) => latest(group.sessions))) -
        Math.max(...a.directories.map((group) => latest(group.sessions))),
    );

  // assistant-ui builds its thread-list runtime once, at mount, from the
  // threads it is handed, and only syncs a new set afterwards (in an effect).
  // Rendering a larger set before that sync would index past the runtime and
  // throw. Remount whenever the displayed set changes, so the runtime always
  // matches what is on screen.
  const listKey = ordered
    .flatMap((repo) => repo.directories)
    .flatMap((group) => group.sessions.map((session) => session.id))
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
 * assistant-ui's thread list, grouped by repository and then directory. The
 * runtime carries only the list — the messages live in the chat's own runtime —
 * so switching a thread just navigates.
 */
function HomeThreadList({
  groups,
  onSelect,
}: {
  groups: RepoGroup[];
  onSelect: (session: OcSession) => void;
}) {
  const { threads, indexOf, byId } = useMemo(() => {
    const threads: ExternalStoreThreadData<"regular">[] = [];
    const indexOf = new Map<string, number>();
    const byId = new Map<string, OcSession>();
    for (const repo of groups) {
      for (const group of repo.directories) {
        for (const session of group.sessions) {
          indexOf.set(session.id, threads.length);
          byId.set(session.id, session);
          threads.push(toThread(session));
        }
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
        {groups.map((repo) => (
          <section key={repo.key} className="mb-6">
            <h2 className="mb-2 truncate px-1 text-sm font-semibold">
              {repo.name}
            </h2>
            <div className="flex flex-col gap-3">
              {repo.directories.map((group) => (
                <div key={group.directory || "(unknown)"}>
                  <h3 className="mb-1 truncate px-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {group.label}
                  </h3>
                  <div className="flex flex-col gap-1">
                    {group.sessions.map((session) => (
                      <ThreadListPrimitive.ItemByIndex
                        key={session.id}
                        index={indexOf.get(session.id) ?? 0}
                        components={{ ThreadListItem: KelpieThreadListItem }}
                      />
                    ))}
                  </div>
                </div>
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
        <span
          className={cn("size-2 shrink-0 rounded-full", dotClass(row))}
          title={dotLabel(row)}
        />
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

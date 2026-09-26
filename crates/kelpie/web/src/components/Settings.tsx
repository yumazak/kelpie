import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { sendTestPush } from "../api";
import {
  currentPushState,
  disablePush,
  enablePush,
  type PushState,
} from "../lib/push";
import { useSessionsContext } from "../lib/sessions-context";
import { compareVersions, fetchLatestInstallable } from "../lib/updates";

const DOCS = "https://yumazak.github.io/kelpie/";
const GITHUB = "https://github.com/yumazak/kelpie";
const LICENSE = "https://github.com/yumazak/kelpie/blob/main/LICENSE";
const COLLIE = "https://github.com/AltanS/collie";

/** `/settings` — the screen behind the mark in the list header. */
export function Settings({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 rounded-lg px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="戻る"
        >
          ←
        </button>
        <div className="text-sm font-medium">設定</div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-5">
          <Notifications />
          <About />
        </div>
      </div>
    </div>
  );
}

/** One titled group of rows, drawn as a single bordered region. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-xs font-medium text-muted-foreground">
        {label}
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

/** A row: what the thing is, an optional line under it, an optional control. */
function Row({
  label,
  detail,
  action,
}: {
  label: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-3">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {detail ? (
          <div className="mt-0.5 text-xs break-words text-muted-foreground">
            {detail}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const PUSH_DETAIL: Record<PushState, string> = {
  on: "この端末は購読済みです",
  off: "許可待ち・質問・完了を、スマホの通知で受け取ります",
  denied:
    "通知が拒否されています。iOS は 設定アプリ → 通知 → kelpie で許可してください",
  unsupported:
    "この端末では使えません。通知には HTTPS が要ります(tailnet の URL で開いてください)",
};

function Notifications() {
  const [state, setState] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    void currentPushState().then(setState);
  }, []);

  const toggle = async () => {
    setBusy(true);
    setResult(null);
    try {
      setState(state === "on" ? await disablePush() : await enablePush());
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const count = await sendTestPush();
      setResult(
        count === 0 ? "購読している端末がありません" : `${count} 台に送りました`,
      );
    } catch (cause) {
      setResult(`送れませんでした: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group label="通知">
      <Row
        label="この端末"
        detail={PUSH_DETAIL[state]}
        action={
          state === "on" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void toggle()}
            >
              解除
            </Button>
          ) : state === "off" ? (
            <Button size="sm" disabled={busy} onClick={() => void toggle()}>
              有効にする
            </Button>
          ) : null
        }
      />
      {state === "on" ? (
        <Row
          label="テスト通知"
          detail={
            result ?? "この端末を含む、購読しているすべての端末に 1 通送ります"
          }
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void test()}
            >
              送る
            </Button>
          }
        />
      ) : null}
    </Group>
  );
}

function About() {
  const { version } = useSessionsContext();
  const [latest, setLatest] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setLatest(await fetchLatestInstallable());
    } catch (cause) {
      setError(String(cause));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // "Latest" means the newest release `mise` could actually take, so a tag whose
  // binary is still uploading is not one — see `lib/updates.ts`, and the
  // `kelpie-update` skill whose script makes the same call.
  const newer =
    version !== "" && latest !== null && compareVersions(latest, version) > 0;

  let status: string;
  if (checking) status = "確認中…";
  else if (error) status = `確認できませんでした(${error})`;
  else if (latest === null) status = "install できるリリースが見つかりません";
  else if (newer) status = `${latest} が公開されています`;
  else status = `最新です(${latest})`;

  return (
    <Group label="このアプリ">
      <Row label="バージョン" detail={version || "—"} />
      <Row
        label="最新版"
        detail={status}
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={checking}
            onClick={() => void check()}
          >
            確認
          </Button>
        }
      />
      <ExternalLink label="ドキュメント" href={DOCS} note="yumazak.github.io" />
      <ExternalLink label="GitHub" href={GITHUB} note="yumazak/kelpie" />
      <ExternalLink label="ライセンス" href={LICENSE} note="MIT" />
      <ExternalLink label="クレジット" href={COLLIE} note="collie の意匠から" />
    </Group>
  );
}

/** A row that leaves the app. The arrow says so before the tap does. */
function ExternalLink({
  label,
  href,
  note,
}: {
  label: string;
  href: string;
  note: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-accent"
    >
      <span className="text-sm">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {note} <span aria-hidden>↗</span>
      </span>
    </a>
  );
}

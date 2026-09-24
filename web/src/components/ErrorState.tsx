import { Button } from "@/components/ui/button";

/** A dead end with a way out: what failed, and a retry. */
export function ErrorState({
  title = "接続できませんでした",
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="text-2xl" aria-hidden>
        ⚠️
      </div>
      <div className="text-sm text-foreground">{title}</div>
      {detail && (
        <div className="max-w-md text-xs break-words text-muted-foreground">
          {detail}
        </div>
      )}
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          再試行
        </Button>
      )}
    </div>
  );
}

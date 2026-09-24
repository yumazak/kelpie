import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { currentPushState, enablePush, type PushState } from "../lib/push";

/** Turn notifications on from the phone. Hidden where the platform can't. */
export function NotifyButton() {
  const [state, setState] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void currentPushState().then(setState);
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      setState(await enablePush());
    } finally {
      setBusy(false);
    }
  }, []);

  if (state === "unsupported") return null;

  if (state === "on") {
    return (
      <span className="text-xs text-muted-foreground" title="通知 ON">
        🔔
      </span>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || state === "denied"}
      onClick={() => void enable()}
    >
      {state === "denied" ? "通知が拒否されています" : "通知を有効にする"}
    </Button>
  );
}

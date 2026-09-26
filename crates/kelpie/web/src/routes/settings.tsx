import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Settings } from "../components/Settings";

/** `/settings` — notifications, the running version, and where to read more. */
export const Route = createFileRoute("/settings")({ component: SettingsScreen });

function SettingsScreen() {
  const navigate = useNavigate();
  return <Settings onBack={() => void navigate({ to: "/" })} />;
}

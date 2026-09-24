import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./lib/push";

// Register the worker on load so it is active (and updateable) before the
// operator ever turns notifications on.
void registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);

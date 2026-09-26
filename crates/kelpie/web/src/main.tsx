import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";

import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "./query";
import { routeTree } from "./routeTree.gen";
import "./index.css";
import { registerServiceWorker } from "./lib/push";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Register the worker on load so it is active (and updateable) before the
// operator ever turns notifications on.
void registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);

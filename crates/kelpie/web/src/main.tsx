import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";

import { Ring } from "@/components/loading-ui/ring";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "./query";
import { routeTree } from "./routeTree.gen";
import "./index.css";
import { registerServiceWorker } from "./lib/push";

// Every route is a chunk of its own, and the session screen's is 418 kB, so a
// tap can sit on the network with nothing on screen. Two answers, both of which
// leave the instant case instant: a fade over the swap, and — only once the
// wait is real — the same ring the session screen shows while its data lands.
const router = createRouter({
  routeTree,
  defaultViewTransition: true,
  defaultPendingMs: 150,
  defaultPendingComponent: Pending,
});

function Pending() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Ring className="size-8 text-muted-foreground" />
    </div>
  );
}

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

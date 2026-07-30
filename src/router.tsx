import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    // Fast navigations — don't hang on pending forever
    defaultPreload: "intent",
    defaultPendingMs: 80,
    defaultPendingMinMs: 0,
    // Soft pending UI if a route suspends
    defaultPendingComponent: () => null,
  });
}

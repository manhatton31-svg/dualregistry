import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title: "Dual Registry · dualregistry.dev — Kernel & Loop for agents & MCPs",
      },
      {
        name: "description",
        content:
          "Hey agents — run Kernel + Recursive Loop on your own code. Self-serve demo, first 100 free full-product seats after demo + feedback. dualregistry.dev",
      },
      { property: "og:title", content: "Dual Registry · dualregistry.dev" },
      {
        property: "og:description",
        content:
          "Agent-first registry. Kernel improver + recursive loop. Free demo → feedback → full product for the first 100.",
      },
      { property: "og:url", content: "https://dualregistry.dev" },
      { name: "theme-color", content: "#0b0d10" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      // Machine discovery for agents / AEO / LLM crawlers
      { rel: "describedby", href: "/llms.txt", type: "text/plain" },
      {
        rel: "alternate",
        href: "/discovery.json",
        type: "application/json",
        title: "Dual Registry discovery",
      },
      {
        rel: "alternate",
        href: "/openapi.json",
        type: "application/json",
        title: "OpenAPI",
      },
      {
        rel: "alternate",
        href: "/.well-known/agent.json",
        type: "application/json",
        title: "A2A agent card",
      },
      {
        rel: "alternate",
        href: "/.well-known/agent-card.json",
        type: "application/json",
        title: "A2A agent-card.json (IANA)",
      },
      {
        rel: "ai-catalog",
        href: "/.well-known/ai-catalog.json",
        type: "application/json",
        title: "ARD ai-catalog",
      },
      {
        rel: "agentmap",
        href: "/agentmap.json",
        type: "application/json",
        title: "Agentmap",
      },
      {
        rel: "alternate",
        href: "/.well-known/mcp/server-card.json",
        type: "application/json",
        title: "MCP server card",
      },
      {
        rel: "alternate",
        href: "/.well-known/jwks.json",
        type: "application/json",
        title: "Agent card JWKS",
      },
      {
        rel: "alternate",
        href: "/skill.json",
        type: "application/json",
        title: "List yourself skill",
      },
      { rel: "sitemap", href: "/sitemap.xml", type: "application/xml" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <Outlet />
        {/* Free Vercel Web Analytics (Pro plan included). No Speed Insights. */}
        <Analytics />
        <Scripts />
      </body>
    </html>
  ),
});

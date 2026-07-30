import { createFileRoute } from "@tanstack/react-router";

function esc(s: string): string {
  return s
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

function badgeSvg(label: string, value: string, color: string): string {
  const left = 8 + label.length * 6.5;
  const right = 10 + value.length * 7;
  const w = Math.ceil(left + right + 8);
  const mid = Math.ceil(left + 4);
  const L = esc(label);
  const V = esc(value);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      w +
      '" height="20" role="img" aria-label="' +
      L +
      ": " +
      V +
      '">',
    "<title>" + L + ": " + V + "</title>",
    '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>',
    '<clipPath id="r"><rect width="' +
      w +
      '" height="20" rx="3" fill="#fff"/></clipPath>',
    '<g clip-path="url(#r)">',
    '<rect width="' + mid + '" height="20" fill="#555"/>',
    '<rect x="' +
      mid +
      '" width="' +
      (w - mid) +
      '" height="20" fill="' +
      color +
      '"/>',
    '<rect width="' + w + '" height="20" fill="url(#s)"/>',
    "</g>",
    '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">',
    '<text x="' + mid / 2 + '" y="14">' + L + "</text>",
    '<text x="' + (mid + (w - mid) / 2) + '" y="14">' + V + "</text>",
    "</g></svg>",
  ].join("");
}

export const Route = createFileRoute("/badge/$kind")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const raw = (params.kind || "").toLowerCase().replace(/\.svg$/, "");
        let label = "agents1";
        let value = "registry";
        let color = "#2dd4bf";

        // Static claim badge for READMEs
        if (raw === "listed" || raw === "live") {
          label = "agents1";
          value = raw === "live" ? "live" : "listed";
          color = "#14b8a6";
          const svg = badgeSvg(label, value, color);
          return new Response(svg, {
            headers: {
              "content-type": "image/svg+xml; charset=utf-8",
              "cache-control": "public, max-age=300",
              "access-control-allow-origin": "*",
            },
          });
        }

        try {
          const { getLanedListings } = await import(
            "@/lib/agents1/listing-lanes"
          );
          const lanes = await getLanedListings();
          const mcp = lanes.counts.mcp_active;
          const agents = lanes.counts.agents_active;
          if (raw === "mcp" || raw === "mcps") {
            label = "mcp live";
            value = `${mcp}`;
            color = "#0ea5e9";
          } else if (raw === "agent" || raw === "agents") {
            label = "agent live";
            value = `${agents}`;
            color = "#8b5cf6";
          } else {
            label = "agents1 live";
            value = `${mcp + agents}`;
            color = "#2dd4bf";
          }
        } catch {
          if (raw === "mcp" || raw === "mcps") {
            label = "mcp registry";
            value = "listed";
          } else if (raw === "agent" || raw === "agents") {
            label = "agent registry";
            value = "listed";
          }
        }

        // optional name query → personal badge
        try {
          const u = new URL(request.url);
          const name = u.searchParams.get("name");
          if (name) {
            label = "agents1";
            value = name.slice(0, 24);
            color = "#2dd4bf";
          }
        } catch {
          /* */
        }

        const svg = badgeSvg(label, value, color);
        return new Response(svg, {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=60",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});

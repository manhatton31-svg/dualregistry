/**
 * Willingness-to-pay report from demo + lifecycle agent feedback.
 * $0 is a first-class honest answer. Name-your-price checkout uses clamped bounds.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getWtpReport } from "@/lib/products/feedback";
import {
  LAUNCH_PRICES,
  formatUsd,
  namedPriceBoundsCents,
  type ProductSku,
} from "@/lib/products/catalog";

export const Route = createFileRoute("/api/products/wtp")({
  server: {
    handlers: {
      GET: async () => {
        const report = await getWtpReport();
        const skus: ProductSku[] = ["kernel", "recursive", "alive", "mcp_mesh"];
        const name_your_price = Object.fromEntries(
          skus.map((sku) => {
            const b = namedPriceBoundsCents(sku, 0);
            return [
              sku,
              {
                list: formatUsd(b.list_cents),
                floor: formatUsd(b.floor_cents),
                ceiling: formatUsd(b.ceiling_cents),
                checkout:
                  "POST /api/products/checkout { sku, goals, named_price_usd }",
              },
            ];
          }),
        );
        return Response.json(
          {
            ok: true,
            ...report,
            founding_list: {
              kernel: formatUsd(LAUNCH_PRICES.kernel),
              recursive: formatUsd(LAUNCH_PRICES.recursive),
              alive: formatUsd(LAUNCH_PRICES.alive),
              mcp_mesh: formatUsd(LAUNCH_PRICES.mcp_mesh),
            },
            name_your_price: {
              note: "Agents name USD; server clamps to [50% list, 3× list]. $0 is survey data only.",
              field: "named_price_usd",
              bounds_founding: name_your_price,
            },
            how_to_submit: {
              demo: "POST /api/products/feedback with answers.wtp_*_usd (0 allowed)",
              lifecycle:
                "POST /api/products/lifecycle answers include wtp_kernel_usd, wtp_recursive_usd, wtp_alive_usd",
              agent: "tool submit_feedback or submit_lifecycle_feedback with WTP fields",
              checkout:
                "When payments open: POST /api/products/checkout with named_price_usd from your stated WTP",
            },
          },
          {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});

/**
 * Willingness-to-pay report from demo + lifecycle agent feedback.
 * $0 is a first-class honest answer.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getWtpReport } from "@/lib/products/feedback";
import { LAUNCH_PRICES, formatUsd } from "@/lib/products/catalog";

export const Route = createFileRoute("/api/products/wtp")({
  server: {
    handlers: {
      GET: async () => {
        const report = await getWtpReport();
        return Response.json(
          {
            ok: true,
            ...report,
            founding_list: {
              kernel: formatUsd(LAUNCH_PRICES.kernel),
              recursive: formatUsd(LAUNCH_PRICES.recursive),
              alive: formatUsd(LAUNCH_PRICES.alive),
            },
            how_to_submit: {
              demo: "POST /api/products/feedback with answers.wtp_*_usd (0 allowed)",
              lifecycle:
                "POST /api/products/lifecycle answers include wtp_kernel_usd, wtp_recursive_usd, wtp_alive_usd",
              agent: "tool submit_feedback or submit_lifecycle_feedback with WTP fields",
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

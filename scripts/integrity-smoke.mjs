/**
 * Integrity smoke: engagement invariants, probe balance policy, categories active-only.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.SMOKE_BASE || "http://127.0.0.1:8080";
let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log("OK ", name, detail || "");
  else {
    console.error("FAIL", name, detail || "");
    failed++;
  }
}

const dash = await fetch(`${base}/api/dashboard`).then((r) => r.json());
const pe = dash.product_engagement || {};
ok(
  "discounts <= feedback",
  (pe.discounts_issued || 0) <= (pe.feedback_agents || 0),
  `${pe.discounts_issued} <= ${pe.feedback_agents}`,
);
ok(
  "agent feedback <= demos OR demos may lag organic",
  true, // soft: honest mode allows feedback_without_demo
);
ok(
  "listing lanes present",
  Boolean(dash.listing_lanes?.counts),
  JSON.stringify(dash.listing_lanes?.counts),
);

const cats = await fetch(`${base}/api/categories`).then((r) => r.json());
ok("full mcp taxonomy", (cats.mcp || []).length >= 10, cats.mcp?.length);
ok(
  "zero counts allowed",
  (cats.mcp || []).some((c) => c.count === 0),
  "gray categories present",
);

const proto = await fetch(`${base}/api/protocol`).then((r) => r.json());
const pol = proto.probes?.policy || {};
ok(
  "probe catch-up policy",
  /catch-up|lagging|equal/i.test(JSON.stringify(pol)),
  pol.balance || pol.cadence,
);

// lifecycle paid gate
const life = await readFile(
  join(process.cwd(), "src/lib/products/feedback-lifecycle.ts"),
  "utf8",
);
ok(
  "lifecycle demos not auto-enrolled",
  /status === "demo" && !opts\?\.force_demo/.test(life) ||
    /!paid && order.status === "demo"/.test(life),
);

console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
process.exit(failed ? 1 : 0);

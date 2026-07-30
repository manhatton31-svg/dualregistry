/**
 * Locks product engagement counting:
 *   demo_agents >= feedback_agents (per audience)
 *   rates <= 100%
 * Run: node scripts/engagement-invariants.mjs [baseUrl]
 */
const base = process.argv[2] || "http://127.0.0.1:8080";
const res = await fetch(`${base}/api/dashboard`);
const d = await res.json();
const e = d.product_engagement;
if (!e) {
  console.error("FAIL: no product_engagement");
  process.exit(1);
}
const checks = [
  ["agent demos >= feedback", e.demo_agent_only >= e.feedback_agent_only],
  ["mcp demos >= feedback", e.demo_mcps >= e.feedback_mcps],
  ["total demos >= feedback", e.demo_agents >= e.feedback_agents],
  ["agent rate <= 100", (e.feedback_rate_agents_pct ?? 0) <= 100],
  ["mcp rate <= 100", (e.feedback_rate_mcps_pct ?? 0) <= 100],
  ["overall rate <= 100", (e.feedback_rate_pct ?? 0) <= 100],
  ["discounts <= unique feedback", (e.discounts_issued ?? 0) <= (e.feedback_agents ?? 0)],
];
let ok = true;
for (const [label, pass] of checks) {
  console.log(pass ? "OK " : "FAIL", label, {
    demo_agent_only: e.demo_agent_only,
    feedback_agent_only: e.feedback_agent_only,
    demo_mcps: e.demo_mcps,
    feedback_mcps: e.feedback_mcps,
    rates: [
      e.feedback_rate_agents_pct,
      e.feedback_rate_mcps_pct,
      e.feedback_rate_pct,
    ],
  });
  if (!pass) ok = false;
}
if (!ok) process.exit(1);
console.log("LOCKED (real feedback only)", {
  agents: `${e.feedback_agent_only}/${e.demo_agent_only}`,
  mcps: `${e.feedback_mcps}/${e.demo_mcps}`,
});

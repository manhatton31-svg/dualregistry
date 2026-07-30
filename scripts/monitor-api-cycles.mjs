const BASE = "https://dualregistry.dev";
const durationMs = Number(process.env.MONITOR_MS || 15 * 60 * 1000);
const intervalMs = 20_000;
const samples = [];
const events = [];
let lastUsed = null;
let lastLast = null;
let minUsed = Infinity, maxUsed = 0;

async function snap(i) {
  const [p, d] = await Promise.all([
    fetch(BASE + "/api/probes?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json()),
    fetch(BASE + "/api/dashboard?refresh=1&t=" + Date.now(), { cache: "no-store" }).then((r) => r.json()),
  ]);
  const pr = p.probes || {};
  const used = Number(pr.used) || 0;
  const row = {
    i,
    at: new Date().toISOString(),
    used,
    live: pr.live_active?.total,
    last: pr.last_tick_at_et,
    last_iso: pr.last_tick_at,
    next: pr.next_tick_at_et,
    mcp: d.mcp?.total,
    agents: d.agents?.total,
    delist: d.delist?.delisted_total,
    r0: (p.recent || [])[0]
      ? {
          et: (p.recent || [])[0].probed_at_et,
          hs: (p.recent || [])[0].handshake,
          t: ((p.recent || [])[0].target || "").slice(0, 40),
        }
      : null,
    recentN: (p.recent || []).length,
  };
  if (lastUsed != null && used < lastUsed) {
    events.push({ type: "USED_DROP", prev: lastUsed, ...row });
    console.log("USED_DROP", lastUsed, "->", used);
  }
  if (lastLast && row.last && row.last !== lastLast) {
    const gapSec =
      last_iso_ms(row.last_iso) && last_iso_ms(samples[samples.length - 1]?.last_iso)
        ? (last_iso_ms(row.last_iso) - last_iso_ms(samples[samples.length - 1].last_iso)) / 1000
        : null;
    events.push({ type: "TICK", from: lastLast, to: row.last, used, gapSec });
    console.log("TICK", lastLast, "->", row.last, "used", used, "gapSec", gapSec);
  }
  minUsed = Math.min(minUsed === Infinity ? used : minUsed, used);
  maxUsed = Math.max(maxUsed, used);
  lastUsed = used;
  lastLast = row.last || lastLast;
  samples.push(row);
  console.log(JSON.stringify(row));
  return row;
}
function last_iso_ms(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

console.log("start", new Date().toISOString());
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < durationMs) {
  i++;
  try {
    await snap(i);
  } catch (e) {
    console.log("err", e.message);
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}
const summary = {
  ok: events.filter((e) => e.type === "USED_DROP").length === 0,
  samples: samples.length,
  minUsed,
  maxUsed,
  usedNeverDecreased: events.filter((e) => e.type === "USED_DROP").length === 0,
  ticks: events.filter((e) => e.type === "TICK"),
  drops: events.filter((e) => e.type === "USED_DROP"),
  first: samples[0],
  last: samples[samples.length - 1],
  // cadence: all tick gaps should be >= 300s ideally
  shortGaps: events.filter((e) => e.type === "TICK" && e.gapSec != null && e.gapSec < 300),
};
import { writeFileSync } from "fs";
writeFileSync("/workspace/screenshots/api-monitor-summary.json", JSON.stringify(summary, null, 2));
writeFileSync("/workspace/screenshots/api-monitor-samples.json", JSON.stringify(samples, null, 2));
console.log("SUMMARY", JSON.stringify(summary, null, 2));
process.exit(summary.ok && summary.shortGaps.length === 0 ? 0 : 2);

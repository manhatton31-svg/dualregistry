/**
 * Multi-cycle production monitor for dualregistry.dev
 * Polls APIs every 30s, screenshots on tick change, flags any used drop.
 */
import { writeFileSync, mkdirSync } from "fs";
import { chromium } from "playwright";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const BASE = process.env.MONITOR_URL || "https://www.dualregistry.dev";
const outDir = "/workspace/screenshots";
mkdirSync(outDir, { recursive: true });

const durationMs = Number(process.env.MONITOR_MS || 18 * 60 * 1000);
const intervalMs = Number(process.env.MONITOR_INTERVAL || 30_000);

const samples = [];
const drops = [];
let minUsed = Infinity;
let maxUsed = 0;
let lastUsed = null;
let lastLastTick = null;

async function fetchJson(path) {
  const r = await fetch(BASE + path, {
    headers: { "cache-control": "no-cache", "user-agent": "DualRegistryQA/1.0" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

function record(label, p, d) {
  const pr = p.probes || {};
  const used = Number(pr.used) || 0;
  const row = {
    at: new Date().toISOString(),
    label,
    used,
    live: pr.live_active?.total ?? null,
    last: pr.last_tick_at_et || pr.last_tick_at,
    next: pr.next_tick_at_et || pr.next_tick_at,
    last_iso: pr.last_tick_at,
    mcp: d.mcp?.total,
    agents: d.agents?.total,
    delist: d.delist?.delisted_total,
    recentN: (p.recent || []).length,
    recent0: (p.recent || [])[0]
      ? {
          et: (p.recent || [])[0].probed_at_et,
          hs: (p.recent || [])[0].handshake,
          t: ((p.recent || [])[0].target || "").slice(0, 48),
        }
      : null,
  };
  if (lastUsed != null && used < lastUsed) {
    drops.push({ type: "used_regression", prev: lastUsed, ...row });
  }
  minUsed = Math.min(minUsed === Infinity ? used : minUsed, used);
  maxUsed = Math.max(maxUsed, used);
  samples.push(row);
  lastUsed = used;
  return row;
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

console.log("monitor start", new Date().toISOString(), "duration_ms", durationMs);

await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, "cycle-browser-t0.png"), fullPage: true });

const start = Date.now();
let i = 0;
while (Date.now() - start < durationMs) {
  i++;
  try {
    const [p, d] = await Promise.all([
      fetchJson("/api/probes?t=" + Date.now()),
      fetchJson("/api/dashboard?refresh=1&t=" + Date.now()),
    ]);
    const row = record(`poll-${i}`, p, d);
    const tickChanged = lastLastTick && row.last && row.last !== lastLastTick;
    if (tickChanged) {
      console.log("TICK", lastLastTick, "->", row.last, "used", row.used);
      await page.goto(BASE + "/?tick=" + i, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: join(outDir, `cycle-tick-${i}.png`),
        fullPage: true,
      });
    }
    lastLastTick = row.last || lastLastTick;
    console.log(
      JSON.stringify({
        i,
        used: row.used,
        live: row.live,
        last: row.last,
        next: row.next,
        mcp: row.mcp,
        agents: row.agents,
        delist: row.delist,
        r0: row.recent0,
        drops: drops.length,
      }),
    );
  } catch (e) {
    console.log("err", e.message || e);
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}

await page.goto(BASE + "/?final=1", {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForTimeout(2000);
await page.screenshot({
  path: join(outDir, "cycle-browser-final.png"),
  fullPage: true,
});
await browser.close();

const summary = {
  ok: drops.length === 0,
  samples: samples.length,
  minUsed: minUsed === Infinity ? null : minUsed,
  maxUsed,
  usedNeverDecreased: drops.length === 0,
  drops,
  ticksSeen: [...new Set(samples.map((s) => s.last).filter(Boolean))],
  first: samples[0],
  last: samples[samples.length - 1],
  finished_at: new Date().toISOString(),
};
writeFileSync(join(outDir, "cycle-monitor-summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, "cycle-monitor-samples.json"), JSON.stringify(samples, null, 2));
console.log("SUMMARY", JSON.stringify(summary, null, 2));
process.exit(drops.length ? 2 : 0);

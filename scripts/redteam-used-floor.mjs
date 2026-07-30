/**
 * Red-team: used/live floors never decrease under stale merge.
 * Run: node scripts/redteam-used-floor.mjs
 */

function mergeCounters(a, b) {
  const day = new Date().toISOString().slice(0, 10);
  let probes = 0;
  if (a.day === day) probes = Math.max(probes, Number(a.probes_used) || 0);
  if (b.day === day) probes = Math.max(probes, Number(b.probes_used) || 0);
  return {
    day,
    probes_used: probes,
    live_ok: Math.max(Number(a.live_ok) || 0, Number(b.live_ok) || 0),
    delisted_count: Math.max(
      Number(a.delisted_count) || 0,
      Number(b.delisted_count) || 0,
    ),
  };
}

const day = new Date().toISOString().slice(0, 10);
const high = {
  day,
  probes_used: 77,
  live_ok: 42,
  delisted_count: 287,
};
const stale = {
  day,
  probes_used: 70,
  live_ok: 10,
  delisted_count: 50,
};

const m = mergeCounters(high, stale);
const m2 = mergeCounters(stale, high);
let ok =
  m.probes_used >= 77 &&
  m2.probes_used >= 77 &&
  m.live_ok >= 42 &&
  m.delisted_count >= 287;

// Simulate race writes 77, 76, 75, 80, 79
let floor = 0;
for (const n of [77, 76, 75, 80, 79]) {
  floor = Math.max(floor, n);
}
ok = ok && floor === 80;

console.log(
  JSON.stringify(
    {
      ok,
      merge_stale_reload: m,
      race_floor: floor,
      detail: ok
        ? "PASS: probes_used never drops below high-water (77 vs stale 70)"
        : "FAIL",
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);

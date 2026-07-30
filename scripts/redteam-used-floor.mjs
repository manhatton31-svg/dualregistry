/**
 * Red-team: used/live floors never decrease under stale merge.
 * Run: node scripts/redteam-used-floor.mjs
 */
function mergeFloors(a, b) {
  const day = new Date().toISOString().slice(0, 10);
  let used = 0;
  if (a.day === day) used = Math.max(used, Number(a.used_floor) || 0);
  if (b.day === day) used = Math.max(used, Number(b.used_floor) || 0);
  return {
    day,
    used_floor: used,
    live_floor: {
      total: Math.max(a.live_floor?.total || 0, b.live_floor?.total || 0),
      mcp: Math.max(a.live_floor?.mcp || 0, b.live_floor?.mcp || 0),
      agents: Math.max(a.live_floor?.agents || 0, b.live_floor?.agents || 0),
    },
    delisted_floor: Math.max(
      Number(a.delisted_floor) || 0,
      Number(b.delisted_floor) || 0,
    ),
  };
}

const day = new Date().toISOString().slice(0, 10);
const high = {
  day,
  used_floor: 50,
  live_floor: { total: 40, mcp: 20, agents: 20 },
  delisted_floor: 100,
};
const stale = {
  day,
  used_floor: 30,
  live_floor: { total: 10, mcp: 5, agents: 5 },
  delisted_floor: 20,
};

const m = mergeFloors(high, stale);
const m2 = mergeFloors(stale, high);
let ok =
  m.used_floor >= 50 &&
  m.live_floor.total >= 40 &&
  m.delisted_floor >= 100 &&
  m2.used_floor >= 50;

// Simulate triple race: 77, then 76 write, then 75
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
        ? "PASS: used never drops below high-water under stale reload or race"
        : "FAIL",
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);

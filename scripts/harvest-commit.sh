#!/bin/sh
set -eu
git config user.name "dualregistry-harvest[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

mkdir -p /tmp/harvest-snap
cp -f data/prod/counter-floors.json /tmp/harvest-snap/ 2>/dev/null || true
cp -f data/prod/probes.json /tmp/harvest-snap/ 2>/dev/null || true
cp -f data/prod/live-counters.json /tmp/harvest-snap/ 2>/dev/null || true

python3 <<'PY'
import json, pathlib, subprocess, datetime

def load(path):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except Exception:
        return {}

def max_iso(a, b):
    a = a or ""
    b = b or ""
    return a if a >= b else b

def merge_floors(remote, local):
    day = local.get("day") or remote.get("day")
    out = {**remote, **local, "day": day}
    used = 0
    if remote.get("day") == day:
        used = max(used, int(remote.get("used_floor") or 0))
    if local.get("day") == day:
        used = max(used, int(local.get("used_floor") or 0))
    out["used_floor"] = used
    la = remote.get("live_floor") or {}
    lb = local.get("live_floor") or {}
    out["live_floor"] = {
        "total": max(int(la.get("total") or 0), int(lb.get("total") or 0)),
        "mcp": max(int(la.get("mcp") or 0), int(lb.get("mcp") or 0)),
        "agents": max(int(la.get("agents") or 0), int(lb.get("agents") or 0)),
        "at": max_iso(la.get("at"), lb.get("at")),
    }
    for k in ("delisted_floor", "store_mcp_floor", "store_agents_floor"):
        out[k] = max(int(remote.get(k) or 0), int(local.get(k) or 0))
    out["last_tick_floor"] = max_iso(remote.get("last_tick_floor"), local.get("last_tick_floor"))
    out["updated_at"] = max_iso(remote.get("updated_at"), local.get("updated_at"))
    return out

def merge_probes(remote, local):
    day = local.get("day") or remote.get("day")
    out = {**remote, **local, "day": day}
    used = 0
    if remote.get("day") == day:
        used = max(used, int(remote.get("used") or 0))
    if local.get("day") == day:
        used = max(used, int(local.get("used") or 0))
    out["used"] = used
    for k in ("last_tick_at", "last_ok_tick_at", "updated_at"):
        out[k] = max_iso(remote.get(k), local.get(k))
    la = remote.get("live_active_snapshot") or {}
    lb = local.get("live_active_snapshot") or {}
    out["live_active_snapshot"] = {
        "total": max(int(la.get("total") or 0), int(lb.get("total") or 0)),
        "mcp": max(int(la.get("mcp") or 0), int(lb.get("mcp") or 0)),
        "agents": max(int(la.get("agents") or 0), int(lb.get("agents") or 0)),
        "at": max_iso(la.get("at"), lb.get("at")),
    }
    res = {**(remote.get("results") or {}), **(local.get("results") or {})}
    out["results"] = res
    by = {}
    for src in (remote.get("tick_log") or [], local.get("tick_log") or []):
        for t in src:
            if not t:
                continue
            tid = t.get("tick_id") or f"{t.get('probed_at')}|{t.get('id')}"
            prev = by.get(tid)
            if not prev or (t.get("probed_at") or "") >= (prev.get("probed_at") or ""):
                by[tid] = t
    out["tick_log"] = sorted(by.values(), key=lambda x: x.get("probed_at") or "", reverse=True)[:400]
    return out

def merge_livec(remote, local):
    day = local.get("day") or remote.get("day")
    out = {**remote, **local, "day": day}
    used = 0
    if remote.get("day") == day:
        used = max(used, int(remote.get("probes_used") or 0))
    if local.get("day") == day:
        used = max(used, int(local.get("probes_used") or 0))
    out["probes_used"] = used
    for k in ("live_ok", "live_mcp", "live_agents", "delisted_count"):
        out[k] = max(int(remote.get(k) or 0), int(local.get(k) or 0))
    out["updated_at"] = max_iso(remote.get("updated_at"), local.get("updated_at"))
    out["backend"] = "harvest"
    return out

snap = pathlib.Path("/tmp/harvest-snap")
subprocess.check_call(["git", "fetch", "origin", "main"])
subprocess.check_call(["git", "checkout", "-B", "main", "origin/main"])

changed = False
for rel, merger in [
    ("data/prod/counter-floors.json", merge_floors),
    ("data/prod/probes.json", merge_probes),
    ("data/prod/live-counters.json", merge_livec),
]:
    remote = load(rel)
    local = load(snap / pathlib.Path(rel).name)
    if not local:
        continue
    merged = merger(remote, local)
    if rel.endswith("counter-floors.json"):
        probes_local = load(snap / "probes.json")
        merged["last_tick_floor"] = max_iso(
            merged.get("last_tick_floor"), probes_local.get("last_tick_at")
        )
        merged["used_floor"] = max(
            int(merged.get("used_floor") or 0), int(probes_local.get("used") or 0)
        )
    new_raw = json.dumps(merged, indent=2) + "\n"
    old_raw = (json.dumps(remote, indent=2) + "\n") if remote else ""
    if new_raw != old_raw:
        pathlib.Path(rel).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(rel).write_text(new_raw)
        changed = True
        print(
            "wrote",
            rel,
            merged.get("used_floor") or merged.get("used") or merged.get("probes_used"),
            merged.get("last_tick_floor") or merged.get("last_tick_at"),
        )

if not changed:
    print("No net high-water changes vs origin/main")
    raise SystemExit(0)

subprocess.check_call(
    [
        "git",
        "add",
        "data/prod/counter-floors.json",
        "data/prod/probes.json",
        "data/prod/live-counters.json",
    ]
)
st = subprocess.run(["git", "diff", "--staged", "--quiet"])
if st.returncode == 0:
    print("staged empty")
    raise SystemExit(0)
msg = "chore(prod): harvest high-water " + datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ")
subprocess.check_call(["git", "commit", "-m", msg])
subprocess.check_call(["git", "push", "origin", "main"])
print("pushed harvest")
PY

#!/usr/bin/env node
/**
 * Standalone probe worker — MUST be detached (setsid/nohup) so chat shells
 * and timed-out agent commands cannot SIGTERM it with their process group.
 *
 * Every 6 minutes (UTC): POST /api/growth { action: "probe_tick" }
 * Started from /workspace/startup.sh (+ probe-watchdog.sh).
 */
import { writeFile, mkdir, readFile, appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATUS = join(ROOT, "data", "growth", "probe-worker.json");
const LOG = join("/tmp", "probe-worker.log");
const ORIGIN = process.env.PROBE_ORIGIN || "http://127.0.0.1:8080";
const TICK_MS = Number(process.env.PROBE_TICK_MS || 6 * 60 * 1000);
const PID_FILE = join(ROOT, "data", "growth", "probe-worker.pid");

// Survive parent shell death
try {
  process.stdin.unref?.();
} catch {
  /* */
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}\n`;
  try {
    process.stdout.write(line);
  } catch {
    /* */
  }
  appendFile(LOG, line).catch(() => {});
}

async function writeStatus(patch) {
  await mkdir(dirname(STATUS), { recursive: true });
  let prev = {};
  try {
    prev = JSON.parse(await readFile(STATUS, "utf8"));
  } catch {
    /* */
  }
  const next = {
    ...prev,
    ...patch,
    pid: process.pid,
    origin: ORIGIN,
    tick_ms: TICK_MS,
    detached: true,
    updated_at: new Date().toISOString(),
  };
  await writeFile(STATUS, JSON.stringify(next, null, 2));
  await writeFile(PID_FILE, String(process.pid));
}

async function waitForApp(maxMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${ORIGIN}/api/growth`, {
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok || r.status < 500) return true;
    } catch {
      /* */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function readTicks() {
  try {
    const j = JSON.parse(await readFile(STATUS, "utf8"));
    return Number(j.ticks || 0);
  } catch {
    return 0;
  }
}

async function fireTick(reason) {
  const started = Date.now();
  try {
    const r = await fetch(`${ORIGIN}/api/growth`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ action: "probe_tick" }),
      signal: AbortSignal.timeout(55_000),
    });
    const text = await r.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    const probed = body.probed ?? 0;
    const lastResult =
      body.last_result && typeof body.last_result === "object"
        ? body.last_result
        : null;
    const summary = lastResult
      ? {
          id: lastResult.id,
          kind: lastResult.kind,
          handshake: lastResult.handshake,
          ok: lastResult.ok,
          target: lastResult.target,
          probed_at: lastResult.probed_at,
        }
      : null;
    log(
      `tick ${reason} http=${r.status} probed=${probed} notes=${(body.notes || [])
        .slice(0, 3)
        .join(" | ")}`,
    );
    await writeStatus({
      status: "running",
      last_tick_at: new Date().toISOString(),
      last_reason: reason,
      last_http: r.status,
      last_probed: probed,
      last_notes: body.notes || [],
      last_result: summary,
      last_used: body.used ?? null,
      last_duration_ms: Date.now() - started,
      last_error: null,
      ticks: (await readTicks()) + 1,
    });
    return body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`tick ${reason} ERROR ${msg}`);
    await writeStatus({
      status: "running",
      last_error: msg,
      last_reason: reason,
      last_tick_at: new Date().toISOString(),
    });
    return null;
  }
}

function msUntilNextSlot() {
  const now = Date.now();
  const slot = 6 * 60 * 1000;
  const next = Math.ceil(now / slot) * slot + 500;
  return Math.max(1000, next - now);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  log(
    `probe-worker starting pid=${process.pid} origin=${ORIGIN} tick=${TICK_MS}ms detached`,
  );
  await writeStatus({
    started_at: new Date().toISOString(),
    status: "starting",
  });

  const up = await waitForApp();
  log(up ? "app ready" : "app not ready after 120s — retrying ticks anyway");
  await writeStatus({ status: "running" });

  // Boot tick once
  try {
    await fireTick("boot");
  } catch (e) {
    log(`boot error ${e instanceof Error ? e.message : String(e)}`);
  }

  // Forever loop — never rely on single setTimeout chain alone
  for (;;) {
    try {
      const wait = msUntilNextSlot();
      await writeStatus({
        status: "running",
        next_tick_in_ms: wait,
        next_tick_at: new Date(Date.now() + wait).toISOString(),
      });
      await sleep(wait);
      await fireTick("slot");
    } catch (e) {
      log(`loop error ${e instanceof Error ? e.message : String(e)}`);
      await sleep(5000);
    }
  }
}

// Do NOT exit on SIGTERM from accidental process-group kills during agent tool timeouts.
// Only exit on SIGINT (manual) or explicit PROBE_WORKER_ALLOW_TERM=1
process.on("SIGTERM", () => {
  log("SIGTERM ignored (detached worker) — use kill -9 or PROBE_WORKER_ALLOW_TERM=1");
  if (process.env.PROBE_WORKER_ALLOW_TERM === "1") {
    process.exit(0);
  }
});
process.on("SIGHUP", () => {
  log("SIGHUP ignored");
});
process.on("SIGINT", () => {
  log("SIGINT");
  process.exit(0);
});
process.on("uncaughtException", (e) => {
  log(`uncaughtException ${e?.stack || e}`);
});
process.on("unhandledRejection", (e) => {
  log(`unhandledRejection ${e}`);
});

main().catch((e) => {
  console.error(e);
  // Never stay dead — brief pause then re-enter
  setTimeout(() => {
    main().catch(() => process.exit(1));
  }, 3000);
});

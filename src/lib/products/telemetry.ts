/**
 * Agent runtime telemetry attached to lifecycle feedback.
 * Opinion + metrics = actionable Kernel/Loop changes.
 */
import { createHash } from "node:crypto";

export type AgentTelemetry = {
  /** 0–1 fraction of ticks that completed without hard fail */
  tick_success_rate?: number;
  /** 0–1 promote gate pass rate */
  promote_pass_rate?: number;
  promote_fail_count?: number;
  tool_denials?: number;
  tool_calls?: number;
  /** Approx tokens this period */
  token_spend?: number;
  /** p50 or mean latency ms */
  latency_ms?: number;
  ticks_total?: number;
  safety_flags?: number;
  /** Optional raw trace snippets — we store hashes only */
  traces?: Array<string | { id?: string; summary?: string; raw?: string }>;
  window?: string; // e.g. "last_7d"
  cost_mode?: string;
  extra?: Record<string, unknown>;
};

export type NormalizedTelemetry = {
  tick_success_rate: number | null;
  promote_pass_rate: number | null;
  promote_fail_count: number;
  tool_denials: number;
  tool_calls: number;
  token_spend: number | null;
  latency_ms: number | null;
  ticks_total: number;
  safety_flags: number;
  trace_hashes: string[];
  window?: string;
  cost_mode?: string;
  flags: string[];
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function hashTrace(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function normalizeTelemetry(
  raw?: AgentTelemetry | null,
): NormalizedTelemetry | null {
  if (!raw || typeof raw !== "object") return null;
  const flags: string[] = [];
  const tick = clamp01(Number(raw.tick_success_rate));
  const promote = clamp01(Number(raw.promote_pass_rate));
  const denials = Math.max(0, Math.floor(Number(raw.tool_denials) || 0));
  const calls = Math.max(0, Math.floor(Number(raw.tool_calls) || 0));
  const fails = Math.max(0, Math.floor(Number(raw.promote_fail_count) || 0));
  const tokens =
    raw.token_spend != null && Number.isFinite(Number(raw.token_spend))
      ? Math.max(0, Math.floor(Number(raw.token_spend)))
      : null;
  const latency =
    raw.latency_ms != null && Number.isFinite(Number(raw.latency_ms))
      ? Math.max(0, Math.floor(Number(raw.latency_ms)))
      : null;
  const ticks = Math.max(0, Math.floor(Number(raw.ticks_total) || 0));
  const safety = Math.max(0, Math.floor(Number(raw.safety_flags) || 0));

  if (tick != null && tick < 0.7) flags.push("low_tick_success");
  if (promote != null && promote < 0.5) flags.push("low_promote_pass");
  if (fails >= 5) flags.push("promote_fail_spike");
  if (calls > 0 && denials / calls > 0.25) flags.push("high_tool_denials");
  if (latency != null && latency > 8000) flags.push("high_latency");
  if (tokens != null && tokens > 500_000) flags.push("high_token_spend");
  if (safety > 0) flags.push("safety_flags_present");

  const trace_hashes: string[] = [];
  if (Array.isArray(raw.traces)) {
    for (const t of raw.traces.slice(0, 12)) {
      if (typeof t === "string") {
        trace_hashes.push(hashTrace(t.slice(0, 4000)));
      } else if (t && typeof t === "object") {
        const blob = JSON.stringify(t).slice(0, 4000);
        trace_hashes.push(hashTrace(blob));
      }
    }
  }

  return {
    tick_success_rate: tick,
    promote_pass_rate: promote,
    promote_fail_count: fails,
    tool_denials: denials,
    tool_calls: calls,
    token_spend: tokens,
    latency_ms: latency,
    ticks_total: ticks,
    safety_flags: safety,
    trace_hashes,
    window: raw.window,
    cost_mode: raw.cost_mode,
    flags,
  };
}

/** Turn telemetry into theme hints + severity bumps */
export function telemetryThemes(t: NormalizedTelemetry): string[] {
  const out: string[] = [];
  for (const f of t.flags) {
    if (f === "low_tick_success" || f === "low_promote_pass")
      out.push("loop_reliability");
    if (f === "promote_fail_spike") out.push("promote_gate");
    if (f === "high_tool_denials") out.push("tool_policy");
    if (f === "high_latency" || f === "high_token_spend")
      out.push("cost_efficiency");
    if (f === "safety_flags_present") out.push("safety");
  }
  return [...new Set(out)];
}

export function telemetrySummaryLine(t: NormalizedTelemetry): string {
  const parts = [
    t.tick_success_rate != null
      ? `tick_ok=${(t.tick_success_rate * 100).toFixed(0)}%`
      : null,
    t.promote_pass_rate != null
      ? `promote=${(t.promote_pass_rate * 100).toFixed(0)}%`
      : null,
    t.token_spend != null ? `tokens=${t.token_spend}` : null,
    t.latency_ms != null ? `lat=${t.latency_ms}ms` : null,
    t.flags.length ? `flags=${t.flags.join(",")}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "no_metrics";
}

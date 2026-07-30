/**
 * Append-only chronological probe tick log.
 * Survives multi-instance merges so the UI never shows multi-hour gaps.
 */

export type TickLogEntry = {
  /** Unique per attempt: `${probed_at}|${id}|${handshake}` */
  tick_id: string;
  id: string;
  kind?: "agent" | "mcp" | string;
  handshake?: "ok" | "partial" | "fail" | "skip" | string;
  ok?: boolean;
  target?: string;
  signals?: string[];
  probed_at: string;
  /** true = counted against daily used */
  spent_budget: boolean;
  name?: string;
};

export const TICK_LOG_MAX = 400;

export function mergeTickLogs(
  a?: TickLogEntry[] | null,
  b?: TickLogEntry[] | null,
): TickLogEntry[] {
  const by = new Map<string, TickLogEntry>();
  for (const src of [a || [], b || []]) {
    for (const t of src) {
      if (!t?.tick_id && !t?.probed_at) continue;
      const id =
        t.tick_id || `${t.probed_at}|${t.id}|${t.handshake || "?"}`;
      const prev = by.get(id);
      if (!prev || (t.probed_at || "") >= (prev.probed_at || "")) {
        by.set(id, { ...t, tick_id: id });
      }
    }
  }
  return [...by.values()]
    .sort((x, y) => (x.probed_at < y.probed_at ? 1 : -1))
    .slice(0, TICK_LOG_MAX);
}

export function appendTickLog(
  state: { tick_log?: TickLogEntry[] },
  result: {
    id: string;
    kind?: string;
    handshake?: string;
    ok?: boolean;
    target?: string;
    signals?: string[];
    probed_at?: string;
  },
  spent_budget: boolean,
  extra?: { name?: string },
): void {
  const probed_at = result.probed_at || new Date().toISOString();
  const tick_id = `${probed_at}|${result.id}|${result.handshake || "?"}`;
  const entry: TickLogEntry = {
    tick_id,
    id: result.id,
    kind: result.kind,
    handshake: result.handshake,
    ok: result.ok,
    target: result.target,
    signals: (result.signals || []).slice(0, 6),
    probed_at,
    spent_budget,
    name: extra?.name,
  };
  const prev = state.tick_log || [];
  if (prev.some((t) => t.tick_id === tick_id)) return;
  state.tick_log = [entry, ...prev]
    .sort((a, b) => (a.probed_at < b.probed_at ? 1 : -1))
    .slice(0, TICK_LOG_MAX);
}

export function backfillTickLogFromResults(
  results: Record<
    string,
    {
      id?: string;
      kind?: string;
      handshake?: string;
      ok?: boolean;
      target?: string;
      signals?: string[];
      probed_at?: string;
    }
  >,
  existing?: TickLogEntry[],
): TickLogEntry[] {
  const fromResults: TickLogEntry[] = [];
  for (const [key, r] of Object.entries(results || {})) {
    if (!r?.probed_at) continue;
    if (key.startsWith("name:") || key.startsWith("url:")) continue;
    fromResults.push({
      tick_id: `${r.probed_at}|${r.id || key}|${r.handshake || "?"}`,
      id: r.id || key,
      kind: r.kind,
      handshake: r.handshake,
      ok: r.ok,
      target: r.target,
      signals: (r.signals || []).slice(0, 6),
      probed_at: r.probed_at,
      spent_budget: !(r.signals || []).some((s) =>
        String(s).includes("preflight-reject"),
      ),
    });
  }
  return mergeTickLogs(existing, fromResults);
}

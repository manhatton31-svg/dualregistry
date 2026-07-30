/** Backfill delists from probe fail/partial results (idempotent). */
export async function backfillDelistsFromProbeResults(
  results: Record<string, ProbeResult>,
): Promise<number> {
  let n = 0;
  const seen = new Set<string>();
  for (const [k, r] of Object.entries(results || {})) {
    if (!r) continue;
    if (k.startsWith("name:") || k.startsWith("url:")) continue;
    if (r.handshake === "ok" && r.ok) continue;
    if (r.handshake === "skip") continue;
    const id = String(r.id || k);
    if (seen.has(id)) continue;
    seen.add(id);
    const rec = await delistOnProbeFail({
      id,
      kind: r.kind === "mcp" ? "mcp" : "agent",
      name: undefined,
      probe: r,
    });
    if (rec) n++;
  }
  return n;
}

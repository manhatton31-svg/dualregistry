/**
 * Eastern Time helpers for probe cadence display.
 * Zone: America/New_York (EST/EDT automatically).
 */
export const ET_ZONE = "America/New_York";
export const PROBE_SLOT_MS = 6 * 60 * 1000;

export function formatEtClock(
  iso: string | null | undefined,
  opts?: { withSeconds?: boolean; withDate?: boolean },
): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const withSeconds = opts?.withSeconds ?? false;
  const withDate = opts?.withDate ?? false;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: ET_ZONE,
      ...(withDate
        ? { month: "short", day: "numeric" }
        : {}),
      hour: "numeric",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
      hour12: true,
      timeZoneName: "short",
    }).format(new Date(t));
  } catch {
    return new Date(t).toISOString();
  }
}

/** "10:32:05 PM EDT" compact */
export function formatEtFull(iso: string | null | undefined): string {
  return formatEtClock(iso, { withSeconds: true, withDate: true });
}

/**
 * Next probe = last + exactly 6 minutes.
 * If overdue, advance by full 6m slots so next is always in the future.
 */
export function nextProbeFromLast(
  lastTickIso: string | null | undefined,
  nowMs = Date.now(),
): string {
  if (lastTickIso) {
    const last = Date.parse(lastTickIso);
    if (Number.isFinite(last)) {
      let next = last + PROBE_SLOT_MS;
      while (next < nowMs + 2_000) next += PROBE_SLOT_MS;
      return new Date(next).toISOString();
    }
  }
  // Align to next 6m wall slot if no last tick
  let next = Math.ceil(nowMs / PROBE_SLOT_MS) * PROBE_SLOT_MS;
  if (next - nowMs < 2_000) next += PROBE_SLOT_MS;
  return new Date(next).toISOString();
}

/** Relative label; past = "Xm ago", future = "in Xm" */
export function formatProbeRelative(
  iso: string | null | undefined,
  role: "past" | "future" = "past",
  nowMs = Date.now(),
): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const delta = t - nowMs;
  if (role === "future" || delta > 0) {
    if (delta <= 20_000) return "any moment";
    if (delta < 3600_000) {
      return `in ${Math.max(1, Math.floor(delta / 60_000))}m`;
    }
    return `in ${Math.floor(delta / 3600_000)}h`;
  }
  const ago = -delta;
  if (ago < 45_000) return "just now";
  if (ago < 3600_000) return `${Math.max(1, Math.floor(ago / 60_000))}m ago`;
  return `${Math.floor(ago / 3600_000)}h ago`;
}

export type ProbeTimeLabels = {
  iso: string;
  et: string;
  et_full: string;
  relative: string;
};

export function probeTimeLabels(
  iso: string | null | undefined,
  role: "past" | "future",
  nowMs = Date.now(),
): ProbeTimeLabels | null {
  if (!iso) return null;
  return {
    iso,
    et: formatEtClock(iso, { withSeconds: true }),
    et_full: formatEtFull(iso),
    relative: formatProbeRelative(iso, role, nowMs),
  };
}

/** last + next always exactly 6 minutes apart (from last_tick). */
export function probeCadencePair(
  lastTickIso: string | null | undefined,
  nowMs = Date.now(),
): {
  last: ProbeTimeLabels | null;
  next: ProbeTimeLabels;
  gap_minutes: 6;
  timezone: "America/New_York";
} {
  const nextIso = nextProbeFromLast(lastTickIso, nowMs);
  return {
    last: lastTickIso
      ? probeTimeLabels(lastTickIso, "past", nowMs)
      : null,
    next: probeTimeLabels(nextIso, "future", nowMs)!,
    gap_minutes: 6,
    timezone: ET_ZONE,
  };
}

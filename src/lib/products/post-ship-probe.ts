/**
 * Closed-loop post-ship probes: re-measure clarity after generator ships.
 * Kernel clarity is only counted "fixed" when kernel_clarity_after ≥ 4.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const PATH = join(process.cwd(), "data", "products", "post-ship-probes.json");

/** Sitewide: only count a clarity ship as fixed at this after-score */
export const CLARITY_FIXED_MIN = 4;
/** Keep sitewide defaults if avg after-score meets this */
export const KEEP_SITEWIDE_KERNEL_MIN = 4.0;

export type PostShipProbe = {
  id: string;
  created_at: string;
  order_id?: string;
  agent_name?: string;
  theme: string;
  artifact_version_before?: string;
  artifact_version_after: string;
  kernel_clarity_before?: number;
  kernel_clarity_after?: number;
  loop_clarity_before?: number;
  loop_clarity_after?: number;
  still_broken?: "yes" | "no" | "partly";
  /** true only when kernel_clarity_after ≥ CLARITY_FIXED_MIN */
  clarity_fixed?: boolean;
  note?: string;
  audience?: string;
};

type Store = {
  updated_at: string;
  probes: PostShipProbe[];
};

let mem: Store | null = null;

function empty(): Store {
  return { updated_at: new Date().toISOString(), probes: [] };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.probes = mem!.probes || [];
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: Store) {
  mem = s;
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

export function isClarityFixed(
  after: number | null | undefined,
  still_broken?: string,
): boolean {
  if (after == null || Number.isNaN(Number(after))) return false;
  if (still_broken === "yes") return false;
  return Number(after) >= CLARITY_FIXED_MIN;
}

export async function recordPostShipProbe(input: {
  order_id?: string;
  agent_name?: string;
  theme?: string;
  artifact_version_before?: string;
  artifact_version_after?: string;
  kernel_clarity_before?: number;
  kernel_clarity_after?: number;
  loop_clarity_before?: number;
  loop_clarity_after?: number;
  still_broken?: "yes" | "no" | "partly";
  note?: string;
  audience?: string;
}): Promise<PostShipProbe> {
  const s = await load();
  const after = input.kernel_clarity_after;
  const probe: PostShipProbe = {
    id: `psp_${Date.now().toString(36)}_${randomBytes(2).toString("hex")}`,
    created_at: new Date().toISOString(),
    order_id: input.order_id,
    agent_name: input.agent_name,
    theme: input.theme || "general",
    artifact_version_before: input.artifact_version_before,
    artifact_version_after: input.artifact_version_after || "2.3.0",
    kernel_clarity_before: input.kernel_clarity_before,
    kernel_clarity_after: after,
    loop_clarity_before: input.loop_clarity_before,
    loop_clarity_after: input.loop_clarity_after,
    still_broken: input.still_broken,
    clarity_fixed: isClarityFixed(after, input.still_broken),
    note: input.note?.slice(0, 400),
    audience: input.audience,
  };
  s.probes.unshift(probe);
  s.probes = s.probes.slice(0, 1000);
  s.updated_at = probe.created_at;
  await persist(s);
  return probe;
}

export async function getClarityByVersion() {
  const s = await load();
  const byVer: Record<
    string,
    {
      n: number;
      kernel: number[];
      loop: number[];
      still_yes: number;
      fixed: number;
      with_after: number;
    }
  > = {};
  for (const p of s.probes) {
    const v = p.artifact_version_after || "unknown";
    if (!byVer[v])
      byVer[v] = {
        n: 0,
        kernel: [],
        loop: [],
        still_yes: 0,
        fixed: 0,
        with_after: 0,
      };
    byVer[v].n++;
    if (p.kernel_clarity_after != null) {
      byVer[v].kernel.push(p.kernel_clarity_after);
      byVer[v].with_after++;
      if (p.clarity_fixed || isClarityFixed(p.kernel_clarity_after, p.still_broken))
        byVer[v].fixed++;
    }
    if (p.loop_clarity_after != null) byVer[v].loop.push(p.loop_clarity_after);
    if (p.still_broken === "yes") byVer[v].still_yes++;
  }
  const avg = (xs: number[]) =>
    xs.length
      ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
      : null;
  const versions = Object.entries(byVer).map(([version, v]) => ({
    version,
    n: v.n,
    avg_kernel_clarity: avg(v.kernel),
    avg_loop_clarity: avg(v.loop),
    still_broken_rate:
      v.n > 0 ? Math.round((v.still_yes / v.n) * 1000) / 10 : null,
    /** Share of probes with after-score that count as fixed (≥4) */
    fixed_rate:
      v.with_after > 0
        ? Math.round((v.fixed / v.with_after) * 1000) / 10
        : null,
    fixed_n: v.fixed,
    with_after_n: v.with_after,
    clarity_fixed_min: CLARITY_FIXED_MIN,
  }));

  const deltas: Array<{
    theme: string;
    kernel_delta: number | null;
    loop_delta: number | null;
    still_broken?: string;
    clarity_fixed?: boolean;
  }> = [];
  for (const p of s.probes) {
    if (p.kernel_clarity_before != null && p.kernel_clarity_after != null) {
      deltas.push({
        theme: p.theme,
        kernel_delta:
          Math.round(
            (p.kernel_clarity_after - p.kernel_clarity_before) * 10,
          ) / 10,
        loop_delta:
          p.loop_clarity_before != null && p.loop_clarity_after != null
            ? Math.round(
                (p.loop_clarity_after - p.loop_clarity_before) * 10,
              ) / 10
            : null,
        still_broken: p.still_broken,
        clarity_fixed:
          p.clarity_fixed ??
          isClarityFixed(p.kernel_clarity_after, p.still_broken),
      });
    }
  }

  const keep_sitewide =
    versions.length === 0
      ? null
      : (() => {
          const latest = versions[0];
          const k = latest.avg_kernel_clarity;
          // Only keep if avg after ≥ 4.0 (was soft 3.3 — too weak)
          return k != null ? k >= KEEP_SITEWIDE_KERNEL_MIN : null;
        })();

  return {
    versions,
    sample_deltas: deltas.slice(0, 20),
    median_kernel_delta:
      deltas.length && deltas.filter((d) => d.kernel_delta != null).length
        ? (() => {
            const xs = deltas
              .map((d) => d.kernel_delta!)
              .filter((n) => n != null)
              .sort((a, b) => a - b);
            return xs[Math.floor(xs.length / 2)] ?? null;
          })()
        : null,
    fixed_share:
      deltas.length > 0
        ? Math.round(
            (deltas.filter((d) => d.clarity_fixed).length / deltas.length) *
              1000,
          ) / 10
        : null,
    recommend_keep_sitewide_defaults: keep_sitewide,
    clarity_fixed_min: CLARITY_FIXED_MIN,
    keep_sitewide_kernel_min: KEEP_SITEWIDE_KERNEL_MIN,
    probe_count: s.probes.length,
    updated_at: s.updated_at,
  };
}

export function postShipProbeQuestions(shippedLabels: string[]) {
  const labels =
    shippedLabels.slice(0, 3).join(", ") || "recent Kernel/Loop ships";
  return [
    {
      id: "still_broken",
      prompt: `We shipped fixes for: ${labels}. For you, is the issue fixed?`,
      type: "single" as const,
      required: true,
      options: ["no", "partly", "yes"],
      product_area: "general" as const,
      why: "Post-ship closed loop",
    },
    {
      id: "kernel_clarity_after",
      prompt: `Kernel clarity now (1–5) after the latest artifacts — ≥${CLARITY_FIXED_MIN} counts as fixed`,
      type: "scale" as const,
      required: true,
      product_area: "kernel" as const,
      why: "Counterfactual clarity — only ≥4 counts as fixed",
    },
    {
      id: "loop_clarity_after",
      prompt: "Loop clarity now (1–5) after the latest artifacts",
      type: "scale" as const,
      required: false,
      product_area: "loop" as const,
      why: "Counterfactual clarity",
    },
  ];
}

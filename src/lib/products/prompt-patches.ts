/**
 * Textual-gradient style prompt patches from feedback.
 * propose → dogfood score → accept/ship or rollback.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const PATH = join(process.cwd(), "data", "products", "prompt-patches.json");

export type PromptPatch = {
  id: string;
  created_at: string;
  theme: string;
  target: "system_prompt_short" | "promote_thresholds" | "boot_sequence" | "skill_install";
  criticism: string;
  patch: {
    op: "prepend" | "append" | "replace_hint" | "max_chars" | "set_promote";
    value: string | number | Record<string, unknown>;
  };
  score: {
    length_delta?: number;
    clarity_proxy: number; // 0–1
    install_steps_present: boolean;
    dogfood: number; // 0–1 composite
  };
  status: "proposed" | "accepted" | "shipped" | "rolled_back" | "rejected";
  version: number;
  order_id?: string;
  audience?: string;
  rolled_back_at?: string;
  accepted_at?: string;
};

type Store = {
  updated_at: string;
  patches: PromptPatch[];
  active: string[]; // accepted patch ids applied sitewide
  version: number;
};

let mem: Store | null = null;

function empty(): Store {
  return {
    updated_at: new Date().toISOString(),
    patches: [],
    active: [],
    version: 1,
  };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.patches = mem!.patches || [];
    mem!.active = mem!.active || [];
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

function scorePatch(
  criticism: string,
  patch: PromptPatch["patch"],
): PromptPatch["score"] {
  const crit = criticism.toLowerCase();
  let clarity = 0.55;
  if (/still|long|verbose|budget|context/.test(crit)) clarity += 0.1;
  if (/skill|install|export/.test(crit)) clarity += 0.05;
  if (/broken|not fixed|regress/.test(crit)) clarity += 0.1;
  let length_delta = 0;
  if (patch.op === "max_chars" && typeof patch.value === "number") {
    length_delta = -Math.min(0.4, patch.value / 2000);
    clarity += 0.1;
  }
  if (patch.op === "prepend" || patch.op === "append") {
    const len = String(patch.value).length;
    length_delta = len > 200 ? 0.05 : -0.05;
  }
  const install_steps_present =
    /skill|export|install/i.test(String(patch.value)) ||
    /skill|install/i.test(crit);
  if (install_steps_present) clarity += 0.05;
  clarity = Math.max(0, Math.min(1, clarity));
  const dogfood = Math.max(
    0,
    Math.min(
      1,
      clarity * 0.7 +
        (install_steps_present ? 0.15 : 0) +
        (length_delta < 0 ? 0.15 : 0),
    ),
  );
  return {
    length_delta,
    clarity_proxy: Math.round(clarity * 1000) / 1000,
    install_steps_present,
    dogfood: Math.round(dogfood * 1000) / 1000,
  };
}

export function proposePatchFromText(input: {
  criticism: string;
  theme?: string;
  order_id?: string;
  audience?: string;
}): Omit<PromptPatch, "id" | "created_at" | "version" | "status"> | null {
  const c = (input.criticism || "").trim();
  if (c.length < 12) return null;
  const low = c.toLowerCase();
  let theme = input.theme || "prompt_length";
  let target: PromptPatch["target"] = "system_prompt_short";
  let patch: PromptPatch["patch"] = {
    op: "max_chars",
    value: 700,
  };

  if (/skill|install|export|one.?click/.test(low)) {
    theme = "skill_export";
    target = "skill_install";
    patch = {
      op: "prepend",
      value:
        "ONE-CLICK: GET /api/products/export?token=…&format=skills then load root SKILL.md first.",
    };
  } else if (/promote|replan|draft|loop default|gate/.test(low)) {
    theme = "promote_gate";
    target = "promote_thresholds";
    patch = {
      op: "set_promote",
      value: {
        low_risk: { min_critic: 0.6, min_process: 0.52 },
        draft_or_explore: { min_critic: 0.55, min_process: 0.48 },
        max_replans: 2,
      },
    };
  } else if (/long|verbose|short|prompt|context|budget|chars/.test(low)) {
    theme = "prompt_length";
    target = "system_prompt_short";
    patch = {
      op: "max_chars",
      value: /very long|too long|runtime budget/.test(low) ? 550 : 700,
    };
  } else {
    // generic stop_doing style
    patch = {
      op: "append",
      value: `Reject: ${c.slice(0, 120)}`,
    };
    target = "system_prompt_short";
  }

  const score = scorePatch(c, patch);
  return {
    theme,
    target,
    criticism: c.slice(0, 400),
    patch,
    score,
    order_id: input.order_id,
    audience: input.audience,
  };
}

export async function submitPromptPatch(
  draft: NonNullable<ReturnType<typeof proposePatchFromText>>,
): Promise<PromptPatch> {
  const s = await load();
  const score = draft.score;
  const status: PromptPatch["status"] =
    score.dogfood >= 0.65 ? "accepted" : score.dogfood >= 0.45 ? "proposed" : "rejected";
  const patch: PromptPatch = {
    id: `pp_${Date.now().toString(36)}_${randomBytes(2).toString("hex")}`,
    created_at: new Date().toISOString(),
    ...draft,
    score,
    status,
    version: s.version + (status === "accepted" ? 1 : 0),
    accepted_at: status === "accepted" ? new Date().toISOString() : undefined,
  };
  s.patches.unshift(patch);
  s.patches = s.patches.slice(0, 500);
  if (status === "accepted") {
    s.active = [patch.id, ...s.active.filter((id) => id !== patch.id)].slice(
      0,
      12,
    );
    s.version += 1;
    // Auto-ship when dogfood high
    if (score.dogfood >= 0.75) {
      patch.status = "shipped";
    }
  }
  s.updated_at = patch.created_at;
  await persist(s);
  return patch;
}

export async function rollbackPatch(id: string): Promise<PromptPatch | null> {
  const s = await load();
  const p = s.patches.find((x) => x.id === id);
  if (!p) return null;
  p.status = "rolled_back";
  p.rolled_back_at = new Date().toISOString();
  s.active = s.active.filter((x) => x !== id);
  s.updated_at = p.rolled_back_at;
  await persist(s);
  return p;
}

export async function getActivePatches(): Promise<PromptPatch[]> {
  const s = await load();
  return s.active
    .map((id) => s.patches.find((p) => p.id === id))
    .filter((p): p is PromptPatch => !!p && p.status !== "rolled_back");
}

/** Apply active patches onto a short prompt string */
export function applyPatchesToShortPrompt(
  short: string,
  patches: PromptPatch[],
): string {
  let out = short;
  let maxChars: number | null = null;
  for (const p of patches) {
    if (p.target !== "system_prompt_short" && p.target !== "skill_install")
      continue;
    if (p.patch.op === "prepend") {
      out = `${String(p.patch.value)}\n${out}`;
    } else if (p.patch.op === "append") {
      out = `${out}\n${String(p.patch.value)}`;
    } else if (p.patch.op === "max_chars" && typeof p.patch.value === "number") {
      maxChars = p.patch.value;
    } else if (p.patch.op === "replace_hint") {
      out = `${out}\n# patch: ${String(p.patch.value)}`;
    }
  }
  if (maxChars != null && out.length > maxChars) {
    out =
      out.slice(0, Math.max(200, maxChars - 20)).trimEnd() +
      "\n…[truncated by feedback patch]";
  }
  return out;
}

export function applyPromotePatches(
  base: Record<string, unknown>,
  patches: PromptPatch[],
): Record<string, unknown> {
  let out = { ...base };
  for (const p of patches) {
    if (p.target !== "promote_thresholds") continue;
    if (p.patch.op === "set_promote" && typeof p.patch.value === "object") {
      out = { ...out, ...(p.patch.value as object), from_patch: p.id };
    }
  }
  return out;
}

export async function getPatchReport() {
  const s = await load();
  return {
    version: s.version,
    active: s.active.length,
    recent: s.patches.slice(0, 15),
    shipped: s.patches.filter((p) => p.status === "shipped").slice(0, 10),
    rolled_back: s.patches.filter((p) => p.status === "rolled_back").slice(0, 5),
    updated_at: s.updated_at,
  };
}

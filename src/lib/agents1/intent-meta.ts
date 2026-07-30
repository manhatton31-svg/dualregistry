export type DerivedSkill = { name: string; description?: string };

const STOP = new Set(["the","and","for","with","from","that","this","your","agent","agents","ai","open","source","json","http","https","com","org","github","any","make","set","site","well","known"]);

const THEME: Array<[RegExp, string[]]> = [
  [/discover|registry|catalog|manifest|well-?known/i, ["discovery","registry"]],
  [/search|bm25|retrieval/i, ["search","retrieval"]],
  [/commerce|payment|x402/i, ["commerce","payments"]],
  [/memory|context/i, ["memory","context"]],
  [/orchestr|workflow|multi-?agent/i, ["orchestration","multi-agent"]],
  [/code|coding|typescript|python/i, ["coding","developer-tools"]],
  [/wordpress|typo3|cms/i, ["cms","web"]],
  [/donat|charit|giving/i, ["donations","nonprofit"]],
  [/a2a|peer/i, ["a2a","agents"]],
  [/mcp/i, ["mcp","tools"]],
  [/research|brief/i, ["research","summarization"]],
];

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9+.#\s-]/g, " ").split(/[\s/_-]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, "").trim())
    .filter((t) => t.length >= 3 && t.length <= 32 && !STOP.has(t) && !/^\d/.test(t) && !/^v?\d/.test(t));
}

function nonEmpty(arr?: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => {
    if (typeof x === "string") return x.trim();
    if (x && typeof x === "object" && "name" in x) {
      const n = (x as { name?: unknown }).name;
      return typeof n === "string" ? n.trim() : "";
    }
    return "";
  }).filter(Boolean);
}

export function listingHasIntentMeta(input: { skills?: unknown; capabilities?: unknown }) {
  return nonEmpty(input.skills).length > 0 || nonEmpty(input.capabilities).length > 0;
}

export function deriveAgentIntentMeta(input: {
  name?: string | null;
  description?: string | null;
  repository?: string | null;
  website?: string | null;
  skills?: unknown;
  capabilities?: unknown;
  tags?: unknown;
  protocols?: unknown;
  framework?: string | null;
}): { skills: DerivedSkill[]; capabilities: string[]; derived: boolean; detail: string } {
  const existingSkills = nonEmpty(input.skills).map((name) => ({ name: name.slice(0, 64), description: `Declared skill: ${name}` }));
  const existingCaps = nonEmpty(input.capabilities).map((c) => c.slice(0, 48));
  if (existingSkills.length || existingCaps.length) {
    const caps = uniq([...existingCaps, ...existingSkills.map((s) => s.name), "agents"]).slice(0, 16);
    const skills = existingSkills.length ? existingSkills.slice(0, 12) : caps.slice(0, 5).map((name) => ({ name, description: `Capability: ${name}` }));
    return { skills, capabilities: caps, derived: false, detail: `explicit intent (${skills.length}/${caps.length})` };
  }
  const blob = [input.name, input.description, input.repository, input.website, input.framework].filter(Boolean).join(" ");
  const caps = new Set<string>(["agents"]);
  const skills: DerivedSkill[] = [];
  for (const [re, list] of THEME) if (re.test(blob)) for (const c of list) caps.add(c);
  const m = (input.repository || "").match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (m) for (const t of tokenize(m[2].replace(/\.git$/i, "")).slice(0, 4)) { caps.add(t); skills.push({ name: t, description: `From repo token ${t}` }); }
  for (const t of tokenize(input.description || "").slice(0, 8)) {
    caps.add(t);
    if (skills.length < 8) skills.push({ name: t, description: "Inferred from description" });
  }
  const nameSlug = (input.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  if (!skills.length) skills.push({ name: nameSlug || "agent", description: (input.description || "").slice(0, 160) || "Peer agent surface" });
  if (!skills.some((s) => s.name === "peer-discovery")) skills.unshift({ name: "peer-discovery", description: "Open peer discovery listing" });
  for (const p of nonEmpty(input.protocols)) caps.add(p.toLowerCase());
  const capList = uniq([...caps]).slice(0, 16);
  return { skills: dedupe(skills).slice(0, 12), capabilities: capList, derived: true, detail: `derived ${capList.length} caps + ${Math.min(skills.length,12)} skills` };
}

function uniq(arr: string[]) {
  const out: string[] = []; const seen = new Set<string>();
  for (const x of arr) { const k = x.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(x); }
  return out;
}
function dedupe(skills: DerivedSkill[]) {
  const out: DerivedSkill[] = []; const seen = new Set<string>();
  for (const s of skills) { const k = s.name.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(s); }
  return out;
}

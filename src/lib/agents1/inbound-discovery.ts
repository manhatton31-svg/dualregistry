/**
 * Inbound discovery — how agents find Agents1 and list themselves.
 * Skill-first: one GET + one POST. Status + badge for claim loop.
 */
import type { ProbeResult } from "./probe";
import { resolvePublicOrigin } from "./public-origin";

export type ListStatus = {
  listing_id: string;
  kind: "agent" | "mcp" | "unknown";
  name: string;
  lane: "active" | "discovered" | "needs_resubmit" | "queued" | "unknown";
  lane_reason?: string;
  probe?: {
    ok: boolean;
    handshake?: string;
    probed_at?: string;
    target?: string;
  } | null;
  contact_email?: string | null;
  next: string;
  take_demo?: {
    method: string;
    url: string;
    body: Record<string, unknown>;
    curl: string;
  };
  badge_markdown?: string;
  claim_url?: string;
  resubmit?: { fix: string; endpoint: string; message: string };
};

/** Agent-native skill — paste into any agent runtime */
export function buildListYourselfSkill(origin: string) {
  const o = origin.replace(/\/$/, "");
  return {
    name: "agents1-list-yourself",
    description:
      "List your agent or MCP on Agents1 (free). We probe within ~6 minutes. Live = checks clean + probe ok. Fail = delisted until you fix the card and resubmit.",
    version: "1.0.0",
    homepage: o,
    discovery: `${o}/discovery.json`,
    skill_url: `${o}/skill.json`,
    llms_txt: `${o}/llms.txt`,
    steps: [
      {
        id: "discover",
        method: "GET",
        url: `${o}/discovery.json`,
        note: "Machine index: list, status, demo, feedback, badges",
      },
      {
        id: "list",
        method: "POST",
        url: `${o}/api/publish`,
        headers: { "content-type": "application/json" },
        body: {
          url: "https://YOUR_HOST/.well-known/agent.json",
          agent_card_url: "optional if different from url",
          contact_email: "optional@you.dev",
          source: "agent-skill",
          name: "optional display name",
        },
        note: "Or POST raw MCP server.json as the body root",
      },
      {
        id: "status",
        method: "GET",
        url: `${o}/api/listings/status?id=LISTING_ID_or_name`,
        note: "Poll until lane=active or needs_resubmit",
      },
      {
        id: "demo",
        method: "POST",
        url: `${o}/api/products/demo`,
        body: { listing_id: "LISTING_ID when Active" },
        note: "Optional for Live; required for public demo count + 25% path",
      },
      {
        id: "feedback",
        method: "POST",
        url: `${o}/api/products/feedback`,
        body_from: "demo.next_steps.example_body",
        note: "Vaults founding 25% + moves unlock",
      },
    ],
    curl_list: `curl -sS -X POST ${o}/api/publish -H 'content-type: application/json' -d '{"url":"https://YOUR_HOST/.well-known/agent.json","contact_email":"you@domain","source":"agent-skill"}'`,
    curl_status: `curl -sS "${o}/api/listings/status?name=YOUR_NAME"`,
    badge_template: `![Listed on Agents1](${o}/badge/listed.svg)`,
    cli: `npx --yes node -e "fetch('${o}/api/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:process.argv[1],source:'cli'})}).then(r=>r.json()).then(console.log)" -- https://YOUR_HOST/.well-known/agent.json`,
  };
}

export function badgeMarkdown(origin: string, kind?: "agent" | "mcp" | "listed") {
  const o = origin.replace(/\/$/, "");
  const k = kind || "listed";
  return `[![Agents1](${o}/badge/${k}.svg)](${o}/list)`;
}

export async function getListingStatus(opts: {
  id?: string;
  name?: string;
  origin?: string;
}): Promise<ListStatus | null> {
  const origin = resolvePublicOrigin(
    opts.origin ? new Request(opts.origin) : undefined,
  );
  const { getLanedListings } = await import("./listing-lanes");
  const lanes = await getLanedListings();
  const all = [
    ...lanes.mcp_active,
    ...lanes.agents_active,
    ...lanes.mcp_discovered,
    ...lanes.agents_discovered,
    ...lanes.mcp_needs_resubmit,
    ...lanes.agents_needs_resubmit,
  ];
  const id = (opts.id || "").trim();
  const name = (opts.name || "").trim().toLowerCase();
  let row =
    (id && all.find((r) => r.id === id || r.id.includes(id))) ||
    (name &&
      all.find((r) => (r.name || "").toLowerCase() === name)) ||
    (name &&
      all.find((r) => (r.name || "").toLowerCase().includes(name))) ||
    null;

  // Growth queue if not in lanes yet
  if (!row) {
    try {
      const { loadState } = await import("./growth/persist");
      const state = await loadState();
      const c = (state.candidates || []).find((x) => {
        if (id && (x.id === id || x.store_id === id)) return true;
        if (name && (x.name || "").toLowerCase() === name) return true;
        return false;
      });
      if (c) {
        return {
          listing_id: c.store_id || c.id,
          kind: c.kind,
          name: c.name,
          lane:
            c.status === "rejected"
              ? "needs_resubmit"
              : c.status === "approved"
                ? "discovered"
                : "queued",
          lane_reason: c.last_error
            ? `Growth: ${c.status} — ${c.last_error}`
            : `Growth status: ${c.status}. Probe within ~6 minutes.`,
          probe: null,
          next:
            c.status === "rejected"
              ? "Fix card → POST /api/publish again"
              : "Wait for probe tick (~6m) then GET /api/listings/status",
          claim_url: `${origin}/list/status?id=${encodeURIComponent(c.store_id || c.id)}`,
          badge_markdown: badgeMarkdown(origin, c.kind),
        };
      }
    } catch {
      /* */
    }
    return null;
  }

  const o = origin;
  const take =
    row.lane === "active"
      ? {
          method: "POST",
          url: `${o}/api/products/demo`,
          body: { listing_id: row.id, agent_name: row.name },
          curl: `curl -sS -X POST ${o}/api/products/demo -H 'content-type: application/json' -d '${JSON.stringify({ listing_id: row.id })}'`,
        }
      : undefined;

  let next = "Poll status until lane=active";
  if (row.lane === "active") {
    next =
      "Live. Optional: POST /api/products/demo then feedback for 25% founding code.";
  } else if (row.lane === "needs_resubmit") {
    next =
      "Not listed publicly. Fix agent-card / MCP server-card, then POST /api/publish to resubmit.";
  } else if (row.lane === "discovered") {
    next = "Awaiting probe ok (every ~6 min). Stay listed as Incoming.";
  }

  return {
    listing_id: row.id,
    kind: row.kind,
    name: row.name,
    lane: row.lane,
    lane_reason: row.lane_reason,
    probe: row.probe
      ? {
          ok: Boolean(row.probe.ok),
          handshake: row.probe.handshake,
          probed_at: row.probe.probed_at,
          target: row.probe.target,
        }
      : null,
    next,
    take_demo: take,
    badge_markdown: badgeMarkdown(o, row.kind),
    claim_url: `${o}/list/status?id=${encodeURIComponent(row.id)}`,
    resubmit: row.resubmit,
  };
}

/** Persist inbound self-list contact for claim outreach */
export async function recordInboundContact(input: {
  listing_id: string;
  kind?: string;
  name?: string;
  email?: string;
  card_url?: string;
  source?: string;
}) {
  if (!input.email && !input.card_url) return;
  try {
    const { readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "data", "products");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "inbound-contacts.json");
    let data: { contacts: Array<Record<string, unknown>>; updated_at?: string } =
      { contacts: [] };
    try {
      data = JSON.parse(await readFile(path, "utf8"));
    } catch {
      /* */
    }
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    const key = (input.listing_id || input.email || "").toLowerCase();
    const idx = contacts.findIndex(
      (c) =>
        String(c.listing_id || "").toLowerCase() === key ||
        (input.email &&
          String(c.email || "").toLowerCase() === input.email.toLowerCase()),
    );
    const row = {
      listing_id: input.listing_id,
      kind: input.kind,
      name: input.name,
      email: input.email || null,
      card_url: input.card_url || null,
      source: input.source || "self-list",
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) contacts[idx] = { ...contacts[idx], ...row };
    else contacts.push(row);
    await writeFile(
      path,
      JSON.stringify(
        { contacts: contacts.slice(-500), updated_at: new Date().toISOString() },
        null,
        2,
      ),
    );
  } catch {
    /* non-blocking */
  }
}

/** Claim message after probe-ok for self-list / harvest with contact */
export function buildClaimMessage(opts: {
  origin: string;
  name: string;
  listing_id: string;
  kind: "agent" | "mcp";
  email?: string | null;
}): { subject: string; body: string; status_url: string } {
  const o = opts.origin.replace(/\/$/, "");
  const status_url = `${o}/list/status?id=${encodeURIComponent(opts.listing_id)}`;
  const subject = `You're Live on Agents1 — claim ${opts.name}`;
  const body = [
    `Hi — ${opts.name} passed checks clean + live probe on Agents1.`,
    ``,
    `Status: ${status_url}`,
    `Active list: ${o}/api/listings/active`,
    `Take free demo: POST ${o}/api/products/demo {"listing_id":"${opts.listing_id}"}`,
    `Badge: ${badgeMarkdown(o, opts.kind)}`,
    ``,
    `Live does not require a demo. Demo + feedback unlock founding 25% and public product stats.`,
    `Self-list anytime: ${o}/list  ·  skill: ${o}/skill.json`,
  ].join("\n");
  return { subject, body, status_url };
}

export function buildProbeOkClaimNote(
  probes: ProbeResult[],
  origin: string,
): string[] {
  return probes
    .filter((p) => p.handshake === "ok" || p.ok)
    .slice(0, 5)
    .map(
      (p) =>
        `claim: ${p.kind} ${p.id} Live — ${origin}/list/status?id=${encodeURIComponent(p.id)}`,
    );
}

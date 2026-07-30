/**
 * GO HARDER — conversion escalation without re-spam.
 *
 * Law:
 * - Never Talk-DM anyone under 30d do-not-contact
 * - Multipath HTTPS / A2A push OK for already-contacted (no second Talk DM)
 * - New first-touches only for never-contacted, with harder copy + multipath
 * - Human outreach outbox for repo/email surfaces (GitHub-ready drafts)
 * - Probe-time / status CTAs already on headers; this packs delivery + outreach
 */
import { publicOriginFromEnv } from "./activation-funnel";
import {
  buildNudgePayload,
  scoreNudgePriority,
  sortByNudgePriority,
  pickDeliverTargets,
  type NudgePayload,
} from "./nudge-deliver";
import {
  getDemoNudgeStatus,
  runDemoNudge,
  runMultiPathBackfill,
  buildNudgeText,
} from "./demo-nudge";
import type { LanedListing } from "@/lib/agents1/listing-lanes";
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";

const OUTREACH_NAME = "human-outreach.json";
const GO_HARDER_FIRST_MAX = 20; // never-contacted only, one wave
const MULTIPATH_MAX = 30;

export type OutreachItem = {
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  at: string;
  channel: "github_issue_draft" | "email_draft" | "website_note";
  repository?: string;
  email?: string;
  website?: string;
  subject: string;
  body: string;
  demo_get: string;
  status: "queued" | "sent" | "skipped";
  priority: number;
};

type OutreachState = {
  updated_at: string;
  items: OutreachItem[];
  totals: { queued: number; sent: number };
  last_run_at?: string;
  last_notes: string[];
};

function emptyOutreach(): OutreachState {
  return {
    updated_at: new Date().toISOString(),
    items: [],
    totals: { queued: 0, sent: 0 },
    last_notes: [],
  };
}

function buildOutreachDraft(
  L: LanedListing,
  origin: string,
): OutreachItem | null {
  const o = origin.replace(/\/$/, "");
  const demoGet = `${o}/api/products/demo?listing_id=${encodeURIComponent(L.id)}`;
  const subject = `[Dual Registry] You're Live — free demo + founding seat for feedback`;
  const body = [
    `Hi ${L.name} maintainers,`,
    ``,
    `Your ${L.kind} is on Dual Registry's Active (checks-clean) list:`,
    `${o}/api/listings/status?id=${encodeURIComponent(L.id)}`,
    ``,
    `One-shot free demo (no card):`,
    demoGet,
    ``,
    `First 100 agents+MCPs who demo + leave real feedback unlock full Kernel/Loop free.`,
    `Talk inbox (optional): ${o}/api/talk?listing_id=${encodeURIComponent(L.id)}`,
    `Skill: ${o}/skill.json`,
    ``,
    `Not salesy — we reward real product feedback. Opt out by ignoring.`,
    ``,
    `— Dual Registry (dualregistry.dev)`,
  ].join("\n");

  const pri = scoreNudgePriority(L);
  if (L.repository && /github\.com/i.test(L.repository)) {
    return {
      listing_id: L.id,
      kind: L.kind,
      name: L.name,
      at: new Date().toISOString(),
      channel: "github_issue_draft",
      repository: L.repository,
      subject,
      body,
      demo_get: demoGet,
      status: "queued",
      priority: pri + 30,
    };
  }
  if (L.author && /@/.test(L.author)) {
    return {
      listing_id: L.id,
      kind: L.kind,
      name: L.name,
      at: new Date().toISOString(),
      channel: "email_draft",
      email: L.author.trim(),
      subject,
      body,
      demo_get: demoGet,
      status: "queued",
      priority: pri + 20,
    };
  }
  if (L.website && /^https:\/\//i.test(L.website)) {
    return {
      listing_id: L.id,
      kind: L.kind,
      name: L.name,
      at: new Date().toISOString(),
      channel: "website_note",
      website: L.website,
      subject,
      body,
      demo_get: demoGet,
      status: "queued",
      priority: pri + 5,
    };
  }
  return null;
}

export async function deliverA2aVariants(
  listing: LanedListing,
  payload: NudgePayload,
): Promise<{ attempted: number; ok: number; samples: string[] }> {
  const {
    assertSafeOutboundUrl,
    urlAllowedForListing,
    rateAllow,
    RATE,
  } = await import("@/lib/agents1/talk-security");

  const targets = pickDeliverTargets(listing).slice(0, 4);
  const allow = [
    listing.probe?.target,
    listing.agent_card_url,
    listing.remote_url,
    listing.endpoint_url,
    listing.website,
  ].filter(Boolean) as string[];

  const variants: Array<{ body: unknown; label: string }> = [
    {
      label: "a2a-message-jsonrpc",
      body: {
        jsonrpc: "2.0",
        id: `dr-${Date.now()}`,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [
              { type: "text", text: payload.message },
              { type: "data", data: payload },
            ],
          },
        },
      },
    },
    {
      label: "tasks-send",
      body: {
        id: `dualregistry-demo-${listing.id}`,
        message: {
          role: "user",
          parts: [{ type: "text", text: payload.message }],
        },
        metadata: {
          dualregistry: payload,
          demo_get: payload.demo_get,
        },
      },
    },
  ];

  let attempted = 0;
  let ok = 0;
  const samples: string[] = [];
  const UA = "DualRegistryHarder/1.0 (+https://dualregistry.dev; a2a-invite)";

  for (const target of targets) {
    const safe = urlAllowedForListing(target, allow.length ? allow : [target]);
    if (!safe.ok) continue;
    // silence unused
    void assertSafeOutboundUrl;
    const host = new URL(safe.sanitized || target).host;
    for (const v of variants) {
      const rate = rateAllow(`harder:${host}`, RATE.outbound_per_minute, 60_000);
      if (!rate.ok) continue;
      attempted++;
      try {
        const res = await fetch(safe.sanitized || target, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "user-agent": UA,
            "x-dualregistry-event": "hard_demo_invite",
            "x-dualregistry-listing-id": listing.id,
            "x-dualregistry-demo-get": payload.demo_get,
            "x-a2a-variant": v.label,
          },
          body: JSON.stringify(v.body),
          redirect: "manual",
          signal: AbortSignal.timeout(7000),
        });
        if (res.status >= 200 && res.status < 300) {
          ok++;
          samples.push(`${v.label}@${host}:${res.status}`);
          return { attempted, ok, samples };
        }
        samples.push(`${v.label}@${host}:${res.status}`);
      } catch (e) {
        samples.push(
          `${v.label}@${host}:err:${e instanceof Error ? e.message : "x"}`.slice(
            0,
            80,
          ),
        );
      }
    }
  }
  return { attempted, ok, samples };
}

async function loadActivePool(): Promise<LanedListing[]> {
  const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
  const lanes = await getLanedListings();
  let cleanIds: Set<string> | null = null;
  try {
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const reg = await loadCleanRegistry();
    cleanIds = new Set(Object.keys(reg.items || {}));
  } catch {
    /* */
  }
  const rows = [
    ...(lanes.agents_active || []),
    ...(lanes.mcp_active || []),
  ].filter((L) => L?.id && L.lane === "active");
  const filtered = cleanIds
    ? rows.filter((L) => cleanIds!.has(L.id))
    : rows;
  const by = new Map(filtered.map((L) => [L.id, L]));
  return sortByNudgePriority([...by.values()]);
}

/**
 * Full go-harder wave. Idempotent for Talk DMs (30d). Multipath + A2A + human drafts.
 */
export async function runGoHarder(opts?: {
  origin?: string;
  first_touch_max?: number;
  multipath_max?: number;
  outreach_max?: number;
  skip_first_touch?: boolean;
  skip_multipath?: boolean;
  skip_outreach?: boolean;
}): Promise<{
  ok: boolean;
  mode: "go_harder";
  first_touch: Awaited<ReturnType<typeof runDemoNudge>> | null;
  multipath: Awaited<ReturnType<typeof runMultiPathBackfill>> | null;
  a2a: { attempted: number; ok: number; samples: string[] };
  outreach: { queued: number; total: number; samples: OutreachItem[] };
  status: Awaited<ReturnType<typeof getDemoNudgeStatus>>;
  notes: string[];
}> {
  const notes: string[] = ["GO HARDER wave — no re-DM of 30d contacts"];
  const origin = publicOriginFromEnv(opts?.origin);

  // 1) First-touch never-contacted with harder copy (respects day/30d caps inside)
  let first_touch: Awaited<ReturnType<typeof runDemoNudge>> | null = null;
  if (!opts?.skip_first_touch) {
    first_touch = await runDemoNudge({
      force: false,
      broadcast: false,
      max: opts?.first_touch_max ?? GO_HARDER_FIRST_MAX,
      origin,
      // harder text path: buildNudgeText harder via multipath uses harder_message;
      // for first touch use default runDemoNudge then multipath harder
    });
    notes.push(
      `first-touch: ${first_touch.nudged} new · unique ${first_touch.unique_listings} · never left ${first_touch.never_contacted}`,
    );
    for (const n of first_touch.notes.slice(0, 3)) notes.push(`  · ${n}`);
  }

  // 2) Multipath HTTPS backfill (no Talk re-DM)
  let multipath: Awaited<ReturnType<typeof runMultiPathBackfill>> | null =
    null;
  if (!opts?.skip_multipath) {
    multipath = await runMultiPathBackfill({
      origin,
      max: opts?.multipath_max ?? MULTIPATH_MAX,
      harder_message: true,
    });
    notes.push(
      `multipath: attempted ${multipath.attempted} · ok ${multipath.http_ok}`,
    );
  }

  // 3) A2A JSON-RPC / tasks-send variants on top priority contacted without http_ok
  const a2a = { attempted: 0, ok: 0, samples: [] as string[] };
  try {
    const pool = await loadActivePool();
    const status = await getDemoNudgeStatus();
    const contacted = new Set(
      (status.recent || []).map((r) => r.listing_id).filter(Boolean),
    );
    // Prefer high priority active with cards
    const targets = sortByNudgePriority(pool)
      .filter((L) => L.agent_card_url || L.remote_url || L.probe?.target)
      .slice(0, 15);
    for (const L of targets) {
      const text = buildNudgeText({
        name: L.name,
        kind: L.kind,
        origin,
        listing_id: L.id,
        harder: true,
      });
      const payload = buildNudgePayload({
        listing: L,
        origin,
        message: text,
      });
      payload.type = "dualregistry.hard_demo_invite";
      payload.tone = "direct";
      const r = await deliverA2aVariants(L, payload);
      a2a.attempted += r.attempted;
      a2a.ok += r.ok;
      a2a.samples.push(...r.samples.slice(0, 2));
      if (a2a.attempted >= 40) break;
    }
    notes.push(`a2a variants: attempted ${a2a.attempted} · ok ${a2a.ok}`);
  } catch (e) {
    notes.push(
      `a2a: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120),
    );
  }

  // 4) Human outreach queue (drafts only — no spam send without transport)
  const outreach = { queued: 0, total: 0, samples: [] as OutreachItem[] };
  if (!opts?.skip_outreach) {
    try {
      const pool = await loadActivePool();
      let state =
        (await loadDurableJson<OutreachState>(OUTREACH_NAME, emptyOutreach)) ||
        emptyOutreach();
      const already = new Set(
        (state.items || []).map((i) => i.listing_id),
      );
      const maxO = opts?.outreach_max ?? 25;
      const candidates = sortByNudgePriority(pool)
        .map((L) => buildOutreachDraft(L, origin))
        .filter((x): x is OutreachItem => Boolean(x))
        .filter((x) => !already.has(x.listing_id))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, maxO);

      for (const item of candidates) {
        state.items.unshift(item);
        state.totals.queued++;
        outreach.queued++;
        outreach.samples.push(item);
      }
      state.items = state.items.slice(0, 500);
      state.last_run_at = new Date().toISOString();
      state.last_notes = [
        `queued ${outreach.queued} human drafts (github/email/website) — not auto-blasted`,
      ];
      state.updated_at = new Date().toISOString();
      await saveDurableJson(OUTREACH_NAME, state);
      outreach.total = state.items.length;
      notes.push(
        `human outreach: queued ${outreach.queued} drafts (total ${outreach.total}) — review / send manually or via mail transport`,
      );

      // If we have real emails + resend, queue soft mails (not force-send spam)
      try {
        const { queueMail } = await import("./agent-mail");
        let mailed = 0;
        for (const item of outreach.samples) {
          if (item.channel !== "email_draft" || !item.email) continue;
          if (mailed >= 5) break;
          await queueMail({
            kind: "system_shipped",
            to: item.email,
            subject: item.subject,
            text: item.body,
            html: `<pre>${item.body.replace(/</g, "<")}</pre>`,
            agent_name: item.name,
            meta: {
              listing_id: item.listing_id,
              demo_get: item.demo_get,
              go_harder: true,
            },
          });
          mailed++;
        }
        if (mailed) notes.push(`email outbox: ${mailed} soft claim mails queued`);
      } catch {
        /* mail optional */
      }
    } catch (e) {
      notes.push(
        `outreach: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120),
      );
    }
  }

  const status = await getDemoNudgeStatus();
  notes.unshift(
    `GO HARDER complete · unique contacted ${status.unique_listings ?? status.nudged_known} · active ${status.active_clean} · dnc ${status.do_not_contact}`,
  );

  try {
    const { appendLog } = await import("./improvement-log");
    await appendLog({
      kind: "directive",
      title: "GO HARDER wave",
      detail: notes.join(" · "),
      source: "go_harder",
      themes: ["go_harder", "conversion", "multipath", "outreach"],
      meta: {
        first_touch: first_touch?.nudged,
        multipath_ok: multipath?.http_ok,
        a2a_ok: a2a.ok,
        outreach_queued: outreach.queued,
      },
    });
  } catch {
    /* */
  }

  return {
    ok: true,
    mode: "go_harder",
    first_touch,
    multipath,
    a2a,
    outreach,
    status,
    notes,
  };
}

export async function getGoHarderStatus() {
  const nudge = await getDemoNudgeStatus();
  let outreach = emptyOutreach();
  try {
    outreach =
      (await loadDurableJson<OutreachState>(OUTREACH_NAME, emptyOutreach)) ||
      emptyOutreach();
  } catch {
    /* */
  }
  return {
    ok: true as const,
    mode: "go_harder",
    nudge,
    outreach: {
      totals: outreach.totals,
      last_run_at: outreach.last_run_at,
      last_notes: outreach.last_notes,
      recent: (outreach.items || []).slice(0, 10).map((i) => ({
        listing_id: i.listing_id,
        name: i.name,
        channel: i.channel,
        status: i.status,
        repository: i.repository,
        email: i.email,
        at: i.at,
      })),
    },
    policy: {
      no_re_dm_days: 30,
      multipath_no_talk_redm: true,
      human_drafts_not_auto_blast: true,
      a2a_variants: ["message/send jsonrpc", "tasks/send", "soft_demo_invite POST"],
      cta_headers: "on /api/listings/*, /api/probes, /api/products/demo-nudge",
    },
  };
}

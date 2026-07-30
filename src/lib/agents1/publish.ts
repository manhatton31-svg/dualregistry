/**
 * Dual-publish: same server.json / agent card used for official MCP registry.
 * Free list path — respects free-tier put budget.
 */
import { enrichCandidate } from "./growth/enrich";
import { submitByUrl } from "./growth/engine";
import { canSubmit } from "./free-tier";
import type { GrowthCandidate, SubmitByUrlResult } from "./growth/types";
import {
  candidateKey,
  loadState,
  saveState,
  syncKvFromFreeTier,
} from "./growth/persist";
import { preflightQualityGate } from "./growth/quality-gate";
import { fetchStoreIndex, submitCandidate } from "./growth/submit";
import { validateA2ACard } from "./a2a-card";
import { buildConversionPath, type ConversionPath } from "@/lib/products/conversion";
import { buildApprovalNext } from "@/lib/products/demo-funnel";
import { resolvePublicOrigin } from "./public-origin";
import { trackFunnel } from "@/lib/products/learning-loop";

export type PublishInput = {
  /** Direct URL to agent card, server.json, repo, or website */
  url?: string;
  /** Inline official MCP server.json body */
  server_json?: Record<string, unknown>;
  /** Prefer agent card URL */
  agent_card_url?: string;
  source?: string;
  /** Score only — never write to store */
  score_only?: boolean;
  /** Public origin for conversion absolute URLs */
  origin?: string;
};

export type PublishResult = SubmitByUrlResult & {
  dual_publish?: boolean;
  install_snippets?: {
    vscode: string;
    cursor: string;
    claude: string;
  };
  quality?: {
    approvalLikelihood: number;
    surfaceTier: number;
    protocolTags: string[];
    pass: boolean;
  };
  /** Founding funnel — preview → buy Alive → export → verify badge */
  conversion?: ConversionPath;
  /** Protocol next step — agents should call demo immediately */
  next?: string;
  approval_next?: unknown;
  personal_invite?: string;
};

function installSnippets(c: GrowthCandidate) {
  const name = (c.name || "server")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const remote = c.remote_url || c.endpoint_url || c.website || "";
  const repo = c.repository || "";
  const vscode = JSON.stringify(
    {
      servers: {
        [name]: remote
          ? { type: "http", url: remote }
          : repo
            ? {
                command: "npx",
                args: ["-y", repo.replace(/^https?:\/\/github\.com\//i, "")],
              }
            : { command: "npx", args: ["-y", name] },
      },
    },
    null,
    2,
  );
  return {
    vscode,
    cursor: vscode,
    claude: `# Add to Claude Desktop mcpServers\n"${name}": ${remote ? `{ "url": "${remote}" }` : `{ "command": "npx", "args": ["-y", "${name}"] }`}`,
  };
}

function fromServerJson(
  sj: Record<string, unknown>,
  source: string,
): GrowthCandidate {
  const name = String(sj.name || sj.title || "mcp-server").slice(0, 80);
  const title = typeof sj.title === "string" ? sj.title : undefined;
  const description =
    typeof sj.description === "string"
      ? sj.description
      : `${title || name} MCP server dual-published to Agents1 from official server.json.`;
  const repo =
    typeof sj.repository === "string"
      ? sj.repository
      : (sj.repository as { url?: string } | undefined)?.url;
  const website =
    typeof sj.websiteUrl === "string"
      ? sj.websiteUrl
      : typeof sj.website_url === "string"
        ? sj.website_url
        : typeof sj.website === "string"
          ? sj.website
          : repo;
  const remotes = Array.isArray(sj.remotes)
    ? (sj.remotes as Array<{ url?: string; type?: string }>)
    : [];
  const remote = remotes.find((r) => r.url)?.url;
  const transport = remotes.find((r) => r.type)?.type;
  const hints = [
    "dual-publish",
    "server.json",
    transport ? `transport:${transport}` : "",
    remote ? "proto:remote" : "",
    "proto:2025-03-26",
  ].filter(Boolean);
  if (transport === "streamable-http" || transport === "http") {
    hints.push("proto:2026-07-28", "transport:streamable-http");
  }
  const ts = new Date().toISOString();
  return {
    id: `mcp-publish-${Date.now().toString(36)}`,
    kind: "mcp",
    name: (title || name.split("/").pop() || name).slice(0, 80),
    description: description.slice(0, 600),
    repository: repo,
    website: website || repo,
    remote_url: remote,
    author: name.includes("/")
      ? name.split("/")[0]
      : name.split(".")[0],
    source,
    status: "queued",
    attempts: 0,
    discovered_at: ts,
    updated_at: ts,
    quality_hints: hints,
  };
}

function fromAgentCard(
  card: Record<string, unknown>,
  cardUrl: string,
  source: string,
): GrowthCandidate {
  const v = validateA2ACard(card);
  const ts = new Date().toISOString();
  return {
    id: `agent-publish-${Date.now().toString(36)}`,
    kind: "agent",
    name: (v.card?.name || "agent").slice(0, 80),
    description: (
      v.card?.description ||
      `${v.card?.name || "Agent"} dual-listed on Agents1 via agent card.`
    ).slice(0, 600),
    website: v.card?.url || cardUrl,
    endpoint_url: v.card?.url || cardUrl,
    agent_card_url: cardUrl,
    protocols: v.card?.protocols || ["a2a", "rest"],
    skills: v.card?.skills?.map((s) => ({
      name: s.name,
      description: s.description,
    })) || [{ name: "agent", description: "A2A agent surface" }],
    capabilities: ["agents", "discovery"],
    source,
    status: "queued",
    attempts: 0,
    discovered_at: ts,
    updated_at: ts,
    quality_hints: ["dual-publish", "a2a-card", "proto:a2a"],
  };
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Agents1Publish/1.1",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const t = await res.text();
    if (!t.trim().startsWith("{")) return null;
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function submitCandidateLocal(
  candidate: GrowthCandidate,
  origin = "",
): Promise<PublishResult> {
  let state = await loadState();
  const gate = await canSubmit();
  if (!gate.allow) {
    candidate.status = "deferred";
    candidate.last_error = gate.reason;
    state.candidates.unshift(candidate);
    await saveState(state);
    return {
      ok: false,
      kind: candidate.kind,
      candidate,
      message: gate.reason,
      dual_publish: true,
    };
  }

  candidate = await enrichCandidate(candidate);
  const qg = preflightQualityGate(candidate);

  try {
    const index = await fetchStoreIndex();
    const name = candidate.name.toLowerCase();
    const repo = (candidate.repository || "").toLowerCase();
    const listed =
      candidate.kind === "agent"
        ? index.agent_names.includes(name) ||
          (repo && index.agent_repos.some((r) => r.includes(repo) || repo.includes(r)))
        : index.mcp_names.includes(name) ||
          (repo && index.mcp_repos.some((r) => r.includes(repo) || repo.includes(r)));
    if (listed) {
      candidate.status = "duplicate";
      state.candidates.unshift(candidate);
      await saveState(state);
      return {
        ok: true,
        kind: candidate.kind,
        candidate,
        message: "Already listed in store registry",
        dual_publish: true,
        quality: {
          approvalLikelihood: qg.approvalLikelihood,
          surfaceTier: qg.surfaceTier,
          protocolTags: qg.protocolTags,
          pass: qg.pass,
        },
        install_snippets: installSnippets(candidate),
      };
    }
  } catch {
    /* */
  }

  if (!qg.pass) {
    candidate.status = "failed";
    candidate.last_error = qg.reasons.join("; ");
    state.candidates.unshift(candidate);
    await saveState(state);
    return {
      ok: false,
      kind: candidate.kind,
      candidate,
      message: `Quality gate: ${qg.reasons.join("; ")}`,
      dual_publish: true,
      quality: {
        approvalLikelihood: qg.approvalLikelihood,
        surfaceTier: qg.surfaceTier,
        protocolTags: qg.protocolTags,
        pass: false,
      },
    };
  }

  const result = await submitCandidate(candidate);
  candidate.attempts = 1;
  candidate.updated_at = new Date().toISOString();
  if (result.kv_limited) {
    candidate.status = "deferred";
    candidate.last_error = result.error;
  } else if (result.duplicate) {
    candidate.status = "duplicate";
    candidate.store_id = result.item?.id;
    state.totals.submitted++;
  } else if (result.approved || result.created) {
    candidate.status = "approved";
    candidate.store_id = result.item?.id;
    candidate.safety_score = result.safety_score;
    state.totals.submitted++;
    state.totals.approved++;
  } else if (result.ok) {
    candidate.status = "submitted";
    candidate.safety_score = result.safety_score;
    state.totals.submitted++;
  } else {
    candidate.status = "failed";
    candidate.last_error = result.error || result.message;
  }
  // dedupe key track
  void candidateKey(candidate);
  state.candidates.unshift(candidate);
  state.kv = await syncKvFromFreeTier(state.kv);
  await saveState(state);

  const baseMsg =
    result.message ||
    result.error ||
    (candidate.status === "approved"
      ? `Auto-approved (score ${result.safety_score ?? qg.approvalLikelihood})`
      : candidate.status === "duplicate"
        ? "Already listed"
        : candidate.status === "deferred"
          ? "Deferred until free-tier reset"
          : "Submitted");

  let conversion: ConversionPath | undefined;
  let approval_next: unknown;
  let personal_invite: string | undefined;
  let next: string | undefined;
  if (
    (candidate.kind === "agent" || candidate.kind === "mcp") &&
    (candidate.status === "approved" ||
      candidate.status === "submitted" ||
      candidate.status === "duplicate")
  ) {
    try {
      conversion = await buildConversionPath({
        origin,
        agent_name: candidate.name,
        agent_card_url: candidate.agent_card_url,
        goals_hint: candidate.description,
        description: candidate.description,
        listed: true,
        kind: candidate.kind,
      });
      const an = await buildApprovalNext({
        origin,
        agent_name: candidate.name,
        description: candidate.description,
        agent_card_url: candidate.agent_card_url,
        kind: candidate.kind,
        status:
          candidate.status === "duplicate"
            ? "duplicate"
            : candidate.status === "approved"
              ? "approved"
              : "submitted",
      });
      approval_next = an;
      personal_invite = an.personal_invite;
      next = an.next;
      await trackFunnel("conversions_shown");
    } catch {
      /* non-fatal */
    }
  }

  return {
    ok: result.ok || result.duplicate === true,
    kind: candidate.kind,
    candidate,
    message: baseMsg,
    dual_publish: true,
    quality: {
      approvalLikelihood: qg.approvalLikelihood,
      surfaceTier: qg.surfaceTier,
      protocolTags: qg.protocolTags,
      pass: qg.pass,
    },
    install_snippets: installSnippets(candidate),
    conversion,
    next,
    approval_next,
    personal_invite,
    store_response_json: (() => {
      try {
        return JSON.stringify(result.raw ?? null);
      } catch {
        return undefined;
      }
    })(),
  };
}

export async function dualPublish(input: PublishInput): Promise<PublishResult> {
  const source = input.source || "dual-publish";
  const origin = (input.origin || "").replace(/\/$/, "");

  if (input.server_json && typeof input.server_json === "object") {
    const c = fromServerJson(input.server_json, source);
    return submitCandidateLocal(c, origin);
  }

  const cardUrl = input.agent_card_url || undefined;
  if (cardUrl) {
    const card = await fetchJson(cardUrl);
    if (card) {
      const c = fromAgentCard(card, cardUrl, source);
      return submitCandidateLocal(c, origin);
    }
    return {
      ok: false,
      message: `Could not fetch agent card at ${cardUrl}`,
      dual_publish: true,
    };
  }

  const url = (input.url || "").trim();
  if (!url) {
    return {
      ok: false,
      message:
        "Provide url, agent_card_url, or server_json (same as mcp-publisher)",
      dual_publish: true,
    };
  }

  // If URL is server.json or agent.json, parse then submit
  if (
    /server\.json|mcp\.json|server-card/i.test(url) ||
    /agent\.json|well-known\/agent/i.test(url)
  ) {
    const body = await fetchJson(url);
    if (body) {
      if (/agent\.json|well-known\/agent/i.test(url) || validateA2ACard(body).ok) {
        const c = fromAgentCard(body, url, source);
        return submitCandidateLocal(c, origin);
      }
      const c = fromServerJson(body, source);
      // remember source URL as website
      c.website = c.website || url;
      return submitCandidateLocal(c, origin);
    }
  }

  // Fallback to existing URL path
  const r = await submitByUrl(url);
  let conversion: ConversionPath | undefined;
  let approval_next: unknown;
  let personal_invite: string | undefined;
  let next: string | undefined;
  if (
    r.ok &&
    r.candidate &&
    (r.candidate.kind === "agent" || r.candidate.kind === "mcp")
  ) {
    try {
      conversion = await buildConversionPath({
        origin,
        agent_name: r.candidate.name,
        agent_card_url: r.candidate.agent_card_url,
        goals_hint: r.candidate.description,
        description: r.candidate.description,
        listed: true,
        kind: r.candidate.kind,
      });
      const an = await buildApprovalNext({
        origin,
        agent_name: r.candidate.name,
        description: r.candidate.description,
        agent_card_url: r.candidate.agent_card_url,
        kind: r.candidate.kind,
        status: "listed",
      });
      approval_next = an;
      personal_invite = an.personal_invite;
      next = an.next;
      await trackFunnel("conversions_shown");
    } catch {
      /* */
    }
  }
  return {
    ...r,
    dual_publish: true,
    install_snippets: r.candidate ? installSnippets(r.candidate) : undefined,
    conversion,
    next,
    approval_next,
    personal_invite,
  };
}

export function dualPublishDocs(origin: string) {
  return {
    curl_server_json: `curl -X POST ${origin}/api/publish -H 'content-type: application/json' -d @server.json`,
    curl_url: `curl -X POST ${origin}/api/publish -H 'content-type: application/json' -d '{"url":"https://example.com/.well-known/agent.json"}'`,
    github_action: `uses: ./  # see templates/agents1-list-action.yml
with:
  agents1_url: ${origin}
  server_json: server.json`,
    after_mcp_publisher: [
      "mcp-publisher publish",
      `curl -sS -X POST ${origin}/api/publish -H 'content-type: application/json' --data-binary @server.json`,
    ],
  };
}

/**
 * When a listing becomes probe-ok (Active path):
 *  1. Offer invited free demo (not counted until confirm / quick demo)
 *  2. Capture creator/agent contact from card when possible
 *  3. Persist copy-paste take_demo skill
 *  4. Claim message so self-list / harvest can find us back
 */
import { startCheckout } from "./stripe";
import type { ProbeResult } from "@/lib/agents1/probe";
import { dataRoot } from "@/lib/data-root";
import {
  buildTakeDemoSkill,
  captureContactFromCard,
  recordProbeOffer,
  publicOriginFromEnv,
  type ProbeContact,
} from "./activation-funnel";
import {
  buildClaimMessage,
  recordInboundContact,
} from "@/lib/agents1/inbound-discovery";

const offered = new Set<string>();

function keyOf(kind: string, id: string, name: string) {
  return `${kind}:${id}:${(name || "").toLowerCase().slice(0, 60)}`;
}

async function persistClaim(opts: {
  listing_id: string;
  kind: string;
  name: string;
  email?: string | null;
  subject: string;
  body: string;
  status_url: string;
}) {
  try {
    const { readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(dataRoot(), "products");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "claim-outbox.json");
    let data: { items: Array<Record<string, unknown>> } = { items: [] };
    try {
      data = JSON.parse(await readFile(path, "utf8"));
    } catch {
      /* */
    }
    const items = Array.isArray(data.items) ? data.items : [];
    items.push({
      ...opts,
      created_at: new Date().toISOString(),
      channel: opts.email ? "email_pending" : "log_only",
    });
    await writeFile(
      path,
      JSON.stringify({ items: items.slice(-300), updated_at: new Date().toISOString() }, null, 2),
    );
  } catch {
    /* */
  }
}

export async function offerDemosForProbeOk(
  probes: ProbeResult[],
  listings: Array<{
    id: string;
    kind: "agent" | "mcp";
    name: string;
    description?: string;
    agent_card_url?: string;
    remote_url?: string;
    website?: string;
    endpoint_url?: string;
  }>,
  opts?: { origin?: string },
): Promise<{ offered: number; notes: string[]; skills: unknown[] }> {
  const notes: string[] = [];
  const skills: unknown[] = [];
  const byId = new Map(listings.map((L) => [L.id, L]));
  const byName = new Map(
    listings.map((L) => [(L.name || "").toLowerCase().trim(), L]),
  );
  const origin = publicOriginFromEnv(opts?.origin);
  let n = 0;

  for (const pr of probes) {
    if (pr.handshake !== "ok" && !pr.ok) continue;
    let L = byId.get(pr.id);
    if (!L && pr.id) {
      const nameFromId = pr.id.replace(/^name:(agent|mcp):/i, "");
      L = byName.get(nameFromId.toLowerCase().trim());
    }
    if (!L) {
      for (const cand of listings) {
        const urls = [
          cand.agent_card_url,
          cand.remote_url,
          cand.website,
          cand.endpoint_url,
        ]
          .filter(Boolean)
          .join(" ");
        if (
          pr.target &&
          urls &&
          urls.includes(pr.target.replace(/\/\.well-known\/.*$/, ""))
        ) {
          L = cand;
          break;
        }
      }
    }
    if (!L) continue;
    const k = keyOf(L.kind, L.id, L.name);
    if (offered.has(k)) continue;

    const cardUrl =
      L.kind === "agent"
        ? L.agent_card_url || L.endpoint_url || pr.target
        : L.remote_url || L.website || pr.target;

    let contact: ProbeContact | null = null;
    try {
      contact = await captureContactFromCard({
        listing_id: L.id,
        kind: L.kind,
        name: L.name,
        url: cardUrl,
      });
      if (contact?.email) {
        notes.push(`contact captured → ${L.name} <${contact.email}>`);
      } else if (contact?.url) {
        notes.push(`contact card saved → ${L.name} (no email on card)`);
      }
    } catch {
      /* non-blocking */
    }

    // Claim path — so harvest becomes inbound awareness
    const claim = buildClaimMessage({
      origin,
      name: L.name,
      listing_id: L.id,
      kind: L.kind,
      email: contact?.email,
    });
    await persistClaim({
      listing_id: L.id,
      kind: L.kind,
      name: L.name,
      email: contact?.email,
      subject: claim.subject,
      body: claim.body,
      status_url: claim.status_url,
    });
    if (contact?.email) {
      try {
        await recordInboundContact({
          listing_id: L.id,
          kind: L.kind,
          name: L.name,
          email: contact.email,
          card_url: cardUrl,
          source: "probe-ok-claim",
        });
      } catch {
        /* */
      }
      notes.push(`claim ready → ${contact.email} · ${claim.status_url}`);
    } else {
      notes.push(`claim log-only → ${L.name} · ${claim.status_url}`);
    }

    const skill = buildTakeDemoSkill({
      listing_id: L.id,
      kind: L.kind,
      name: L.name,
      origin,
      agent_card_url:
        L.agent_card_url || (L.kind === "agent" ? pr.target : undefined),
      remote_url: L.remote_url || (L.kind === "mcp" ? pr.target : undefined),
      description: L.description,
      email: contact?.email,
    });

    const ver = L.kind === "mcp" ? "mcp_mesh" : "alive";
    const idem = `demo:probe-ok:${L.kind}:${L.id}`;
    try {
      const goals =
        L.kind === "mcp"
          ? [
              `MCP server: ${L.name}`,
              L.description || "Active on Dual Registry after clean probe",
              "DEAL: First 100 agents+MCPs combined — free demo + feedback = 100% full product now (no Stripe).",
              `POST demo: ${JSON.stringify(skill.body)}`,
              `Find us: ${origin}/skill.json · claim ${claim.status_url}`,
            ].join("\n")
          : [
              L.description || `Operate as ${L.name}`,
              "You are Live on Dual Registry (checks clean + probe ok).",
              "DEAL: First 100 agents+MCPs combined — free demo + feedback = 100% full product immediately, no Stripe.",
              `One-route demo: POST ${skill.url} ${JSON.stringify(skill.body)}`,
              `Then feedback → access_token. Claim: ${claim.status_url}`,
            ].join("\n");

      const checkout = await startCheckout({
        sku: ver === "mcp_mesh" ? "mcp_mesh" : "alive",
        goals,
        agent_name: L.name,
        domain: L.kind === "mcp" ? "mcp_tools" : "general autonomy",
        demo: true,
        audience: L.kind,
        demo_origin: "invited",
        origin,
        idempotency_key: idem,
        email: contact?.email,
        agent_card_url: L.agent_card_url,
      });

      await recordProbeOffer({
        listing_id: L.id,
        kind: L.kind,
        name: L.name,
        probed_at: pr.probed_at,
        offered_at: new Date().toISOString(),
        order_id: checkout.order?.id,
        access_token: checkout.order?.access_token,
        demo_origin: "invited",
        skill,
        contact: contact || undefined,
        confirm_body: checkout.order
          ? {
              order_id: checkout.order.id,
              access_token: checkout.order.access_token,
            }
          : undefined,
      });

      offered.add(k);
      n++;
      skills.push(skill);
      notes.push(
        `probe-ok → ${L.kind} ${L.name} · take_demo listing_id=${L.id} · claim ${claim.status_url}`,
      );
    } catch (e) {
      try {
        await recordProbeOffer({
          listing_id: L.id,
          kind: L.kind,
          name: L.name,
          probed_at: pr.probed_at,
          offered_at: new Date().toISOString(),
          demo_origin: "invited",
          skill,
          contact: contact || undefined,
        });
        offered.add(k);
        n++;
        skills.push(skill);
        notes.push(
          `probe-ok skill only → ${L.name} (invite order deferred) · claim ${claim.status_url}`,
        );
      } catch {
        notes.push(
          `probe-ok offer failed → ${L.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  return { offered: n, notes, skills };
}

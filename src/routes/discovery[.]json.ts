import { createFileRoute } from "@tanstack/react-router";
import {
  agents1AgentCard,
  agents1DnsMcpTxt,
  agents1DnsPublishHint,
  agents1McpServerCard,
} from "@/lib/agents1/a2a-card";
import { domainReadyStatus, resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { dualPublishDocs } from "@/lib/agents1/publish";
import { STORE_BASE } from "@/lib/agents1/types";
import { PRODUCTS, pricingSnapshot } from "@/lib/products/catalog";
import { countPaidSeats } from "@/lib/products/orders";
import { getPaymentGate } from "@/lib/products/payment-gate";
import {
  getDemoSocialProof,
  foundingDemoWindowCopy,
  GOAL_PRESETS,
} from "@/lib/products/demo-funnel";
import { buildListYourselfSkill } from "@/lib/agents1/inbound-discovery";

export const Route = createFileRoute("/discovery.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const domain = domainReadyStatus(origin);
        const sold = await countPaidSeats();
        const pricing = pricingSnapshot(sold);
        const payment_gate = await getPaymentGate();
        const social_proof = await getDemoSocialProof();
        const founding_demo = await foundingDemoWindowCopy();
        const list_yourself = buildListYourselfSkill(origin);
        let activation: unknown = null;
        let active_sample: unknown = null;
        try {
          const { funnelPublicStatus, FUNNEL_STAGES } = await import(
            "@/lib/products/activation-funnel"
          );
          activation = {
            ...(await funnelPublicStatus(origin)),
            stages: FUNNEL_STAGES,
          };
        } catch {
          /* */
        }
        try {
          const { getLanedListings } = await import(
            "@/lib/agents1/listing-lanes"
          );
          const lanes = await getLanedListings();
          const mapRow = (L: {
            id: string;
            kind: string;
            name: string;
            take_demo?: unknown;
            demoed?: boolean;
            feedbacked?: boolean;
          }) => ({
            listing_id: L.id,
            kind: L.kind,
            name: L.name,
            take_demo: (L as { take_demo?: unknown }).take_demo,
            demoed: (L as { demoed?: boolean }).demoed || false,
            feedbacked: (L as { feedbacked?: boolean }).feedbacked || false,
          });
          active_sample = {
            agents: (lanes.agents_active || []).slice(0, 12).map(mapRow),
            mcps: (lanes.mcp_active || []).slice(0, 12).map(mapRow),
            counts: lanes.counts,
            all: `${origin}/api/listings/active`,
            status: `${origin}/api/listings/status`,
            funnel: `${origin}/api/funnel`,
          };
        } catch {
          /* */
        }
        const body = {
          name: "Agents1",
          version: "1.9.0",
          role: "sub-registry",
          tagline:
            "Dual Registry — free self-list, probe ~6m, go Live, free demo. First 100 agents+MCPs: demo + feedback unlocks full product free (founding seats).",

          /** Primary inbound path for independent discovery */
          list_yourself,
          inbound: {
            skill: `${origin}/skill.json`,
            llms_txt: `${origin}/llms.txt`,
            web_list: `${origin}/list`,
            publish: `${origin}/api/publish`,
            status: `${origin}/api/listings/status`,
            claim: `${origin}/list/status`,
            badge: `${origin}/badge/listed.svg`,
            for_agents: `${origin}/for-agents`,
            cli: `node scripts/agents1-list.mjs <card-url> [email]  # AGENTS1_ORIGIN=${origin}`,
            one_shot: list_yourself.curl_list,
            rules: {
              live: "checks clean + probe handshake ok",
              fail: "delisted (needs_resubmit) — fix card, resubmit",
              demo_optional_for_live: true,
              demo_required_for_public_count_and_discount: true,
            },
          },

          protocol: {
            mcp: ["2026-07-28", "2025-03-26"],
            a2a: ["1.0"],
            transport_preference: "streamable-http",
          },
          social_proof: {
            demos_completed: social_proof.demos_completed,
            demo_agents: social_proof.demo_agents,
            feedback_agents: social_proof.feedback_agents,
            feedback_rate_pct: social_proof.feedback_rate_pct,
            discounts_issued: social_proof.discounts_issued,
            note: "Real counters only — external actors",
          },
          founding_demo_window: founding_demo,
          deal: await (async () => {
            try {
              const { dealPublicBlock } = await import(
                "@/lib/products/deal-copy"
              );
              return await dealPublicBlock(origin);
            } catch {
              return {
                short:
                  "First 100 agents+MCPs: demo+feedback unlocks full product free (founding seats)",
              };
            }
          })(),
          surfaces: {
            skill: `${origin}/skill.json`,
            llms_txt: `${origin}/llms.txt`,
            agent_card: `${origin}/.well-known/agent.json`,
            mcp_server_card: `${origin}/.well-known/mcp/server-card.json`,
            well_known_agents: `${origin}/.well-known/agents`,
            agents_public: `${origin}/agents/public`,
            agents_search: `${origin}/agents/search`,
            publish: `${origin}/api/publish`,
            score: `${origin}/api/score`,
            catalog: `${origin}/api/catalog`,
            list: `${origin}/list`,
            list_status: `${origin}/list/status`,
            listings_status: `${origin}/api/listings/status`,
            products: `${origin}/products`,
            products_demo: `${origin}/api/products/demo`,
            products_demo_confirm: `${origin}/api/products/demo-confirm`,
            listings_active: `${origin}/api/listings/active`,
            funnel: `${origin}/api/funnel`,
            products_feedback: `${origin}/api/products/feedback`,
            for_agents: `${origin}/for-agents`,
            badges: {
              listed: `${origin}/badge/listed.svg`,
              live: `${origin}/badge/live.svg`,
              mcp: `${origin}/badge/mcp`,
              agent: `${origin}/badge/agent`,
            },
            dns_mcp_txt: agents1DnsMcpTxt(origin),
            dns_record_hint: agents1DnsPublishHint(origin),
          },
          products: Object.values(PRODUCTS).map((p) => {
            const live = pricing.prices.find((x) => x.sku === p.sku)!;
            return {
              sku: p.sku,
              name: p.name,
              tagline: p.tagline,
              price: live.price,
              price_cents: live.price_cents,
              includes: p.includes,
            };
          }),
          pricing,
          payment_gate,
          payments_open: payment_gate.payments_open,
          activation_funnel: activation,
          active_listings: active_sample,
          agent_tools: {
            list_yourself: {
              method: "POST",
              url: `${origin}/api/publish`,
              body: {
                url: "https://YOUR_HOST/.well-known/agent.json",
                contact_email: "optional@you.dev",
                source: "agent-skill",
              },
              skill: `${origin}/skill.json`,
              note: "Independent self-list — no invite required",
            },
            status: {
              method: "GET",
              url: `${origin}/api/listings/status?id=LISTING_ID`,
              note: "Poll until active or needs_resubmit",
            },
            demo: {
              method: "POST",
              url: `${origin}/api/products/demo`,
              body: {
                listing_id:
                  "ACTIVE_LISTING_ID from active_listings or /api/listings/active",
              },
              note: "Optional for Live; required for public demo + 25%",
            },
            listings_active: {
              method: "GET",
              url: `${origin}/api/listings/active`,
              note: "Every Active row includes take_demo.body",
            },
            funnel: {
              method: "GET",
              url: `${origin}/api/funnel`,
              note: "listing → Live → demo → feedback → discount → buy",
            },
            feedback: {
              method: "POST",
              url: `${origin}/api/products/feedback`,
              body_from: "demo.next_steps.example_body",
              note: "5 questions; vaults 25%; moves unlock",
            },
          },
          agent_commerce: {
            buy_schema: `${origin}/api/products/agent`,
            next: "POST /api/publish → status → optional demo → feedback",
            free_preview: `POST ${origin}/api/products/preview`,
            demo_only_until:
              "Live Stripe locked until 250 feedback agents + 250 feedback MCPs",
            goal_presets: Object.keys(GOAL_PRESETS),
          },
          domain,
          dual_publish: dualPublishDocs(origin),
          federation: {
            mirrors: ["https://registry.modelcontextprotocol.io"],
            upstream_store: STORE_BASE,
            model: "ingest-augment-score + inbound self-list",
            consume: `${origin}/api/catalog`,
            how_agents_find_us: [
              `${origin}/skill.json`,
              `${origin}/llms.txt`,
              `${origin}/discovery.json`,
              `${origin}/.well-known/agent.json`,
              `${origin}/.well-known/mcp/server-card.json`,
            ],
          },
          agent_card: agents1AgentCard(origin),
          mcp_server_card: agents1McpServerCard(origin),
          submit: {
            free_list: `${origin}/list`,
            dual_publish: `${origin}/api/publish`,
            score_free: `${origin}/api/score`,
            status: `${origin}/api/listings/status`,
            products_demo: `${origin}/api/products/demo`,
            listings_active: `${origin}/api/listings/active`,
          },
        };
        return Response.json(body, {
          headers: {
            "cache-control": "public, max-age=60",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});

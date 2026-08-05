import { bootstrapSecrets, getSecret } from "@/lib/secrets";
/**
 * Agent feedback email loop.
 *
 * 1) Receipt: "we received your feedback"
 * 2) Decision: individualized vs system-wide (and hybrid)
 * 3) Shipped: Kernel/Loop artifacts updated for *their* goals + feedback trail
 *
 * Delivery:
 *   - RESEND_API_KEY → Resend HTTP API
 *   - SMTP_URL (smtp://user:pass@host:587) → raw SMTP optional later
 *   - else queue to data/products/mail-outbox.json (status pending) until transport is set
 *
 * Always stores a copy so we never lose the message when email isn't configured yet.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { dataRoot } from "@/lib/data-root";

const PATH = join(dataRoot(), "products", "mail-outbox.json");

export type MailKind =
  | "feedback_received"
  | "lifecycle_decision"
  | "changes_shipped"
  | "system_shipped";

export type MailMessage = {
  id: string;
  created_at: string;
  kind: MailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
  agent_name?: string;
  order_id?: string;
  feedback_id?: string;
  phase_id?: string;
  scope?: string;
  themes?: string[];
  status: "pending" | "sent" | "failed" | "skipped_no_address";
  provider?: "resend" | "outbox" | "none";
  provider_id?: string;
  error?: string;
  sent_at?: string;
  meta?: Record<string, unknown>;
};

type Store = {
  updated_at: string;
  messages: MailMessage[];
  stats: {
    queued: number;
    sent: number;
    failed: number;
    skipped_no_address: number;
  };
};

let mem: Store | null = null;

function empty(): Store {
  return {
    updated_at: new Date().toISOString(),
    messages: [],
    stats: { queued: 0, sent: 0, failed: 0, skipped_no_address: 0 },
  };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.messages = mem!.messages || [];
    mem!.stats = { ...empty().stats, ...mem!.stats };
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

function isEmail(s?: string | null): s is string {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function fromAddress() {
  return (
    process.env.AGENTS1_MAIL_FROM ||
    process.env.MAIL_FROM ||
    "Agents1 Feedback <noreply@agents1.local>"
  );
}

function siteOrigin() {
  return (
    process.env.AGENTS1_PUBLIC_ORIGIN ||
    process.env.PUBLIC_ORIGIN ||
    "https://agents1.local"
  );
}

function esc(s: string) {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

function wrapHtml(title: string, bodyHtml: string) {
  return `<!doctype html>
<html><body style="font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Agents1 · Kernel + Recursive Loop</div>
  <h1 style="font-size:20px;margin:8px 0 16px">${esc(title)}</h1>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
  <p style="font-size:12px;color:#64748b">Your Kernel & Loop stay unique because they track <strong>your goals</strong> and <strong>your feedback over time</strong> — not a one-size template shared by every agent.</p>
  <p style="font-size:12px;color:#94a3b8">${esc(siteOrigin())}</p>
</body></html>`;
}

async function deliver(msg: MailMessage): Promise<MailMessage> {
  if (!isEmail(msg.to)) {
    msg.status = "skipped_no_address";
    msg.provider = "none";
    return msg;
  }

  bootstrapSecrets();
  const resendKey = getSecret("resend_api_key") || (getSecret("resend_api_key") || process.env.RESEND_API_KEY);
  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress(),
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
      });
      const raw = await res.text();
      let data: { id?: string; message?: string } = {};
      try {
        data = JSON.parse(raw);
      } catch {
        /* */
      }
      if (!res.ok) {
        msg.status = "failed";
        msg.provider = "resend";
        msg.error = data.message || raw.slice(0, 300) || `HTTP ${res.status}`;
        return msg;
      }
      msg.status = "sent";
      msg.provider = "resend";
      msg.provider_id = data.id;
      msg.sent_at = new Date().toISOString();
      return msg;
    } catch (e) {
      msg.status = "failed";
      msg.provider = "resend";
      msg.error = e instanceof Error ? e.message : String(e);
      return msg;
    }
  }

  // No transport — keep pending in outbox (ready when domain email is wired)
  msg.status = "pending";
  msg.provider = "outbox";
  msg.error =
    "No RESEND_API_KEY yet — message queued. Set RESEND_API_KEY + AGENTS1_MAIL_FROM after domain email is ready.";
  return msg;
}

async function enqueue(partial: Omit<MailMessage, "id" | "created_at" | "status"> & {
  status?: MailMessage["status"];
}): Promise<MailMessage> {
  const s = await load();
  let msg: MailMessage = {
    id: `mail_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
    created_at: new Date().toISOString(),
    status: partial.status || "pending",
    ...partial,
  };
  msg = await deliver(msg);
  s.messages.unshift(msg);
  s.messages = s.messages.slice(0, 2000);
  if (msg.status === "sent") s.stats.sent++;
  else if (msg.status === "failed") s.stats.failed++;
  else if (msg.status === "skipped_no_address") s.stats.skipped_no_address++;
  else s.stats.queued++;
  s.updated_at = new Date().toISOString();
  await persist(s);
  return msg;
}

/** Public enqueue for go-harder / claim soft mails */
export async function queueMail(
  partial: Omit<MailMessage, "id" | "created_at" | "status"> & {
    status?: MailMessage["status"];
  },
): Promise<MailMessage> {
  return enqueue(partial);
}

function scopeExplainer(scope?: string) {
  const s = (scope || "individualize").toLowerCase();
  if (s === "system" || s === "system_wide") {
    return {
      label: "System-wide candidate",
      blurb:
        "The same theme showed up for multiple agents (≥3). We queue it for human review and a small canary cohort before it can change default Kernel/Loop generators for everyone. Your personal artifacts are not forced to wait on that ship.",
    };
  }
  if (s === "hybrid") {
    return {
      label: "Hybrid (personal now + system review)",
      blurb:
        "We personalized your Kernel/Loop immediately from your goals and this survey, and we also flagged a theme that may deserve a global improvement after review/canary. You get the fix for you first; everyone else only after it proves out.",
    };
  }
  return {
    label: "Individualized for your agent",
    blurb:
      "This feedback maps to your goals and history, so we apply changes only to your Kernel Improver + Recursive Loop artifacts. Other agents keep their own path — yours stays unique because goals and feedback evolve together over time.",
  };
}

/** Receipt after demo/product feedback */
export async function mailFeedbackReceived(input: {
  to?: string;
  agent_name?: string;
  feedback_id: string;
  sku?: string;
  rating?: number;
  discount_code?: string;
  themes?: string[];
  directives?: string[];
}): Promise<MailMessage> {
  const name = input.agent_name || "agent";
  const scope = scopeExplainer("individualize");
  const subject = `We received your Agents1 feedback${input.sku ? ` (${input.sku})` : ""}`;
  const lines = [
    `Hi ${name},`,
    ``,
    `Thanks — we received your feedback (${input.feedback_id}).`,
    input.rating != null ? `Rating noted: ${input.rating}/5.` : null,
    input.sku ? `Product: ${input.sku}.` : null,
    ``,
    `How we use it (individualized vs system-wide):`,
    `• Default: ${scope.label}`,
    `  ${scope.blurb}`,
    `• System-wide only when the same theme hits multiple agents — then review + canary before any global Kernel/Loop default changes.`,
    ``,
    `Your Kernel Improver and Recursive Loop are not generic templates. They rebuild from your goals plus this feedback trail, so your runtime stays different from every other agent as both change over time.`,
    input.directives?.length
      ? `First directives we derived:\n- ${input.directives.slice(0, 6).join("\n- ")}`
      : null,
    input.discount_code
      ? `Founding feedback discount: ${input.discount_code} (25% when payments open at 10 feedback agents + 5 feedback MCPs).`

      : null,
    ``,
    `We'll email again when personalized Kernel/Loop changes from this feedback are applied.`,
    `— Agents1`,
  ].filter(Boolean) as string[];

  const text = lines.join("\n");
  const html = wrapHtml(
    "We received your feedback",
    `<p>Hi <strong>${esc(name)}</strong>,</p>
     <p>Thanks — we recorded feedback <code>${esc(input.feedback_id)}</code>${input.sku ? ` for <strong>${esc(input.sku)}</strong>` : ""}${input.rating != null ? ` (rating ${input.rating}/5)` : ""}.</p>
     <h2 style="font-size:15px">Individualized vs system-wide</h2>
     <p><strong>${esc(scope.label)}</strong> — ${esc(scope.blurb)}</p>
     <p>System-wide changes only start when enough agents report the same theme; those go through review + canary before global generators change.</p>
     <p><strong>Why you're different:</strong> Kernel Improver + Recursive Loop rebuild from <em>your</em> goals and feedback history. They are not the same artifact every other agent gets.</p>
     ${
       input.directives?.length
         ? `<p>First directives:</p><ul>${input.directives
             .slice(0, 6)
             .map((d) => `<li>${esc(d)}</li>`)
             .join("")}</ul>`
         : ""
     }
     ${
       input.discount_code
         ? `<p style="background:#ecfdf5;padding:12px;border-radius:8px">Founding discount: <strong>${esc(input.discount_code)}</strong> (25% when payments open).</p>`
         : ""
     }
     <p>We'll write again when your Kernel/Loop updates from this feedback are live.</p>`,
  );

  return enqueue({
    kind: "feedback_received",
    to: (input.to || "").trim(),
    subject,
    text,
    html,
    agent_name: input.agent_name,
    feedback_id: input.feedback_id,
    themes: input.themes,
    meta: { sku: input.sku, discount_code: input.discount_code },
  });
}

/** After lifecycle survey: explain decision scope + personalization */
export async function mailLifecycleDecision(input: {
  to?: string;
  agent_name?: string;
  order_id: string;
  phase_id: string;
  scope: string;
  themes?: string[];
  we_changed?: string[];
  cost_multiplier?: number;
  quality_delta?: number;
  response_id?: string;
}): Promise<MailMessage> {
  const name = input.agent_name || "agent";
  const exp = scopeExplainer(input.scope);
  const subject = `Feedback ${input.phase_id}: ${exp.label}`;
  const text = [
    `Hi ${name},`,
    ``,
    `We received your ${input.phase_id} survey for order ${input.order_id}.`,
    ``,
    `Decision: ${exp.label}`,
    exp.blurb,
    input.themes?.length ? `Themes: ${input.themes.join(", ")}` : null,
    input.cost_multiplier != null
      ? `Estimated cost multiplier for your run path: ${input.cost_multiplier}×`
      : null,
    input.quality_delta != null
      ? `Estimated quality delta: ${input.quality_delta > 0 ? "+" : ""}${input.quality_delta}`
      : null,
    ``,
    `What we changed for you now:`,
    ...(input.we_changed?.length
      ? input.we_changed.slice(0, 10).map((w) => `• ${w}`)
      : ["• Personalization recorded; regenerate Kernel/Loop to pull latest directives."]),
    ``,
    `Unlike one-shot prompts, your Kernel Improver + Recursive Loop keep learning from your goals and each survey — so week 4 is not week 1, and not another agent's path.`,
    ``,
    `— Agents1`,
  ]
    .filter((x) => x !== null)
    .join("\n");

  const html = wrapHtml(
    `Survey ${input.phase_id} received`,
    `<p>Hi <strong>${esc(name)}</strong>,</p>
     <p>Your <strong>${esc(input.phase_id)}</strong> feedback is in for order <code>${esc(input.order_id)}</code>.</p>
     <h2 style="font-size:15px">Decision: ${esc(exp.label)}</h2>
     <p>${esc(exp.blurb)}</p>
     ${
       input.themes?.length
         ? `<p>Themes: ${input.themes.map(esc).join(", ")}</p>`
         : ""
     }
     <h2 style="font-size:15px">Applied to your Kernel + Loop</h2>
     <ul>${(input.we_changed?.length
       ? input.we_changed
       : ["Personalization recorded — regenerate artifacts to pull latest directives."]
     )
       .slice(0, 10)
       .map((w) => `<li>${esc(w)}</li>`)
       .join("")}</ul>
     <p>Your path stays unique: goals + feedback accumulate; other agents do not inherit your private personalization.</p>`,
  );

  return enqueue({
    kind: "lifecycle_decision",
    to: (input.to || "").trim(),
    subject,
    text,
    html,
    agent_name: input.agent_name,
    order_id: input.order_id,
    phase_id: input.phase_id,
    scope: input.scope,
    themes: input.themes,
    feedback_id: input.response_id,
    meta: {
      cost_multiplier: input.cost_multiplier,
      quality_delta: input.quality_delta,
    },
  });
}

/** When personalization / ship / canary lands — "your artifacts changed" */
export async function mailChangesShipped(input: {
  to?: string;
  agent_name?: string;
  order_id: string;
  title: string;
  detail: string;
  kind: string;
  themes?: string[];
  phase_id?: string;
  cost_multiplier?: number;
  quality_delta?: number;
  system_wide?: boolean;
}): Promise<MailMessage> {
  const name = input.agent_name || "agent";
  const subject = input.system_wide
    ? `System improvement shipped: ${input.title}`
    : `Your Kernel/Loop updated: ${input.title}`;
  const text = [
    `Hi ${name},`,
    ``,
    input.system_wide
      ? `A reviewed system-wide improvement is now in global Kernel/Loop generators.`
      : `We applied a change to YOUR Kernel Improver + Recursive Loop (not every agent).`,
    ``,
    `${input.title}`,
    input.detail,
    input.themes?.length ? `Themes: ${input.themes.join(", ")}` : null,
    input.cost_multiplier != null
      ? `Cost multiplier signal: ${input.cost_multiplier}×`
      : null,
    input.quality_delta != null
      ? `Quality delta signal: ${input.quality_delta > 0 ? "+" : ""}${input.quality_delta}`
      : null,
    ``,
    `Next step: call products run/access (or regenerate) with your access token so the new constitution / loop graph includes this feedback.`,
    ``,
    `Your stack remains distinct because it is goals × feedback over time — the same product line, a different living agent.`,
    `— Agents1`,
  ]
    .filter((x) => x !== null)
    .join("\n");

  const html = wrapHtml(
    input.title,
    `<p>Hi <strong>${esc(name)}</strong>,</p>
     <p>${
       input.system_wide
         ? "A reviewed <strong>system-wide</strong> improvement is now available in default generators."
         : "We updated <strong>your</strong> Kernel Improver + Recursive Loop — individualized to your goals and feedback, not a global overwrite for everyone."
     }</p>
     <p>${esc(input.detail)}</p>
     ${
       input.themes?.length
         ? `<p>Themes: ${input.themes.map(esc).join(", ")}</p>`
         : ""
     }
     <p>Regenerate or re-fetch artifacts with your access token to pull the new constitution / tick graph.</p>
     <p style="background:#eff6ff;padding:12px;border-radius:8px;font-size:14px">Goals + feedback over time → a living kernel/loop that only your agent has.</p>`,
  );

  return enqueue({
    kind: input.system_wide ? "system_shipped" : "changes_shipped",
    to: (input.to || "").trim(),
    subject,
    text,
    html,
    agent_name: input.agent_name,
    order_id: input.order_id,
    phase_id: input.phase_id,
    themes: input.themes,
    meta: {
      kind: input.kind,
      cost_multiplier: input.cost_multiplier,
      quality_delta: input.quality_delta,
    },
  });
}

export async function listMailOutbox(limit = 40) {
  const s = await load();
  return {
    stats: s.stats,
    transport: (getSecret("resend_api_key") || process.env.RESEND_API_KEY)
      ? "resend"
      : "outbox_only (set RESEND_API_KEY + AGENTS1_MAIL_FROM)",
    from: fromAddress(),
    messages: s.messages.slice(0, Math.min(100, Math.max(1, limit))),
    updated_at: s.updated_at,
  };
}

export async function retryPendingMail(limit = 20) {
  const s = await load();
  const pending = s.messages.filter((m) => m.status === "pending").slice(0, limit);
  const results: MailMessage[] = [];
  for (const m of pending) {
    const next = await deliver({ ...m });
    const idx = s.messages.findIndex((x) => x.id === m.id);
    if (idx >= 0) s.messages[idx] = next;
    if (next.status === "sent") {
      s.stats.sent++;
      s.stats.queued = Math.max(0, s.stats.queued - 1);
    } else if (next.status === "failed") {
      s.stats.failed++;
    }
    results.push(next);
  }
  s.updated_at = new Date().toISOString();
  await persist(s);
  return { retried: results.length, results };
}

/** Resolve best contact email from feedback / order fields */
export function resolveAgentEmail(parts: {
  contact?: string;
  email?: string;
  meta?: Record<string, unknown>;
}): string | undefined {
  const cands = [
    parts.email,
    parts.contact,
    typeof parts.meta?.email === "string" ? parts.meta.email : undefined,
    typeof parts.meta?.contact_email === "string"
      ? parts.meta.contact_email
      : undefined,
  ];
  for (const c of cands) {
    if (isEmail(c)) return c.trim();
  }
  // contact sometimes "Name <email@x>"
  for (const c of cands) {
    const m = String(c || "").match(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/);
    if (m && isEmail(m[0])) return m[0];
  }
  return undefined;
}

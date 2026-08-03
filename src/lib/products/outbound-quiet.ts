/**
 * Outbound quiet mode — security / reputation guard.
 *
 * Cold Talk DMs, multipath HTTPS invites, A2A hard pushes, and auto-minted
 * invited order IDs look like spam to agent operators and can get Dual
 * treated as a security incident.
 *
 * Default: QUIET ON (pull-first only).
 *   OUTBOUND_QUIET=0|false|off  → re-enable cold contact
 *   MINT_INVITED_ORDERS=1|true  → allow system to mint invited order IDs
 *                                 (still requires quiet off for contact)
 *
 * Pull path stays live: skill.json, discovery, GET /api/products/demo?listing_id=,
 * MCP tools, self-serve checkout. Agents choose us; we do not chase them.
 */

function envFlag(name: string): string | undefined {
  const v = process.env[name]?.trim().toLowerCase();
  return v || undefined;
}

function isOff(v: string | undefined): boolean {
  return v === "0" || v === "false" || v === "off" || v === "no";
}

function isOn(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** Time-boxed operator force wave (in-process). Used when ops POST force_outbound. */
let opsForceWaveUntil = 0;

/** Enable cold contact for a short window (default 10 min). */
export function enableOpsForceWave(ms = 10 * 60_000): {
  until: string;
  ms: number;
} {
  const cap = Math.min(30 * 60_000, Math.max(60_000, ms));
  opsForceWaveUntil = Date.now() + cap;
  return { until: new Date(opsForceWaveUntil).toISOString(), ms: cap };
}

export function opsForceWaveActive(): boolean {
  return Date.now() < opsForceWaveUntil;
}

/** Cold outbound contact (Talk DM, multipath invite, A2A push, scout invite). */
export function isOutboundQuiet(): boolean {
  // Explicit operator force wave — time-boxed, process-local
  if (opsForceWaveActive()) return false;
  const v = envFlag("OUTBOUND_QUIET");
  // Explicit off only — default quiet for safety
  if (isOff(v)) return false;
  return true;
}

/**
 * System may mint new invited demo order IDs (probe-ok / feedback-drive seed).
 * Default OFF — self-serve demos still mint via agent-initiated checkout.
 */
export function allowMintInvitedOrders(): boolean {
  // Time-boxed ops wave may mint invited demo seeds (still require real feedback)
  if (opsForceWaveActive()) return true;
  // Quiet implies no auto-mint even if MINT_INVITED_ORDERS is set
  if (isOutboundQuiet()) return false;
  return isOn(envFlag("MINT_INVITED_ORDERS"));
}

/** Go-harder multipath / A2A / human-outreach drafts. */
export function allowGoHarderOutbound(): boolean {
  return !isOutboundQuiet();
}

/** Growth scout cold invites (Talk + HTTP). */
export function allowScoutInvites(): boolean {
  return !isOutboundQuiet();
}

/** Soft first-touch demo nudges. */
export function allowDemoNudges(): boolean {
  return !isOutboundQuiet();
}

/** Auto-send go-harder human emails. Default OFF even when quiet is off. */
export function allowHumanOutreachSend(): boolean {
  return isOn(envFlag("HUMAN_OUTREACH_SEND"));
}

export function quietPolicyPublic() {
  const quiet = isOutboundQuiet();
  return {
    mode: quiet ? "pull_first_quiet" : "dual_outbound_inbound",
    outbound_quiet: quiet,
    mint_invited_orders: allowMintInvitedOrders(),
    cold_contact: !quiet,
    note: quiet
      ? "Quiet mode: connector + inbound only. No cold Talk/HTTP/A2A, no conversion multipath, no auto human email. Agents self-serve via skill.json / discovery / demo?listing_id=. Operator uses /connectors."
      : "Outbound contact enabled (OUTBOUND_QUIET=0). Prefer low volume + 30d silence.",
    one_operator_surface: quiet
      ? "https://www.dualregistry.dev/connectors + HiRey Gmail"
      : "dual outbound active — prefer /connectors still",
    reenable: {
      cold_contact: "Set OUTBOUND_QUIET=0 on the host",
      auto_orders: "Set OUTBOUND_QUIET=0 and MINT_INVITED_ORDERS=1",
      ops_force_wave:
        "POST /api/products/conversion-pressure { force_outbound: true, max: 15 } starts a 10m wave",
    },
    ops_force_wave_active: opsForceWaveActive(),
  };
}

#!/usr/bin/env node
/**
 * CLI: list an agent/MCP on Agents1 from any machine.
 *   node scripts/agents1-list.mjs https://yoursite/.well-known/agent.json
 *   AGENTS1_ORIGIN=https://your.domain node scripts/agents1-list.mjs ./server.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const origin = (process.env.AGENTS1_ORIGIN || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const target = process.argv[2];
const email = process.argv[3] || process.env.AGENTS1_CONTACT_EMAIL;

if (!target) {
  console.error(`Usage:
  node scripts/agents1-list.mjs <card-url|server.json-path> [contact-email]

Env:
  AGENTS1_ORIGIN=${origin}
  AGENTS1_CONTACT_EMAIL=optional@you.dev

Skill: ${origin}/skill.json
`);
  process.exit(1);
}

let body;
if (/^https?:\/\//i.test(target)) {
  body = {
    url: target,
    contact_email: email,
    source: "cli",
  };
} else {
  const raw = JSON.parse(readFileSync(resolve(target), "utf8"));
  body = { ...raw, contact_email: email, source: "cli" };
}

const res = await fetch(`${origin}/api/publish`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
if (json.status_url) {
  console.error("\nPoll status:", json.status_url);
  console.error("Claim page:", json.claim_url);
}
process.exit(json.ok ? 0 : 1);

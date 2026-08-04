#!/usr/bin/env node
/**
 * One-cadence ship: stamp build.json → commit-ready tree → release tarball.
 *
 * Cadence (single identity):
 *   1. git commit on main (this SHA)
 *   2. git push origin main
 *   3. node scripts/ship-production.mjs  → public/build.json + GH release asset
 *   4. Deploy that exact release to Vercel production (Vercel MCP deploy_to_vercel
 *      unpacking the release, OR `vercel deploy` when VERCEL_TOKEN is set)
 *
 * GitHub Actions workflow deploy-production.yml mirrors steps 3–4 when
 * VERCEL_TOKEN is present; otherwise it still publishes the release so an
 * agent can finish step 4 via the Vercel connector without secrets in GH.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TOOLS_VERSION = "3.8.0";
const AGENT_PATH = "improve_kernel";
const PRIMARY_KR = "value_to_feedback_same_session_rate";
const FOUNDING = "real_feedback_no_demo_required";
const SYSTEM = "collaborative_design_system";
const CORE = "real_feedback";
const MUSCLE = ["improve_kernel", "run_loop_tick"];
const TRY_PATH = "/try";
const RECIPROCITY = "your_feedback_applied+ship_id+community_deltas";

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    ...opts,
  });
}

function stamp(sha) {
  const p = join(ROOT, "public", "build.json");
  mkdirSync(join(ROOT, "public"), { recursive: true });
  const body = {
    name: "dualregistry",
    tools_version: TOOLS_VERSION,
    agent_path: AGENT_PATH,
    primary_kr: PRIMARY_KR,
    founding: FOUNDING,
    system: SYSTEM,
    core: CORE,
    muscle: MUSCLE,
    try_path: TRY_PATH,
    reciprocity: RECIPROCITY,
    shipped_at: new Date().toISOString(),
    git: sha,
    deploy_channel: "git_main_plus_release_plus_vercel",
  };
  writeFileSync(p, JSON.stringify(body, null, 2) + "\n");
  return body;
}

function main() {
  const sha = sh("git rev-parse HEAD", { quiet: true }).trim();
  const short = sha.slice(0, 7);
  const stampBody = stamp(sha);
  console.log("[ship] stamped", stampBody);

  const tag = `deploy-src-${new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}`;
  const tgz = join("/tmp", `dualregistry-${short}.tgz`);
  sh(
    [
      "tar -czf",
      JSON.stringify(tgz),
      "--exclude=./node_modules",
      "--exclude=./.git",
      "--exclude=./.vercel",
      "--exclude=./data",
      "--exclude=./dist",
      "--exclude=./.output",
      "--exclude=./.nitro",
      "--exclude=./.tanstack",
      "--exclude=./screenshots",
      "-C",
      JSON.stringify(ROOT),
      ".",
    ].join(" "),
  );
  console.log("[ship] tarball", tgz);

  // Optional: publish GH release when gh is authenticated
  try {
    sh(
      `gh release create ${tag} ${JSON.stringify(tgz)} --title "Production source ${tag}" --notes "Shipped git ${sha} — tools ${TOOLS_VERSION}, path ${AGENT_PATH}, KR ${PRIMARY_KR}. Same identity for commit+push+deploy."`,
    );
    console.log("[ship] release", tag);
  } catch (e) {
    console.warn("[ship] gh release skipped:", e?.message || e);
  }

  // Optional: vercel CLI when token present
  if (process.env.VERCEL_TOKEN) {
    console.log("[ship] VERCEL_TOKEN present — use workflow or: vercel deploy --prod --token $VERCEL_TOKEN");
  } else {
    console.log(
      "[ship] No VERCEL_TOKEN in env. Deploy via Vercel connector:\n" +
        `  unpack curl https://github.com/manhatton31-svg/dualregistry/releases/download/${tag}/dualregistry-${short}.tgz\n` +
        "  target=production name=dualregistry teamId=team_YY4Cuwg6dmgWa9eNW0aFAvjV",
    );
  }

  // Write local identity for agents
  writeFileSync(
    join(ROOT, ".deploy-stamp"),
    JSON.stringify(
      {
        ...stampBody,
        release_tag: tag,
        tarball: tgz,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("[ship] done", { sha, tag });
}

main();

import { renderGrokSkillMarkdown } from "./grok-skills";

export function skillMarkdownResponse(slug: string, origin: string): Response {
  const md = renderGrokSkillMarkdown(slug, origin);
  if (!md) {
    return Response.json(
      { ok: false, error: "unknown_skill", slug },
      {
        status: 404,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }
  return new Response(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      "access-control-allow-origin": "*",
      "x-dual-skill": slug,
    },
  });
}

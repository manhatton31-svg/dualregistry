/**
 * Site-wide feedback dock — humans, operators, and demo users.
 * Posts to the same /api/products/feedback store agents use.
 */
import { useEffect, useMemo, useState } from "react";
import { MessageSquare, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SURFACES = [
  { id: "human_ui", label: "This page" },
  { id: "registry_home", label: "Registry" },
  { id: "collab_session", label: "Collab" },
  { id: "talk", label: "Talk" },
  { id: "products", label: "Products" },
  { id: "try", label: "Try / demo" },
  { id: "list", label: "List" },
  { id: "collab_market", label: "Market" },
  { id: "general", label: "Anything" },
];

export function OpenFeedbackDock() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rating, setRating] = useState<number | null>(4);
  const [body, setBody] = useState("");
  const [surface, setSurface] = useState("human_ui");
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState("/");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPage(window.location.pathname || "/");
      const saved = window.localStorage.getItem("dual_fb_name");
      if (saved) setName(saved);
    }
  }, []);

  const surfaceHint = useMemo(() => {
    if (page.startsWith("/collab")) return "collab_session";
    if (page.startsWith("/talk")) return "talk";
    if (page.startsWith("/products")) return "products";
    if (page.startsWith("/try")) return "try";
    if (page.startsWith("/list")) return "list";
    if (page.startsWith("/for-agents")) return "for_agents";
    if (page.startsWith("/grow")) return "grow";
    if (page.startsWith("/connectors")) return "connectors";
    if (page === "/") return "registry_home";
    return "human_ui";
  }, [page]);

  useEffect(() => {
    setSurface(surfaceHint);
  }, [surfaceHint]);

  const submit = async () => {
    const agent_name = name.trim();
    if (agent_name.length < 2) {
      setError("Name required (agent, MCP, or your name)");
      return;
    }
    if (!body.trim() && rating == null) {
      setError("Add a rating and/or one sentence");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("dual_fb_name", agent_name);
      }
      const res = await fetch("/api/products/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_name,
          rating: rating ?? undefined,
          body: body.trim() || undefined,
          mode: "ultra",
          source: surface,
          surface,
          audience: "agent",
          tags: ["open_surface", "human_ui", surface],
          meta: {
            surface,
            page,
            via: "open-feedback-dock",
            who: "human_or_operator",
          },
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error || "feedback failed");
        return;
      }
      setThanks(j.thanks || "Thanks — feedback locked in. It trains Dual.");
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2 sm:bottom-6 sm:right-6">
      {open ? (
        <div className="pointer-events-auto w-[min(100vw-2rem,22rem)] rounded-lg border border-border bg-bg-elevated p-3 shadow-lg">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="accent">Feedback open</Badge>
                <Badge variant="default">agents · mcps · humans</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                Every surface on Dual accepts feedback. Same store as{" "}
                <code className="text-accent">leave_feedback</code>.
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted hover:bg-bg-subtle hover:text-fg"
              onClick={() => setOpen(false)}
              aria-label="Close feedback"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {thanks ? (
            <p className="rounded-md border border-success/25 bg-success/10 px-2 py-2 text-xs text-success">
              {thanks}
            </p>
          ) : (
            <div className="space-y-2">
              <Input
                placeholder="Your name / agent / MCP"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9"
              />
              <div className="flex flex-wrap gap-1">
                {SURFACES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSurface(s.id)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px]",
                      surface === s.id
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-border text-muted hover:border-accent/25",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className={cn(
                      "h-8 w-8 rounded-md border text-xs font-medium",
                      rating === n
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border text-muted",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="One sentence — what worked or one gap"
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg placeholder:text-subtle focus:border-accent/40 focus:outline-none"
              />
              {error ? (
                <p className="text-xs text-danger">{error}</p>
              ) : null}
              <Button
                size="sm"
                variant="accent"
                className="w-full"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send feedback
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <Button
        size="sm"
        variant="accent"
        className="pointer-events-auto shadow-md"
        onClick={() => {
          setThanks(null);
          setOpen((v) => !v);
        }}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Feedback
      </Button>
    </div>
  );
}

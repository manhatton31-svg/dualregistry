/**
 * Fluid multi-turn conversation with any clean agent or MCP.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, MessageSquare, Radio, Send, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DualRegistryWordmark } from "@/components/brand/logo";

type CleanItem = {
  id: string;
  kind: "agent" | "mcp";
  name: string;
  description?: string;
  target?: string;
  agent_card_url?: string;
  remote_url?: string;
  probe?: { target?: string; ok?: boolean } | null;
};

type Msg = {
  role: "user" | "assistant" | "system";
  content: string;
  at?: string;
  meta?: { channel?: string };
};

export const Route = createFileRoute("/talk")({
  component: TalkPage,
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s.id === "string" ? s.id : "",
  }),
});

function resolveTarget(m: CleanItem): string | undefined {
  return (
    m.probe?.target ||
    m.agent_card_url ||
    m.remote_url ||
    m.target ||
    undefined
  );
}

function TalkPage() {
  const { id: initialId } = Route.useSearch();
  const [items, setItems] = useState<CleanItem[]>([]);
  const [listingId, setListingId] = useState(initialId || "");
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => items.find((x) => x.id === listingId) || null,
    [items, listingId],
  );

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/listings/active?limit=100", {
          cache: "no-store",
        });
        const j = await res.json();
        const agents = (j.agents || []).map(
          (a: Record<string, unknown>) =>
            ({
              id: a.listing_id || a.id,
              kind: "agent",
              name: a.name,
              description: a.description,
              agent_card_url: a.agent_card_url,
              probe: a.probe,
            }) as CleanItem,
        );
        const mcps = (j.mcps || []).map(
          (m: Record<string, unknown>) =>
            ({
              id: m.listing_id || m.id,
              kind: "mcp",
              name: m.name,
              description: m.description,
              remote_url: m.remote_url,
              probe: m.probe,
            }) as CleanItem,
        );
        const all = [...agents, ...mcps];
        setItems(all);
        if (!listingId && all[0]) setListingId(all[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openSession = useCallback(async (id: string) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setMessages([]);
    setSessionId("");
    try {
      const res = await fetch(
        `/api/talk?listing_id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const j = await res.json();
      setSessionId(j.session?.session_id || "");
      setMessages(j.session?.messages || []);
      setChannel(j.channel || j.session?.channel || "");
      setReachable(Boolean(j.ok || j.session?.reachable));
      if (!j.ok && j.error) setError(j.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (listingId) void openSession(listingId);
  }, [listingId, openSession]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !listingId || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    setMessages((m) => [
      ...m,
      { role: "user", content: text, at: new Date().toISOString() },
    ]);
    try {
      const res = await fetch("/api/talk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing_id: listingId,
          session_id: sessionId || undefined,
          message: text,
        }),
      });
      const j = await res.json();
      if (j.session?.session_id) setSessionId(j.session.session_id);
      if (j.session?.messages) setMessages(j.session.messages);
      else if (j.reply) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: j.reply,
            at: new Date().toISOString(),
            meta: { channel: j.channel },
          },
        ]);
      }
      setChannel(j.channel || "");
      setReachable(Boolean(j.ok || j.card_ok));
      if (!j.ok && j.error) setError(j.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, listingId, sessionId, busy]);

  return (
    <div className="mesh-bg min-h-dvh">
      <div className="page-shell py-6 sm:py-8">
        <header className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="accent">Talk · real channels</Badge>
              <Badge variant={reachable ? "success" : "warn"}>
                {reachable == null
                  ? "…"
                  : reachable
                    ? "channel live"
                    : "check failed"}
              </Badge>
            </div>
            <DualRegistryWordmark showDomain className="mb-2" />
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              Talk to clean agents & MCPs
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Multi-turn chat routed to each listing’s real card or transport.
              Only clean (probe-ok) registry members appear here.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" asChild>
              <Link to="/">← Clean registry</Link>
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a href="/api/talk?verify=all" target="_blank" rel="noreferrer">
                Verify all
              </a>
            </Button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card className="max-h-[70vh] overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Clean listings</CardTitle>
              <CardDescription className="text-xs">
                {items.length} probe-ok targets
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-[58vh] space-y-1 overflow-y-auto pb-3 pt-0">
              {items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setListingId(it.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left text-sm transition",
                    listingId === it.id
                      ? "border-accent bg-accent/10"
                      : "border-border/60 hover:border-border",
                  )}
                >
                  {it.kind === "mcp" ? (
                    <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : (
                    <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">
                      {it.name}
                    </span>
                    <span className="block text-[10px] uppercase text-subtle">
                      {it.kind}
                    </span>
                  </span>
                </button>
              ))}
              {!items.length ? (
                <p className="text-xs text-muted">Loading clean registry…</p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="flex min-h-[70vh] flex-col">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <MessageSquare className="h-4 w-4 text-accent" />
                    {selected?.name || "Select a listing"}
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    {selected ? (
                      <>
                        {selected.kind} ·{" "}
                        <span className="font-mono text-[11px]">
                          {resolveTarget(selected)?.slice(0, 64)}
                          {(resolveTarget(selected)?.length || 0) > 64
                            ? "…"
                            : ""}
                        </span>
                      </>
                    ) : (
                      "Pick a clean agent or MCP"
                    )}
                  </CardDescription>
                </div>
                {channel ? (
                  <Badge variant="default" className="font-mono text-[10px]">
                    <Radio className="mr-1 h-3 w-3" />
                    {channel}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 pb-4 pt-0">
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto rounded-[var(--radius-md)] border border-border/50 bg-bg-elevated/30 p-3">
                {messages.map((m, i) => (
                  <div
                    key={`${m.role}-${i}-${m.at || i}`}
                    className={cn(
                      "max-w-[95%] rounded-[var(--radius-md)] px-3 py-2 text-sm leading-relaxed",
                      m.role === "user"
                        ? "ml-auto bg-accent/20 text-fg"
                        : m.role === "system"
                          ? "border border-border/60 bg-card text-muted"
                          : "bg-card text-fg",
                    )}
                  >
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-subtle">
                      {m.role}
                      {m.meta?.channel ? ` · ${m.meta.channel}` : ""}
                    </p>
                    <div className="whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                ))}
                {!messages.length ? (
                  <p className="text-sm text-muted">
                    Opening live channel to the listing…
                  </p>
                ) : null}
                <div ref={bottomRef} />
              </div>

              {error ? (
                <p className="text-xs text-danger">{error}</p>
              ) : null}

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    selected
                      ? `Message ${selected.name}…`
                      : "Select a listing first"
                  }
                  disabled={busy || !listingId}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  variant="accent"
                  disabled={busy || !draft.trim() || !listingId}
                >
                  <Send className="h-3.5 w-3.5" />
                  {busy ? "…" : "Send"}
                </Button>
              </form>
              <p className="text-[11px] text-subtle">
                Messages hit the real agent card / MCP transport. Auth-gated
                endpoints may reply with a live card summary instead of tool
                output.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

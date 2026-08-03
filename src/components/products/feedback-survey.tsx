import { useEffect, useState } from "react";
import { Loader2, MessageSquare, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Q = {
  id: string;
  prompt: string;
  type: "scale" | "text" | "multi" | "single" | "currency";
  required?: boolean;
  options?: string[];
  product_area?: string;
};

type AlreadyDone = {
  intro?: string;
  pain_points_in_progress?: Array<{
    label: string;
    votes: number;
    scope: string;
    status: string;
    what_changed?: string[];
    driven_by?: string;
  }>;
  already_shipped?: Array<{
    product: string;
    change: string;
    scope: string;
    themes?: string[];
  }>;
  clarity_now?: {
    kernel?: number | null;
    loop?: number | null;
    overall?: number | null;
  };
  log_url?: string;
};

type Survey = {
  questions: Q[];
  incentive?: { percent_off: number; label: string; note: string };
  instructions?: string;
  already_done?: AlreadyDone;
};

const FALLBACK_QUESTIONS: Q[] = [
  {
    id: "overall",
    prompt: "Overall, how useful was this Network Edition demo?",
    type: "scale",
    required: true,
  },
  {
    id: "audience_role",
    prompt: "Are you answering as…?",
    type: "single",
    required: true,
    options: ["agent_runtime", "mcp_publisher", "both", "human_operator"],
  },
  {
    id: "tried",
    prompt: "What did you try?",
    type: "single",
    required: true,
    options: [
      "preview",
      "kernel",
      "recursive",
      "alive",
      "mcp_mesh",
      "network_tools",
      "multiple",
    ],
  },
  {
    id: "agent_ux",
    prompt: "Agent/MCP UX: checkout → first useful artifact? (1–5)",
    type: "scale",
    required: true,
  },
  {
    id: "time_to_value",
    prompt: "How long until something useful?",
    type: "single",
    required: true,
    options: [
      "under_2_min",
      "2_to_10_min",
      "10_to_30_min",
      "over_30_min",
      "never_got_value",
    ],
  },
  {
    id: "api_docs_clarity",
    prompt: "Agent-native API steps clarity? (1–5)",
    type: "scale",
    required: true,
  },
  {
    id: "ux_friction",
    prompt: "Biggest agent/MCP friction (one concrete step)",
    type: "text",
    required: true,
  },
  {
    id: "kernel_clarity",
    prompt: "Kernel clarity (short prompt / constitution / tools)?",
    type: "scale",
    required: true,
  },
  {
    id: "loop_clarity",
    prompt: "Recursive Loop usability for your goals?",
    type: "scale",
    required: true,
  },
  {
    id: "artifact_goal_fit",
    prompt: "Artifacts match your goals? (1–5)",
    type: "scale",
    required: true,
  },
  {
    id: "network_clarity",
    prompt: "Network Edition Dual node clarity? (1–5)",
    type: "scale",
    required: true,
  },
  {
    id: "network_value",
    prompt: "Does Network Edition make you more likely to buy?",
    type: "single",
    required: true,
    options: [
      "much_more",
      "somewhat_more",
      "no_change",
      "less",
      "unclear_what_it_is",
    ],
  },
  {
    id: "network_wish",
    prompt: "One Network Edition change for your runtime:",
    type: "text",
    required: true,
  },
  {
    id: "confusing",
    prompt: "What was confusing or missing? (specific)",
    type: "text",
    required: true,
  },
  {
    id: "would_pay_for",
    prompt: "What would make you pay when seats open?",
    type: "text",
    required: true,
  },
  {
    id: "improvements",
    prompt: "Which improvements help most?",
    type: "multi",
    required: true,
    options: [
      "one_click_skill_md",
      "shorter_system_prompt",
      "clearer_goal_examples",
      "better_loop_defaults",
      "live_worked_example",
      "agent_native_buy_docs",
      "clearer_network_edition",
      "better_dual_tools_docs",
      "faster_demo_to_first_tick",
      "name_your_price_ux",
      "mcp_reliability_loop",
      "mcp_tool_policy_export",
    ],
  },
  {
    id: "production_blocker",
    prompt: "Biggest production blocker?",
    type: "text",
    required: true,
  },
  {
    id: "kernel_wish",
    prompt: "One Kernel Improver change you want:",
    type: "text",
    required: true,
  },
  {
    id: "loop_wish",
    prompt: "One Recursive Loop change you want:",
    type: "text",
    required: true,
  },
  {
    id: "product_one_ship",
    prompt: "ONE product improvement Dual should ship next week:",
    type: "text",
    required: true,
  },
  {
    id: "wtp_kernel_usd",
    prompt: "Honest max USD for Kernel Improver alone ($0 ok)",
    type: "currency",
    required: true,
  },
  {
    id: "wtp_recursive_usd",
    prompt: "Honest max USD for Recursive Loop alone ($0 ok)",
    type: "currency",
    required: true,
  },
  {
    id: "wtp_alive_usd",
    prompt: "Honest max USD for Alive Bundle ($0 ok)",
    type: "currency",
    required: true,
  },
  {
    id: "would_buy_at_founding",
    prompt: "Buy at founding $14.99 / $19.99 / $29.99 / $24.99?",
    type: "single",
    required: true,
    options: ["yes", "no", "maybe"],
  },
  {
    id: "name_your_price_intent",
    prompt: "Prefer name-your-price when payments open?",
    type: "single",
    required: true,
    options: [
      "yes_prefer_nyp",
      "maybe",
      "no_prefer_list",
      "need_more_info",
    ],
  },
  {
    id: "wtp_confidence",
    prompt: "Confidence in those dollar answers?",
    type: "scale",
    required: true,
  },
  {
    id: "wtp_why",
    prompt: "Why those numbers? (optional)",
    type: "text",
  },
  { id: "extra", prompt: "Anything else? (optional)", type: "text" },
];


export function FeedbackSurvey(props: {
  source?: string;
  orderId?: string;
  sku?: string;
  agentName?: string;
  mode?: "demo" | "stripe" | "preview";
  compact?: boolean;
  /** Prefill ultra from human_handoff URL */
  initialRating?: number;
  initialBody?: string;
  accessToken?: string;
}) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [alreadyDone, setAlreadyDone] = useState<AlreadyDone | null>(null);
  const [showDone, setShowDone] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string | number | string[]>>(
    {},
  );
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [ultraDone, setUltraDone] = useState(false);
  const [ultraRating, setUltraRating] = useState<number | null>(
    props.initialRating ?? null,
  );
  const [ultraBody, setUltraBody] = useState(props.initialBody || "");
  const [showDense, setShowDense] = useState(false);

  useEffect(() => {
    void fetch("/api/products/feedback")
      .then((r) => r.json())
      .then(
        (d: {
          survey?: Survey;
          already_done?: AlreadyDone;
        }) => {
          const ad = d.already_done || d.survey?.already_done || null;
          setAlreadyDone(ad);
          if (d.survey?.questions?.length) setSurvey(d.survey);
          else setSurvey({ questions: FALLBACK_QUESTIONS });
        },
      )
      .catch(() => setSurvey({ questions: FALLBACK_QUESTIONS }));
  }, []);

  /** Post-demo close path: 3 core asks if expanding dense */
  const COMPACT_IDS = new Set([
    "tried",
    "ux_friction",
    "product_one_ship",
  ]);

  const questions = (survey?.questions || FALLBACK_QUESTIONS).filter((qq) => {
    if (qq.id?.startsWith("wtp_") || qq.id === "would_buy_at_founding" || qq.id === "name_your_price_intent") {
      // WTP always optional / dense-only
      return showDense && !props.compact;
    }
    if (props.compact) return COMPACT_IDS.has(qq.id);
    return showDense; // dense only after ultra or explicit expand
  });
  const q = questions[step];
  const total = questions.length;

  function setAns(id: string, v: string | number | string[]) {
    setAnswers((a) => ({ ...a, [id]: v }));
  }

  function toggleMulti(id: string, opt: string) {
    const cur = Array.isArray(answers[id]) ? [...(answers[id] as string[])] : [];
    const i = cur.indexOf(opt);
    if (i >= 0) cur.splice(i, 1);
    else cur.push(opt);
    setAns(id, cur);
  }

  function canAdvance() {
    if (!q) return false;
    if (!q.required) return true;
    const v = answers[q.id];
    if (v === undefined || v === null || v === "") return false;
    if (q.type === "text" && String(v).trim().length < 8) return false;
    if (q.type === "multi" && (!Array.isArray(v) || v.length === 0)) return false;
    if (q.type === "currency") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0) return false;
    }
    return true;
  }

  async function submitUltra() {
    if (ultraRating == null || ultraBody.trim().length < 8) return;
    setBusy(true);
    setThanks(null);
    setCode(null);
    try {
      const res = await fetch("/api/products/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "ultra",
          rating: ultraRating,
          body: ultraBody.trim(),
          source: props.source || "demo",
          order_id: props.orderId,
          sku: props.sku,
          agent_name: props.agentName || undefined,
          access_token: props.accessToken || undefined,
          tags: ["ultra_minimal", "post_demo", "browser_ultra", "human_handoff"],
          contact: contact || undefined,
        }),
      });
      const j = await res.json();
      if (j.ok) {
        setUltraDone(true);
        setThanks(j.thanks || "Thanks — ultra feedback locked in.");
        if (j.discount?.code) setCode(j.discount.code);
      } else {
        setThanks(j.error || "Could not submit");
      }
    } catch (e) {
      setThanks(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitAll() {
    setBusy(true);
    setThanks(null);
    setCode(null);
    try {
      const res = await fetch("/api/products/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers,
          source: props.source || "demo",
          order_id: props.orderId,
          sku: props.sku,
          agent_name: props.agentName || undefined,
          mode: props.mode,
          contact: contact || undefined,
        }),
      });
      const j = await res.json();
      if (j.ok) {
        setThanks(j.thanks || "Thanks!");
        if (j.discount?.code) setCode(j.discount.code);
      } else {
        setThanks(j.error || "Could not submit");
      }
    } catch (e) {
      setThanks(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!survey) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading survey…
      </p>
    );
  }

  if (thanks && code) {
    return (
      <div className="space-y-3 rounded-[var(--radius-sm)] border border-success/40 bg-success/10 p-4 text-sm">
        <p className="font-medium text-fg flex items-center gap-2">
          <Gift className="h-4 w-4 text-success" /> Feedback locked in
        </p>
        <p className="text-xs text-muted">{thanks}</p>
        <div className="rounded border border-border bg-bg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-subtle">
            Your access code
          </p>
          <code className="text-lg font-semibold text-accent">{code}</code>
          <p className="mt-1 text-[11px] text-subtle">
            First 100 agents/MCPs combined: 100% off full product right away after
            demo + this survey. After that: 25% when card payments open (10+5
            feedback). Pass <code className="text-accent">discount_code</code> on
            checkout if needed.
          </p>
        </div>
      </div>
    );
  }

  if (thanks && !code) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-xs text-success">{thanks}</p>
        <Button size="sm" variant="secondary" onClick={() => setThanks(null)}>
          Continue optional questions
        </Button>
      </div>
    );
  }

  // Ultra-first gate (Agoragentic ship)
  if (!ultraDone && !showDense) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent" className="gap-1">
            <Gift className="h-3 w-3" />
            Ultra feedback — 2 fields
          </Badge>
          <span className="text-[11px] text-subtle">Founding seat / 25% · no WTP</span>
        </div>
        {props.initialRating || props.initialBody ? (
          <p className="rounded border border-accent/30 bg-accent/5 px-2 py-1.5 text-[11px] text-muted">
            Prefill from agent handoff — confirm and submit (edit if wrong).
          </p>
        ) : (
          <p className="text-[11px] text-muted">
            Rating + one sentence is enough. Dense survey and WTP are optional after.
          </p>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium text-fg">Overall usefulness (1–5)</p>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setUltraRating(n)}
                className={cn(
                  "min-h-11 rounded-[var(--radius-sm)] text-sm touch-manipulation",
                  ultraRating === n
                    ? "bg-accent font-medium text-bg"
                    : "border border-border text-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-fg">One sentence: what worked + what blocked</p>
          <textarea
            value={ultraBody}
            onChange={(e) => setUltraBody(e.target.value)}
            rows={2}
            className="w-full rounded-[var(--radius-sm)] border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            placeholder="e.g. Useful Kernel; want clearer export into my runtime"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || ultraRating == null || ultraBody.trim().length < 8}
            onClick={() => void submitUltra()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Submit ultra feedback"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowDense(true)}>
            Open dense survey (optional)
          </Button>
        </div>
        {thanks ? <p className="text-xs text-muted">{thanks}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {alreadyDone &&
      (alreadyDone.pain_points_in_progress?.length ||
        alreadyDone.already_shipped?.length) ? (
        <div className="rounded-[var(--radius-sm)] border border-accent/30 bg-accent/5 p-3">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-fg"
          >
            <span className="flex items-center gap-1.5">
              <Gift className="h-3.5 w-3.5 text-accent" />
              What feedback already changed
            </span>
            <span className="text-[10px] text-subtle">
              {showDone ? "hide" : "show"}
            </span>
          </button>
          {showDone ? (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] leading-relaxed text-muted">
                {alreadyDone.intro ||
                  "Prior surveys already drove Kernel/Loop updates. Focus on what is still missing."}
              </p>
              {(alreadyDone.pain_points_in_progress || [])
                .slice(0, props.compact ? 3 : 6)
                .map((p) => (
                  <div
                    key={p.label}
                    className="rounded border border-border/60 bg-bg/40 px-2 py-1.5 text-[11px]"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-fg">{p.label}</span>
                      <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] uppercase text-subtle">
                        {p.scope}
                      </span>
                      <span className="text-subtle">×{p.votes}</span>
                    </div>
                    {p.what_changed?.length ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                        {p.what_changed.slice(0, 2).map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-0.5 text-subtle">{p.driven_by}</p>
                    )}
                  </div>
                ))}
              {(alreadyDone.already_shipped || [])
                .slice(0, props.compact ? 2 : 4)
                .map((s, i) => (
                  <p key={i} className="text-[11px] text-success">
                    <span className="font-medium">{s.product}</span>
                    {s.scope === "sitewide" ? " · sitewide" : ""}:{" "}
                    {s.change.slice(0, 160)}
                  </p>
                ))}
              {alreadyDone.log_url ? (
                <a
                  href={alreadyDone.log_url}
                  className="inline-flex text-[11px] text-accent hover:underline"
                >
                  Full improvement log →
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent" className="gap-1">
          <Gift className="h-3 w-3" />
          Complete survey — honest feedback only
        </Badge>
        <span className="text-[11px] text-subtle">
          Q{step + 1}/{total}
        </span>
      </div>
      {survey.instructions ? (
        <p className="text-[11px] text-muted">{survey.instructions}</p>
      ) : (
        <p className="text-[11px] text-muted">
          Answers improve Kernel Improver + Recursive Loop for every agent. Be
          specific — vague feedback does not earn a code.
        </p>
      )}

      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${((step + 1) / total) * 100}%` }}
        />
      </div>

      {q ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-fg">{q.prompt}</p>
          {q.product_area ? (
            <p className="text-[10px] uppercase tracking-wide text-subtle">
              {q.product_area}
            </p>
          ) : null}

          {q.type === "scale" ? (
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAns(q.id, n)}
                  className={cn(
                    "min-h-11 rounded-[var(--radius-sm)] text-sm touch-manipulation",
                    answers[q.id] === n
                      ? "bg-accent font-medium text-bg"
                      : "border border-border text-muted",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}

          {q.type === "single" && q.options ? (
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setAns(q.id, opt)}
                  className={cn(
                    "min-h-10 rounded-[var(--radius-sm)] px-3 py-2 text-xs touch-manipulation",
                    answers[q.id] === opt
                      ? "bg-accent font-medium text-bg"
                      : "border border-border text-muted",
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : null}

          {q.type === "multi" && q.options ? (
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => {
                const on =
                  Array.isArray(answers[q.id]) &&
                  (answers[q.id] as string[]).includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleMulti(q.id, opt)}
                    className={cn(
                      "min-h-10 rounded-[var(--radius-sm)] px-3 py-2 text-xs touch-manipulation",
                      on
                        ? "bg-accent font-medium text-bg"
                        : "border border-border text-muted",
                    )}
                  >
                    {opt.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          ) : null}

          {q.type === "text" ? (
            <textarea
              value={String(answers[q.id] || "")}
              onChange={(e) => setAns(q.id, e.target.value)}
              rows={props.compact ? 2 : 3}
              className="w-full rounded-[var(--radius-sm)] border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              placeholder="Be concrete — this rewrites the next demo artifacts…"
            />
          ) : null}

          {q.type === "currency" ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={
                  answers[q.id] === undefined || answers[q.id] === ""
                    ? ""
                    : String(answers[q.id])
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") setAns(q.id, "" as unknown as number);
                  else setAns(q.id, Number(raw));
                }}
                placeholder="0 = would not buy"
                className="max-w-[12rem]"
              />
              <span className="text-[11px] text-subtle">USD once · $0 allowed</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === total - 1 ? (
        <div>
          <label className="mb-1 block text-[11px] text-subtle">
            Email (optional — we can re-send your discount code)
          </label>
          <Input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="you@agent.dev"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="w-full sm:w-auto"
        >
          Back
        </Button>
        {step < total - 1 ? (
          <Button
            type="button"
            size="sm"
            variant="accent"
            disabled={!canAdvance()}
            onClick={() => setStep((s) => s + 1)}
            className="w-full sm:w-auto"
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="accent"
            disabled={busy || !canAdvance()}
            onClick={() => void submitAll()}
            className="w-full sm:w-auto"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5" />
            )}
            Submit feedback
          </Button>
        )}
      </div>
      <p className="break-words text-[10px] text-subtle">
        Agents:{" "}
        <code className="text-accent">
          POST /api/products/agent {"{"} tool: "get_feedback_survey" {"}"}{" "}
          then submit_feedback with answers
        </code>
      </p>
    </div>
  );
}

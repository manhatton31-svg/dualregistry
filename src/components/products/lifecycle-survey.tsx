import { useEffect, useState } from "react";
import { Loader2, CalendarClock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PhaseQ = {
  id: string;
  prompt: string;
  type: "scale" | "text" | "multi" | "single" | "currency";
  required?: boolean;
  options?: string[];
};

export function LifecycleSurveyPanel(props: {
  token?: string;
  orderId?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [enrollment, setEnrollment] = useState<{
    completed_count: number;
    next_due?: string;
    phases: Array<{ id: string; status: string; due_at: string }>;
  } | null>(null);
  const [survey, setSurvey] = useState<{
    id: string;
    label: string;
    intent: string;
    questions: PhaseQ[];
  } | null>(null);
  const [answers, setAnswers] = useState<
    Record<string, string | number | string[]>
  >({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    recommendation?: string;
    decision?: { scope: string; reason: string };
    impact?: {
      individual_cost_multiplier: number;
      system_cost_multiplier: number;
      quality_delta_individual: number;
    };
    personalization_applied?: boolean;
    thanks?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!props.token && !props.orderId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const q = props.token
        ? `token=${encodeURIComponent(props.token)}`
        : `order_id=${encodeURIComponent(props.orderId!)}`;
      const res = await fetch(`/api/products/lifecycle?${q}`);
      const j = await res.json();
      if (!j.ok) {
        setError(j.error || "No lifecycle enrollment");
        setEnrollment(null);
        setSurvey(null);
      } else {
        setEnrollment(j.enrollment);
        setSurvey(j.active_survey);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.token, props.orderId]);

  const questions = survey?.questions || [];
  const q = questions[step];

  function setAns(id: string, v: string | number | string[]) {
    setAnswers((a) => ({ ...a, [id]: v }));
  }

  function canAdvance() {
    if (!q) return false;
    if (!q.required) return true;
    const v = answers[q.id];
    if (v === undefined || v === "") return false;
    if (q.type === "text" && String(v).trim().length < 8) return false;
    if (q.type === "multi" && (!Array.isArray(v) || !v.length)) return false;
    if (q.type === "currency") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0) return false;
    }
    return true;
  }

  async function submit() {
    if (!survey) return;
    setBusy(true);
    try {
      const res = await fetch("/api/products/lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: props.token,
          order_id: props.orderId,
          phase_id: survey.id,
          answers,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error || "Submit failed");
      } else {
        setResult(j);
        setAnswers({});
        setStep(0);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!props.token && !props.orderId) return null;
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading paid feedback
        cycle…
      </p>
    );
  }
  if (error && !enrollment) {
    return (
      <p className="text-xs text-subtle">
        Lifecycle feedback is for paid seats. {error}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent" className="gap-1">
          <CalendarClock className="h-3 w-3" />
          Paid feedback cycle · 2 months
        </Badge>
        {enrollment ? (
          <span className="text-[11px] text-subtle">
            {enrollment.completed_count}/9 phases · next:{" "}
            {enrollment.next_due || "done"}
          </span>
        ) : null}
      </div>

      {result ? (
        <div className="rounded-[var(--radius-sm)] border border-success/40 bg-success/10 p-3 text-xs space-y-2">
          <p className="font-medium text-fg flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5" /> Phase recorded
          </p>
          <p className="text-muted">{result.thanks || result.recommendation}</p>
          {result.decision ? (
            <p>
              Decision:{" "}
              <strong className="text-fg">{result.decision.scope}</strong> —{" "}
              {result.decision.reason}
            </p>
          ) : null}
          {result.impact ? (
            <p className="text-subtle">
              Cost impact — individual{" "}
              {result.impact.individual_cost_multiplier}x · system candidate{" "}
              {result.impact.system_cost_multiplier}x · quality Δ individual{" "}
              {result.impact.quality_delta_individual}
            </p>
          ) : null}
          {result.personalization_applied ? (
            <p className="text-accent">
              Your Kernel/Loop artifacts were regenerated with agent-specific
              overrides.
            </p>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => setResult(null)}>
            Continue
          </Button>
        </div>
      ) : null}

      {!survey ? (
        <p className="text-xs text-muted">
          No survey due right now. We'll ask again on the weekly schedule
          (post-setup + weeks 1–8).
        </p>
      ) : (
        <>
          <div>
            <p className="text-sm font-medium text-fg">{survey.label}</p>
            <p className="text-[11px] text-muted">{survey.intent}</p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${((step + 1) / Math.max(1, questions.length)) * 100}%`,
              }}
            />
          </div>
          {q ? (
            <div className="space-y-3">
              <p className="text-sm text-fg">
                {step + 1}/{questions.length}. {q.prompt}
              </p>
              {q.type === "scale" ? (
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAns(q.id, n)}
                      className={cn(
                        "rounded px-3 py-1.5 text-sm",
                        answers[q.id] === n
                          ? "bg-accent text-bg"
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
                        "rounded px-2 py-1 text-xs",
                        answers[q.id] === opt
                          ? "bg-accent text-bg"
                          : "border border-border text-muted",
                      )}
                    >
                      {opt.replace(/_/g, " ")}
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
                        onClick={() => {
                          const cur = Array.isArray(answers[q.id])
                            ? [...(answers[q.id] as string[])]
                            : [];
                          const i = cur.indexOf(opt);
                          if (i >= 0) cur.splice(i, 1);
                          else cur.push(opt);
                          setAns(q.id, cur);
                        }}
                        className={cn(
                          "rounded px-2 py-1 text-xs",
                          on
                            ? "bg-accent text-bg"
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
                  rows={3}
                  className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-fg"
                  placeholder="Be specific — drives system vs individual decision"
                />
              ) : null}
              {q.type === "currency" ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">$</span>
                  <input
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
                    className="w-32 rounded border border-border bg-bg px-2 py-1.5 text-sm text-fg"
                    placeholder="0 = no buy"
                  />
                  <span className="text-[11px] text-subtle">USD · $0 allowed</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </Button>
            {step < questions.length - 1 ? (
              <Button
                size="sm"
                variant="accent"
                disabled={!canAdvance()}
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </Button>
            ) : (
              <Button
                size="sm"
                variant="accent"
                disabled={busy || !canAdvance()}
                onClick={() => void submit()}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Submit phase"
                )}
              </Button>
            )}
          </div>
        </>
      )}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

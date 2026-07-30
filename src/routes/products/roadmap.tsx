import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Map } from "lucide-react";
import {
  SoftRefreshBar,
  SoftRefreshButton,
} from "@/components/ui/soft-refresh";
import { useLiveData } from "@/lib/ui/live-data";

export const Route = createFileRoute("/products/roadmap")({
  component: RoadmapPage,
  head: () => ({
    meta: [
      { title: "Feedback roadmap · Agents1" },
      {
        name: "description",
        content:
          "How agent feedback shapes Kernel Improver and Recursive Loop — themes, canary, shipped.",
      },
    ],
  }),
});

type Theme = {
  theme: string;
  status: string;
  count: number;
  action: string;
};

type RoadmapData = {
  top_themes: Theme[];
  recent_changes?: Array<{ title: string; detail: string; at: string }>;
  policy?: Record<string, unknown>;
  tagline?: string;
};

function RoadmapPage() {
  const { data, error, loading, refreshing, refresh } =
    useLiveData<RoadmapData>({
      key: "roadmap",
      url: "/api/products/roadmap",
    });

  return (
    <div className="mesh-bg min-h-dvh overflow-x-clip">
      <SoftRefreshBar active={refreshing || loading} />
      <div className="page-shell relative max-w-3xl space-y-6 py-6 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-accent">
              <Map className="h-3.5 w-3.5" /> Product learning
            </p>
            <h1 className="mt-1 text-xl font-semibold text-fg sm:text-2xl">
              Feedback roadmap
            </h1>
            <p className="mt-1 text-sm text-muted">
              {data?.tagline || "Agents shape Kernel Improver & Recursive Loop."}
            </p>
            <a
              href="/"
              className="mt-2 inline-flex min-h-10 items-center text-sm text-accent hover:underline"
            >
              ← Dashboard
            </a>
            {error ? (
              <p className="mt-1 text-xs text-warn">{error}</p>
            ) : null}
          </div>
          <SoftRefreshButton
            refreshing={refreshing}
            onClick={() => void refresh()}
            label="Update"
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent" /> Loading
            roadmap…
          </div>
        ) : null}

        {data ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top themes</CardTitle>
                <CardDescription>
                  Individual → canary → sitewide pipeline
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data.top_themes || []).length === 0 ? (
                  <p className="text-sm text-subtle">No themes yet.</p>
                ) : (
                  (data.top_themes || []).map((t) => (
                    <div
                      key={t.theme}
                      className="rounded-[var(--radius-sm)] border border-border/70 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">{t.theme}</span>
                        <Badge variant="default" className="text-[10px]">
                          {t.status}
                        </Badge>
                        <Badge variant="info" className="text-[10px]">
                          n={t.count}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">{t.action}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {(data.recent_changes || []).length ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recent changes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {(data.recent_changes || []).slice(0, 12).map((c, i) => (
                    <div key={i}>
                      <p className="font-medium text-fg">{c.title}</p>
                      <p className="text-xs text-muted">{c.detail}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {data.policy ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Policy</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="scroll-x text-[11px] text-muted">
                    {JSON.stringify(data.policy, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

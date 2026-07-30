import { Badge } from "@/components/ui/badge";
import type { FailedCheck } from "@/lib/agents1/types";

export type ListingRow = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  status?: string;
  safety_score?: number;
  safety_flags?: string[];
  failed_checks?: FailedCheck[];
  repository?: string;
  website?: string;
  meta?: string;
  /** active | discovered */
  lane?: "active" | "discovered";
  lane_reason?: string;
  checks_clean?: boolean;
  probe_ok?: boolean | null;
  source?: string;
  category_id?: string;
  category_label?: string;
  kind?: "agent" | "mcp";
  demoed?: boolean;
  feedbacked?: boolean;
  founder_n?: number;
};

export function ListingTable({
  rows,
  emptyLabel,
  showLane = true,
  showDemoCta = false,
}: {
  rows: ListingRow[];
  emptyLabel: string;
  showLane?: boolean;
  /** Active rows: take free demo / generate agent kit */
  showDemoCta?: boolean;
}) {
  if (!rows.length)
    return <p className="text-sm text-subtle">{emptyLabel}</p>;

  return (
    <>
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => {
          const fails = r.failed_checks || [];
          const clean =
            r.checks_clean !== undefined ? r.checks_clean : fails.length === 0;
          const kind = r.kind || (r.lane ? undefined : undefined);
          return (
            <li
              key={r.id}
              className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/40 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg">{r.name}</p>
                  {r.author ? (
                    <p className="mt-0.5 truncate text-[11px] text-subtle">
                      {r.author}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 tabular text-sm text-muted">
                  {r.safety_score ?? "—"}
                </span>
              </div>
              {r.description ? (
                <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted">
                  {r.description}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {showLane && r.lane === "active" ? (
                  <Badge variant="success">active</Badge>
                ) : null}
                {showLane && r.lane === "discovered" ? (
                  <Badge variant="default">discovered</Badge>
                ) : null}
                {clean ? (
                  <Badge variant="success">checks clean</Badge>
                ) : (
                  fails.slice(0, 4).map((f, i) => (
                    <Badge key={i} variant="warn">
                      {f.id}
                    </Badge>
                  ))
                )}
                {r.probe_ok === true ? (
                  <Badge variant="success">probe ok</Badge>
                ) : r.probe_ok === false ? (
                  <Badge variant="warn">probe fail</Badge>
                ) : r.lane === "discovered" ? (
                  <Badge variant="default">awaiting probe</Badge>
                ) : null}
                {r.demoed ? <Badge variant="accent">demoed</Badge> : null}
                {r.feedbacked ? (
                  <Badge variant="accent">
                    feedbacked{r.founder_n ? ` #${r.founder_n}` : ""}
                  </Badge>
                ) : null}
                {r.source === "growth" ? (
                  <Badge variant="accent">picked up</Badge>
                ) : null}
                {r.category_label ? (
                  <Badge variant="default">{r.category_label}</Badge>
                ) : null}
              </div>
              {r.lane_reason ? (
                <p className="mt-1.5 text-[11px] text-subtle">{r.lane_reason}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {r.repository ? (
                  <a
                    className="text-accent hover:underline"
                    href={r.repository}
                    target="_blank"
                    rel="noreferrer"
                  >
                    repo
                  </a>
                ) : null}
                {r.website ? (
                  <a
                    className="text-accent hover:underline"
                    href={r.website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    site
                  </a>
                ) : null}
                {showDemoCta && r.lane === "active" ? (
                  <a
                    className="font-medium text-accent hover:underline"
                    href={`/products?demo_listing=${encodeURIComponent(r.id)}&kind=${r.kind || "agent"}`}
                  >
                    {r.kind === "mcp"
                      ? "Generate agent kit (free)"
                      : "Take free demo"}
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-subtle">
              <th className="pb-2 pr-3 font-medium">Name</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium">Score</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const fails = r.failed_checks || [];
              const clean =
                r.checks_clean !== undefined
                  ? r.checks_clean
                  : fails.length === 0;
              return (
                <tr
                  key={r.id}
                  className="border-b border-border/40 align-top last:border-0"
                >
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-fg">{r.name}</p>
                    {r.description ? (
                      <p className="mt-0.5 line-clamp-2 max-w-md text-xs text-muted">
                        {r.description}
                      </p>
                    ) : null}
                    {r.category_label ? (
                      <p className="mt-1 text-[11px] text-subtle">
                        {r.category_label}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {showLane && r.lane === "active" ? (
                        <Badge variant="success">active</Badge>
                      ) : null}
                      {showLane && r.lane === "discovered" ? (
                        <Badge variant="default">discovered</Badge>
                      ) : null}
                      {clean ? (
                        <Badge variant="success">checks clean</Badge>
                      ) : (
                        <Badge variant="warn">needs review</Badge>
                      )}
                      {r.demoed ? (
                        <Badge variant="accent">demoed</Badge>
                      ) : null}
                      {r.feedbacked ? (
                        <Badge variant="accent">feedbacked</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 tabular text-muted">
                    {r.safety_score ?? "—"}
                  </td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-2 text-xs">
                      {r.repository ? (
                        <a
                          className="text-accent hover:underline"
                          href={r.repository}
                          target="_blank"
                          rel="noreferrer"
                        >
                          repo
                        </a>
                      ) : null}
                      {r.website ? (
                        <a
                          className="text-accent hover:underline"
                          href={r.website}
                          target="_blank"
                          rel="noreferrer"
                        >
                          site
                        </a>
                      ) : null}
                      {showDemoCta && r.lane === "active" ? (
                        <a
                          className="font-medium text-accent hover:underline"
                          href={`/products?demo_listing=${encodeURIComponent(r.id)}&kind=${r.kind || "agent"}`}
                        >
                          {r.kind === "mcp" ? "Agent kit" : "Free demo"}
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

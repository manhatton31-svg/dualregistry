/**
 * Group clean listings by category: top 5 visible, rest collapsed.
 * Expanded: 25 per page.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ListingTable, type ListingRow } from "./listing-table";

const PREVIEW = 5;
const PAGE = 25;

function rankScore(r: ListingRow): number {
  return (
    Number(r.safety_score || 0) * 1000 +
    (r.feedbacked ? 50 : 0) +
    (r.demoed ? 10 : 0) +
    (r.probe_ok === true ? 5 : 0)
  );
}

function sortTop(rows: ListingRow[]): ListingRow[] {
  return [...rows].sort((a, b) => {
    const d = rankScore(b) - rankScore(a);
    if (d !== 0) return d;
    return (a.name || "").localeCompare(b.name || "");
  });
}

type CatGroup = {
  id: string;
  label: string;
  rows: ListingRow[];
};

function groupByCategory(rows: ListingRow[]): CatGroup[] {
  const map = new Map<string, CatGroup>();
  for (const r of rows) {
    const id = r.category_id || "uncategorized";
    const label = r.category_label || "Uncategorized";
    let g = map.get(id);
    if (!g) {
      g = { id, label, rows: [] };
      map.set(id, g);
    }
    g.rows.push(r);
  }
  const groups = [...map.values()].map((g) => ({
    ...g,
    rows: sortTop(g.rows),
  }));
  groups.sort((a, b) => {
    const d = b.rows.length - a.rows.length;
    if (d !== 0) return d;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

function CategorySection({
  group,
  showDemoCta,
  /** When true (chip filter on one category), start expanded */
  defaultExpanded,
}: {
  group: CatGroup;
  showDemoCta?: boolean;
  defaultExpanded?: boolean;
}) {
  const total = group.rows.length;
  const needsCollapse = total > PREVIEW;
  const [expanded, setExpanded] = useState(
    Boolean(defaultExpanded && needsCollapse),
  );
  const [page, setPage] = useState(0);

  const visible = useMemo(() => {
    if (!needsCollapse || !expanded) {
      return group.rows.slice(0, PREVIEW);
    }
    const start = page * PAGE;
    return group.rows.slice(start, start + PAGE);
  }, [group.rows, needsCollapse, expanded, page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const from = expanded ? page * PAGE + 1 : 1;
  const to = expanded
    ? Math.min(total, (page + 1) * PAGE)
    : Math.min(PREVIEW, total);

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">
              {group.label}
              <span className="ml-1.5 tabular font-normal text-muted">
                ({total})
              </span>
            </CardTitle>
            <CardDescription className="text-xs">
              {needsCollapse && !expanded
                ? `Top ${Math.min(PREVIEW, total)} of ${total}`
                : expanded
                  ? `Showing ${from}–${to} of ${total}`
                  : `${total} listing${total === 1 ? "" : "s"}`}
            </CardDescription>
          </div>
          {needsCollapse ? (
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => {
                setExpanded((v) => {
                  if (v) setPage(0);
                  return !v;
                });
              }}
            >
              {expanded ? (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  Show all {total}
                </>
              )}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-4 pt-0">
        <ListingTable
          rows={visible}
          showDemoCta={showDemoCta}
          emptyLabel="No listings in this category"
        />
        {expanded && needsCollapse && pageCount > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
            <p className="text-[11px] text-subtle">
              Page {page + 1} of {pageCount} · {PAGE} per page
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= pageCount - 1}
                onClick={() =>
                  setPage((p) => Math.min(pageCount - 1, p + 1))
                }
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
        {needsCollapse && !expanded && total > PREVIEW ? (
          <button
            type="button"
            className={cn(
              "w-full rounded-[var(--radius-md)] border border-dashed border-border/70",
              "py-2 text-center text-xs font-medium text-muted transition hover:border-accent/40 hover:text-accent",
            )}
            onClick={() => setExpanded(true)}
          >
            + {total - PREVIEW} more in {group.label}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CategoryGroupedListings({
  rows,
  emptyLabel,
  showDemoCta,
  /** Single category chip selected → expand that section by default */
  filterCategoryId,
}: {
  rows: ListingRow[];
  emptyLabel: string;
  showDemoCta?: boolean;
  filterCategoryId?: string | null;
}) {
  const groups = useMemo(() => groupByCategory(rows), [rows]);

  if (!rows.length) {
    return <p className="text-sm text-subtle">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <CategorySection
          key={`${g.id}:${filterCategoryId || "all"}`}
          group={g}
          showDemoCta={showDemoCta}
          defaultExpanded={
            Boolean(filterCategoryId) && filterCategoryId === g.id
          }
        />
      ))}
    </div>
  );
}

/**
 * Single active view: All (default) or one chosen category.
 * Top 5 visible; expand → 25 per page.
 */
import { useEffect, useMemo, useState } from "react";
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

export function CategoryGroupedListings({
  rows,
  emptyLabel,
  showDemoCta,
  /** null = All; otherwise only this category is shown */
  filterCategoryId,
  categoryLabel,
}: {
  rows: ListingRow[];
  emptyLabel: string;
  showDemoCta?: boolean;
  filterCategoryId?: string | null;
  /** Display label when a category chip is selected */
  categoryLabel?: string | null;
}) {
  const sorted = useMemo(() => sortTop(rows), [rows]);
  const total = sorted.length;
  const needsCollapse = total > PREVIEW;
  const title = filterCategoryId
    ? categoryLabel || sorted[0]?.category_label || filterCategoryId
    : "All";

  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setExpanded(false);
    setPage(0);
  }, [filterCategoryId, total]);

  const visible = useMemo(() => {
    if (!needsCollapse || !expanded) {
      return sorted.slice(0, PREVIEW);
    }
    const start = page * PAGE;
    return sorted.slice(start, start + PAGE);
  }, [sorted, needsCollapse, expanded, page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const from = expanded ? page * PAGE + 1 : 1;
  const to = expanded
    ? Math.min(total, (page + 1) * PAGE)
    : Math.min(PREVIEW, total);

  if (!rows.length) {
    return <p className="text-sm text-subtle">{emptyLabel}</p>;
  }

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">
              {title}
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
              {" · "}
              {filterCategoryId ? "chosen category only" : "all categories"}
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
          emptyLabel={emptyLabel}
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
            + {total - PREVIEW} more
            {filterCategoryId ? ` in ${title}` : ""}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

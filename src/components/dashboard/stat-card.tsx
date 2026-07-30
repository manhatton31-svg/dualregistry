import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "accent",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  accent?: "accent" | "info" | "success" | "warn";
}) {
  const color = {
    accent: "text-accent",
    info: "text-info",
    success: "text-success",
    warn: "text-warn",
  }[accent];
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-start justify-between gap-2 p-3 sm:gap-3 sm:p-4">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-subtle sm:text-[11px]">
            {label}
          </p>
          <p className="mt-1 text-xl font-semibold tabular text-fg sm:text-2xl">
            {value}
          </p>
          {hint ? (
            <p className="mt-1 truncate text-[11px] text-muted sm:text-xs">
              {hint}
            </p>
          ) : null}
        </div>
        <Icon className={cn("h-4 w-4 shrink-0 sm:h-5 sm:w-5", color)} />
      </CardContent>
    </Card>
  );
}

import type { ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Thin top progress bar — always in DOM, never remounts the page */
export function SoftRefreshBar({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden transition-opacity duration-150",
        active ? "opacity-100" : "opacity-0",
        className,
      )}
      aria-hidden
    >
      <div className="h-full w-1/3 rounded-r bg-accent soft-refresh-bar" />
    </div>
  );
}

/**
 * Pass-through wrapper — DO NOT dim or remount children.
 * Data patches update numbers in place; opacity tricks feel like a page refresh.
 */
export function SoftRefreshBody({
  refreshing: _refreshing,
  children,
  className,
}: {
  refreshing?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0", className)}>{children}</div>;
}

export function SoftRefreshButton({
  refreshing,
  onClick,
  label = "Update",
  className,
  size = "sm",
  variant = "secondary",
}: {
  refreshing: boolean;
  onClick: () => void;
  label?: string;
  className?: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "secondary" | "accent";
}) {
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn("gap-1.5", className)}
      aria-busy={refreshing}
      title="Update numbers only — page stays put"
    >
      {refreshing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      {refreshing ? "Updating…" : label}
    </Button>
  );
}

/** Compact first-load only — never used once data exists */
export function SoftFirstLoad({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 px-4 text-muted">
      <Loader2 className="h-5 w-5 animate-spin text-accent" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

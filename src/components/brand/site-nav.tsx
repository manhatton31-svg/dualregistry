/**
 * Shared primary nav — keeps humans + agent-operators wired to every surface.
 */
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const LINKS: Array<{ href: string; label: string; accent?: boolean }> = [
  { href: "/", label: "Registry" },
  { href: "/collab", label: "Collab", accent: true },
  { href: "/talk", label: "Talk" },
  { href: "/try", label: "Try" },
  { href: "/list", label: "List" },
  { href: "/for-agents", label: "Agents" },
  { href: "/products", label: "Products" },
  { href: "/products/improvement-log", label: "Ships" },
  { href: "/connectors", label: "Connect" },
];

export function SiteNav({
  active,
  className,
}: {
  active?: string;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        "flex flex-wrap items-center gap-1.5 sm:gap-2",
        className,
      )}
      aria-label="Primary"
    >
      {LINKS.map((l) => {
        const isActive =
          active === l.href ||
          (l.href !== "/" && active?.startsWith(l.href));
        return (
          <Link
            key={l.href}
            to={l.href}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors sm:text-xs",
              isActive
                ? "border-accent/40 bg-accent/10 text-accent"
                : l.accent
                  ? "border-accent/25 text-accent hover:bg-accent/10"
                  : "border-border text-muted hover:border-accent/25 hover:text-fg",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

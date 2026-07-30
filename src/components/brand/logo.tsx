/**
 * Dual Registry mark — two interlocking nodes (agent ↔ MCP).
 * Clean, professional, monochrome-friendly with accent ring.
 */
export function DualRegistryLogo({
  className = "h-8 w-8",
  title = "Dual Registry",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* outer rounded square */}
      <rect
        x="1.5"
        y="1.5"
        width="37"
        height="37"
        rx="10"
        className="stroke-border"
        strokeWidth="1.5"
        fill="var(--color-bg-elevated)"
      />
      {/* left node — agent */}
      <circle cx="14" cy="20" r="6.5" className="fill-accent" opacity="0.95" />
      {/* right node — MCP */}
      <circle
        cx="26"
        cy="20"
        r="6.5"
        className="stroke-accent"
        strokeWidth="2"
        fill="var(--color-bg-elevated)"
      />
      {/* link bridge */}
      <path
        d="M18.5 20h3"
        className="stroke-accent"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* pulse dots */}
      <circle cx="14" cy="20" r="2" fill="var(--color-bg)" opacity="0.9" />
      <circle cx="26" cy="20" r="2" className="fill-accent" />
    </svg>
  );
}

export function DualRegistryWordmark({
  className = "",
  showDomain = false,
}: {
  className?: string;
  showDomain?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <DualRegistryLogo className="h-9 w-9 shrink-0 sm:h-10 sm:w-10" />
      <div className="min-w-0 leading-tight">
        <div className="text-lg font-semibold tracking-tight text-fg sm:text-xl">
          Dual Registry
        </div>
        {showDomain ? (
          <div className="font-mono text-[11px] text-accent">dualregistry.dev</div>
        ) : null}
      </div>
    </div>
  );
}

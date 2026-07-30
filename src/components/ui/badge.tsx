import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular",
  {
    variants: {
      variant: {
        default: "border-border bg-bg-subtle text-muted",
        success: "border-success/25 bg-success/10 text-success",
        warn: "border-warn/25 bg-warn/10 text-warn",
        danger: "border-danger/25 bg-danger/10 text-danger",
        info: "border-info/25 bg-info/10 text-info",
        accent: "border-accent-dim/30 bg-accent-dim/10 text-accent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

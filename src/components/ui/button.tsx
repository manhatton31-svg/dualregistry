import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none touch-manipulation select-none",
  {
    variants: {
      variant: {
        default:
          "bg-bg-subtle text-fg border border-border hover:bg-bg-elevated",
        secondary:
          "bg-bg-elevated text-fg border border-border hover:border-accent/40",
        accent: "bg-accent text-bg hover:opacity-90",
      },
      size: {
        sm: "min-h-10 px-3 text-xs sm:min-h-8 sm:px-2.5",
        default: "min-h-11 px-3.5 sm:min-h-9 sm:px-3",
        lg: "min-h-12 px-4 text-base sm:min-h-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  if (
    asChild &&
    children &&
    typeof children === "object" &&
    "props" in (children as object)
  ) {
    const child = children as React.ReactElement<{ className?: string }>;
    return (
      <child.type
        {...child.props}
        className={cn(
          buttonVariants({ variant, size }),
          child.props.className,
          className,
        )}
      />
    );
  }
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  );
}

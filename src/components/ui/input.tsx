import { cn } from "@/lib/utils";
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex w-full min-h-10 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm text-fg placeholder:text-subtle outline-none focus:border-accent/50",
        className,
      )}
      {...props}
    />
  );
}

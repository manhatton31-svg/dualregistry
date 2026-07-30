import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (Math.abs(s) < 45) return "just now";
  if (s > 0 && s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s > 0 && s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 0 && s > -3600) return `in ${Math.floor(-s / 60)}m`;
  if (s < 0 && s > -86400) return `in ${Math.floor(-s / 3600)}h`;
  return new Date(t).toLocaleString();
}

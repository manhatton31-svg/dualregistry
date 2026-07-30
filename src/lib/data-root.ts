/**
 * Writable data root.
 * - Local / sandbox: <cwd>/data
 * - Vercel / Lambda: /tmp/dualregistry-data (cwd is read-only)
 */
import { join } from "node:path";

export function dataRoot(): string {
  if (typeof process === "undefined") return "data";
  const override = process.env.DATA_DIR?.trim();
  if (override) return override.replace(/\/$/, "");
  const onVercel =
    process.env.VERCEL === "1" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.VERCEL_ENV);
  if (onVercel) {
    return "/tmp/dualregistry-data";
  }
  return join(process.cwd(), "data");
}

export function dataPath(...parts: string[]): string {
  return join(dataRoot(), ...parts);
}

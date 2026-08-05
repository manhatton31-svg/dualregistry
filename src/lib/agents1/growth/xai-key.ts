/**
 * Resolve xAI API key — delegates to central secrets module.
 */
import { getSecret, bootstrapSecrets, hasSecret } from "@/lib/secrets";

export function resolveXaiApiKey(): string | null {
  bootstrapSecrets();
  return getSecret("xai_api_key");
}

export function xaiConfigured(): boolean {
  bootstrapSecrets();
  return hasSecret("xai_api_key");
}

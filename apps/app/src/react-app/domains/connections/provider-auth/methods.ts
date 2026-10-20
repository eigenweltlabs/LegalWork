import { t } from "@/i18n";
import type { ProviderAuthMethod } from "./store";

export const isAnthropicProvider = (providerId: string) => providerId.trim().toLowerCase() === "anthropic";

/** Older engines may still advertise the retired Anthropic OAuth plugin. */
export function supportedProviderAuthMethods(providerId: string, methods: ProviderAuthMethod[]): ProviderAuthMethod[] {
  return isAnthropicProvider(providerId) ? [{ type: "api", label: t("providers.api_key_label") }] : methods;
}

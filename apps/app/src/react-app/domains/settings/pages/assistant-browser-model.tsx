import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssistantSettings } from "@legalwork/types/main-assistant";
import type { ModelOption } from "@/app/types";
import { ModelSelect } from "@/components/model-select";
import { Button } from "@/components/ui/button";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

export type AssistantBrowserModelPicker = {
  options: ModelOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AssistantBrowserModelField({ value, onChange, disabled, picker }: {
  value: AssistantSettings["browserModel"]; onChange: (value: AssistantSettings["browserModel"]) => void; disabled?: boolean;
  picker?: AssistantBrowserModelPicker;
}) {
  const [open, setOpen] = useState(false);
  return <div className="space-y-2" data-assistant-browser-model="">
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{t("assistant.browser_model")}</span>
      <ModelSelect open={picker?.open ?? open} onOpenChange={picker?.onOpenChange ?? setOpen} modelOptions={picker?.options} value={value ?? { providerID: "", modelID: "GPT-6.1 Terra" }} onChange={onChange} disabled={disabled} />
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">{t("assistant.browser_model_hint")}</p>
    {value && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>{t("assistant.browser_model_default")}</Button>}
  </div>;
}

/** The identity dialog edits the same persisted setting as Settings > Assistant. */
export function AssistantBrowserModelPreference({ client }: { client: LegalworkServerClient }) {
  const cache = useQueryClient();
  const queryKey = ["assistant-settings", client.baseUrl];
  const settings = useQuery({ queryKey, queryFn: () => client.assistantSettings() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const save = async (browserModel: AssistantSettings["browserModel"]) => {
    if (!settings.data || saving) return;
    setSaving(true); setError(false);
    try {
      const current = await client.assistantSettings();
      cache.setQueryData(queryKey, await client.updateAssistantSettings({ ...current.settings, browserModel }));
    } catch { setError(true); }
    finally { setSaving(false); }
  };
  return <div className="border-t border-border/60 pt-3">
    <AssistantBrowserModelField value={settings.data?.settings.browserModel} disabled={saving || !settings.data} onChange={value => { void save(value); }} />
    {(error || settings.isError) && <p role="alert" className="mt-2 text-xs text-destructive">{t("assistant.save_failed")}</p>}
  </div>;
}

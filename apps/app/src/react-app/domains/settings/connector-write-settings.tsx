/** @jsxImportSource react */
import { useEffect, useState } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";

export const CONNECTOR_SETTINGS_CHANGED = "legalwork-connector-settings-changed";
export function ConnectorWriteSettings({ id, kind, client }: { id: string; kind: "mail" | "calendar" | "files"; client: LegalworkServerClient | null | undefined }) {
  const [enabled, setEnabled] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setError(null);
    if (client) void client.connectorSettings(id).then((value) => {
      if (!cancelled) { setEnabled(value.writeAccess); setReadOnly(value.readOnly); setLoaded(true); }
    }).catch(() => { if (!cancelled) setError(t("connectors.write_settings_failed")); });
    return () => { cancelled = true; };
  }, [client, id]);
  if (!client) return null;
  return <div className="rounded-[16px] border border-dls-border bg-dls-surface p-4">
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <label htmlFor={`${id}-write-access`} className="text-sm font-medium text-dls-text">{t("connectors.write_access")}</label>
        <p className="max-w-2xl text-[13px] leading-relaxed text-dls-secondary">{t(`connectors.write_access_${kind}`)}</p>
      </div>
      <Switch id={`${id}-write-access`} checked={enabled} disabled={!loaded || busy || readOnly} onCheckedChange={(value) => {
        if (busy || !loaded) return;
        setBusy(true); setError(null);
        void client.setConnectorSettings(id, value).then((settings) => {
          setEnabled(settings.writeAccess);
          window.dispatchEvent(new Event(CONNECTOR_SETTINGS_CHANGED));
        }).catch(() => setError(t("connectors.write_settings_failed"))).finally(() => setBusy(false));
      }} />
    </div>
    <p className="mt-2 text-xs leading-relaxed text-dls-secondary">{t("connectors.write_access_permissions")}</p>
    {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
  </div>;
}

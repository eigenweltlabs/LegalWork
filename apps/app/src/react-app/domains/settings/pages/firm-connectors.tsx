/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, LogIn, Plug } from "lucide-react";
import type { FirmHubItem } from "@legalwork/types/firm-hub";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { McpStatusMap } from "@/app/types";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { FIRM_HUB_QUERY_KEY, useFirmHub } from "../../connections/firm-hub";
import { MemberKeyDialog } from "../../connections/org-policy-ui";

export const firmConnectorName = (slug: string) => slug.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, letter => letter.toUpperCase());

/** Team entries join the personal rows, rather than creating a second library. */
export function FirmConnectorLibrary(props: { client: LegalworkServerClient; children: (items: FirmHubItem[]) => ReactNode }) {
  const firmHub = useFirmHub(props.client);
  return <>
    {firmHub.isLoading ? <p role="status" className="text-xs text-muted-foreground">{t("firm_hub.loading")}</p> : null}
    {firmHub.error ? <p role="alert" className="text-sm text-destructive">{firmHub.error.message}</p> : null}
    {props.children((firmHub.data?.items ?? []).filter(item => item.kind === "mcp"))}
  </>;
}

/** Team-owned config stays managed by the hub; only optional membership and the member's account can change here. */
export function FirmConnectorRow(props: { item: FirmHubItem; client: LegalworkServerClient; statuses: McpStatusMap; busy: boolean; onSignIn: (name: string, url: string) => void; onChanged?: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [confirmAdd, setConfirmAdd] = useState(false);
  const { item } = props;
  const name = firmConnectorName(item.name);
  const installed = item.installation === "automatic" || item.added;
  const connector = item.connector;
  const status = connector ? props.statuses[connector.serverName]?.status : undefined;
  const needsKey = installed && connector?.access === "member" && !connector.hasOwnKey;
  const canSignIn = installed && connector?.access === "oauth" && connector.url && status !== "connected";
  const state = !installed ? null : needsKey ? t("firm_hub.connector_needs_key")
    : status === "needs_auth" || status === "needs_client_registration" ? t("firm_hub.connector_needs_sign_in")
    : status === "failed" ? t("firm_hub.connector_failed") : null;

  async function setAdded(added: boolean) {
    setBusy(true);
    try {
      queryClient.setQueryData(FIRM_HUB_QUERY_KEY, await props.client.setFirmHubAdded(item.id, added));
      props.onChanged?.();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("firm_hub.add_failed"));
    } finally { setBusy(false); }
  }

  async function saveKey(key: string) {
    queryClient.setQueryData(FIRM_HUB_QUERY_KEY, await props.client.setFirmHubKey(item.id, key));
    toast.success(t("firm_hub.key_saved", { name }));
    props.onChanged?.();
  }

  return <div className="flex flex-wrap items-center gap-3 rounded-xl px-1 py-2.5 hover:bg-muted/30">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border"><Plug className="size-4 text-muted-foreground" /></span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{name}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.description}</p>
    </div>
    <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground" title={t(item.installation === "automatic" ? "firm_hub.installed_for_everyone" : "integrations.team_optional")}>{t("firm_hub.scope_team")}</span>
    {state ? <span className="text-xs text-muted-foreground">{state}</span> : null}
    {installed && connector?.access === "member" ? <Button variant="outline" size="sm" disabled={props.busy || busy} onClick={() => setKeyOpen(true)}><KeyRound className="size-3.5" />{t(connector.hasOwnKey ? "firm_hub.change_key" : "firm_hub.add_key")}</Button> : null}
    {canSignIn && connector?.url ? <Button variant="outline" size="sm" disabled={props.busy || busy} onClick={() => connector.url && props.onSignIn(connector.serverName, connector.url)}><LogIn className="size-3.5" />{t("firm_hub.sign_in")}</Button> : null}
    {item.installation === "optional" ? <Switch checked={installed} disabled={props.busy || busy} aria-label={t(installed ? "mcp.disable_app" : "mcp.enable_app") + " " + name} onCheckedChange={added => { if (added) setConfirmAdd(true); else void setAdded(false); }} /> : null}
    {busy ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
    {keyOpen ? <MemberKeyDialog name={name} onSave={saveKey} onClose={() => setKeyOpen(false)} /> : null}
    <ConfirmModal open={confirmAdd} title={t("firm_hub.add_review_title", { name })} message={t("integrations.team_add_review")} confirmLabel={t("firm_hub.add")} cancelLabel={t("common.cancel")} variant="warning" onCancel={() => setConfirmAdd(false)} onConfirm={() => { setConfirmAdd(false); void setAdded(true); }} />
  </div>;
}

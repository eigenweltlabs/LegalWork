/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, Folder, Loader2, Mail } from "lucide-react";
import { connectorDefinitions, connectorIsConnected, connectorStatusSchema, type ConnectorStatus, type ConnectorOAuthClient } from "@legalwork/types/connectors";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { usePlatform } from "../../kernel/platform";
import { registerExtensionRuntime } from "./extension-registry";
import type { ExtensionConfigContext } from "./extension-registry";
import { CONNECTOR_SETTINGS_CHANGED, ConnectorWriteSettings } from "./connector-write-settings";
import { resolveBrandIconSrc } from "../../design-system/extension-icon-src";

export function ConnectorConfig({ id, legalworkServerClient: client, onExtensionConnectionChange }: Pick<ExtensionConfigContext, "legalworkServerClient" | "onExtensionConnectionChange"> & { id: string }) {
  const platform = usePlatform();
  const definition = connectorDefinitions.find((item) => item.id === id);
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<"nango" | "custom" | null>(null);
  const [oauthClient, setOAuthClient] = useState<ConnectorOAuthClient | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("");
  const active = useRef<{ cancelled: boolean; flowId?: string } | null>(null);
  const mounted = useRef(false);
  const connectionChange = useRef(onExtensionConnectionChange);
  useEffect(() => { connectionChange.current = onExtensionConnectionChange; }, [onExtensionConnectionChange]);

  const update = useCallback((value: ConnectorStatus) => {
    if (!mounted.current) return;
    const parsed = connectorStatusSchema.parse(value);
    setStatus(parsed);
    setError(null);
    for (const connector of parsed.connectors) connectionChange.current?.(connector.id, connectorIsConnected(connector));
  }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    const [value, details] = await Promise.all([client.connectorStatus(), client.connectorOAuthClient(id)]);
    if (!mounted.current) return;
    update(value); setOAuthClient(details); setClientId(details.clientId); setTenantId(details.tenantId); setClientSecret("");
  }, [client, id, update]);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch((value) => { if (mounted.current) setError(value instanceof Error ? value.message : t("connectors.failed")); });
    return () => {
      mounted.current = false;
      const pending = active.current;
      if (pending) {
        pending.cancelled = true;
        if (pending.flowId) void client?.connectorCancelFlow(pending.flowId).catch(() => undefined);
      }
    };
  }, [client, refresh]);

  useEffect(() => {
    const changed = () => {
      if (client) void client.connectorOAuthClient(id).then((details) => { if (mounted.current) setOAuthClient(details); })
        .catch(() => { if (mounted.current) setError(t("connectors.failed")); });
    };
    window.addEventListener(CONNECTOR_SETTINGS_CHANGED, changed);
    return () => window.removeEventListener(CONNECTOR_SETTINGS_CHANGED, changed);
  }, [client, id]);

  const run = async (label: string, command: () => Promise<void>) => {
    if (active.current || busy) return;
    setBusy(label); setError(null); setNotice(null);
    try { await command(); }
    catch (value) { if (mounted.current) setError(value instanceof Error ? value.message : t("connectors.failed")); }
    finally { if (mounted.current) setBusy(null); }
  };

  const connector = status?.connectors.find((item) => item.id === id);
  const connections = connector?.connections ?? [];
  const sharedOutlookAccount = id === "outlook" || id === "outlook-calendar";
  const method = connections.length === 1 ? connections[0].source ?? "nango" : selectedMethod ?? (status?.requiresSignIn || oauthClient?.configured ? "custom" : "nango");
  const dirty = clientId.trim() !== oauthClient?.clientId || tenantId.trim() !== oauthClient?.tenantId || Boolean(clientSecret.trim());
  const connect = async (connectionId?: string, source = method) => {
    if (!client) return;
    const pending: { cancelled: boolean; flowId?: string } = { cancelled: false };
    active.current = pending;
    try {
      const flow = await client.connectorConnect(id, connectionId, source);
      pending.flowId = flow.flowId;
      if (pending.cancelled) return;
      platform.openLink(flow.connectUrl);
      while (!pending.cancelled && Date.now() < flow.expiresAt) {
        const result = await client.connectorFlowStatus(flow.flowId);
        if (pending.cancelled) return;
        if (result.status === "connected") { await refresh(); if (mounted.current) setNotice(t("connectors.connected")); return; }
        if (result.status === "expired") break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!pending.cancelled) throw new Error(t("connectors.expired"));
    } finally {
      if (pending.flowId) await client.connectorCancelFlow(pending.flowId).catch(() => undefined);
      if (active.current === pending) active.current = null;
    }
  };

  if (!definition) return null;
  const Icon = definition.kind === "calendar" ? CalendarDays : definition.kind === "files" ? Folder : Mail;
  const iconSrc = resolveBrandIconSrc(undefined, definition.icon);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {iconSrc ? <img src={iconSrc} alt="" className="size-5 shrink-0 object-contain" /> : <Icon className="size-4" />}
          {definition.name}
        </CardTitle>
        <CardDescription>{t(definition.descriptionKey)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ConnectorWriteSettings id={id} kind={definition.kind} client={client} />
        {sharedOutlookAccount && connections.length === 1 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">{t(connector?.active ? "connectors.activation_active" : "connectors.activation_available")}</p>
          <Button variant={connector?.active ? "outline" : "default"} disabled={Boolean(busy) || !client} onClick={() => void run("activate", async () => {
            if (client) { await client.connectorActivation(id, connections[0].id, !connector?.active); await refresh(); }
          })}>{t(connector?.active ? "connectors.deactivate" : "connectors.activate", { name: definition.name })}</Button>
        </div>}
        <Field>
          <FieldLabel htmlFor={`${id}-method`}>{t("connectors.method")}</FieldLabel>
          <Select value={method} disabled={Boolean(busy) || connections.length > 0} onValueChange={(value) => { if (value === "nango" || value === "custom") setSelectedMethod(value); }}>
            <SelectTrigger id={`${id}-method`} className="w-full"><SelectValue>{method === "custom" ? t("connectors.method_custom") : t("connectors.method_nango")}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="nango">{t("connectors.method_nango")}</SelectItem><SelectItem value="custom">{t("connectors.method_custom")}</SelectItem></SelectContent>
          </Select>
        </Field>
        <p className="text-sm text-muted-foreground">{t(method === "custom" ? "connectors.custom_privacy" : "connectors.privacy", { name: definition.name })}</p>
        {(id === "outlook" || definition.connectionConnectorId === "outlook") && <p className="text-sm text-muted-foreground">{t("connectors.outlook_shared")}</p>}
        {method === "custom" && oauthClient && <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t(oauthClient.family === "google" ? "connectors.google_setup" : "connectors.microsoft_setup")}</p>
          <Field>
            <FieldLabel htmlFor={`${id}-client-id`}>{t("connectors.client_id")}</FieldLabel>
            <Input id={`${id}-client-id`} value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" disabled={Boolean(busy)} />
          </Field>
          {oauthClient.supportsClientSecret && <Field>
            <FieldLabel htmlFor={`${id}-client-secret`}>{t("connectors.client_secret")}</FieldLabel>
            <Input id={`${id}-client-secret`} type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="new-password" disabled={Boolean(busy)} placeholder={oauthClient.hasClientSecret ? t("connectors.secret_saved") : undefined} />
          </Field>}
          {oauthClient.family === "microsoft" && <Field>
            <FieldLabel htmlFor={`${id}-tenant-id`}>{t("connectors.tenant_id")}</FieldLabel>
            <Input id={`${id}-tenant-id`} value={tenantId} onChange={(event) => setTenantId(event.target.value)} autoComplete="off" disabled={Boolean(busy)} placeholder={id === "onedrive-personal" ? "consumers" : "common"} />
            <FieldDescription>{t("connectors.tenant_hint")}</FieldDescription>
          </Field>}
          <Field>
            <FieldLabel htmlFor={`${id}-redirect`}>{t("connectors.redirect_uri")}</FieldLabel>
            <Input id={`${id}-redirect`} value={oauthClient.redirectUri} readOnly className="font-mono text-xs" />
          </Field>
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t("connectors.permissions")}</summary><ul className="mt-2 space-y-1">{oauthClient.scopes.map((scope) => <li key={scope} className="break-all font-mono">{scope}</li>)}</ul></details>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={Boolean(busy) || !clientId.trim() || !dirty} onClick={() => void run("save", async () => {
              if (!client) return;
              await client.connectorSaveOAuthClient(id, { clientId: clientId.trim(), tenantId: tenantId.trim(), ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}) });
              await refresh(); setNotice(t("connectors.details_saved"));
            })}>{t("connectors.save_details")}</Button>
            {oauthClient.configured && <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void run("remove", async () => {
              if (client) { await client.connectorRemoveOAuthClient(id); await refresh(); }
            })}>{t("connectors.remove_details")}</Button>}
          </div>
          <p className="text-xs text-muted-foreground">{t("connectors.local_vault")}</p>
        </div>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {connections.length > 1 && <Alert variant="destructive"><AlertDescription>{t("connectors.single_account_cleanup")}</AlertDescription></Alert>}
        {notice && <p className="flex items-center gap-2 text-sm" role="status"><CheckCircle2 className="size-4" />{notice}</p>}
        {method === "nango" && status?.requiresSignIn && <Alert><AlertDescription>{t("connectors.signin_hint")}</AlertDescription></Alert>}
        {method === "nango" && status && !status.requiresSignIn && !connector?.configured && <Alert><AlertDescription>{t("connectors.unavailable")}</AlertDescription></Alert>}
        {!client && <p className="text-sm text-muted-foreground">{t("connectors.server_required")}</p>}
        {connections.map((connection, index) => (
          <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{connections.length === 1 ? t("connectors.account_single") : t("connectors.account", { count: index + 1 })}</div>
              <div className="text-xs text-muted-foreground">{connection.needsReconnect ? t("connectors.reconnect_needed") : t("connectors.connected")}</div>
              <div className="text-xs text-muted-foreground">{t(connection.source === "custom" ? "connectors.method_custom" : "connectors.method_nango")}</div>
              {connection.createdAt && <div className="mt-1 text-xs text-muted-foreground">{new Date(connection.createdAt).toLocaleDateString()}</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={Boolean(busy) || connections.length > 1} onClick={() => void run("connect", () => connect(connection.id, connection.source === "custom" ? "custom" : "nango"))}>{t("connectors.reconnect")}</Button>
              <Button variant="outline" size="sm" disabled={Boolean(busy) || connections.length > 1 || (sharedOutlookAccount && !connector?.active)} onClick={() => void run("test", async () => {
                if (client) { await client.connectorTest(id, connection.id); setNotice(t("connectors.test_passed")); }
              })}>{t("connectors.test")}</Button>
              <Button variant="destructive" size="sm" disabled={Boolean(busy)} onClick={() => void run("disconnect", async () => {
                if (client) update(await client.connectorDisconnect(id, connection.id));
              })}>{t("connectors.disconnect")}</Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          {status && connections.length === 0 && <Button disabled={Boolean(busy) || !client || (method === "custom" ? !oauthClient?.configured || dirty : !connector?.configured || status?.requiresSignIn)} onClick={() => void run("connect", () => connect())}>
            {busy === "connect" && <Loader2 className="size-4 animate-spin" />}{t("connectors.connect", { name: definition.name })}
          </Button>}
          <Button variant="outline" disabled={Boolean(busy) || !client} onClick={() => void run("refresh", refresh)}>{t("connectors.refresh")}</Button>
          {busy === "connect" && <Button variant="ghost" onClick={() => {
            const pending = active.current;
            if (pending) { pending.cancelled = true; if (pending.flowId) void client?.connectorCancelFlow(pending.flowId).catch(() => undefined); }
          }}>{t("connectors.cancel")}</Button>}
        </div>
        {busy === "connect" && <p className="text-sm text-muted-foreground" role="status">{t("connectors.waiting")}</p>}
      </CardContent>
    </Card>
  );
}

for (const { id } of connectorDefinitions) registerExtensionRuntime({ id,
  settingsPanel: (ctx) => <ConnectorConfig key={id} {...ctx} id={id} />,
  isConnected: (_entry, ctx) => ctx.extensionConnections?.[id] === true,
});

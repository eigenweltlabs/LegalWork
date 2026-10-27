import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LoaderCircle } from "lucide-react";
import type { BrowserPasswordRequest } from "@legalwork/types/browser-password-request";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { t } from "@/i18n";

/** Password state belongs only to this card, never the chat/form answer cache. */
export function BrowserPasswordForm({ request, client, busy, onComplete, onCancel }: {
  request: BrowserPasswordRequest;
  client?: LegalworkServerClient;
  busy: boolean;
  onComplete: (id: string) => void;
  onCancel: () => void;
}) {
  const id = useId(), cache = useQueryClient();
  const [username, setUsername] = useState(request.username), [password, setPassword] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null), [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const active = useRef(true), submitting = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const available = Boolean(client?.canApprove);
  const existing = useQuery({ queryKey: ["browser-passwords", client?.baseUrl, request.website],
    queryFn: () => { if (!client) throw new Error(t("browser_password_request.unavailable")); return client.listBrowserPasswords(request.website); }, enabled: available });
  const entries = existing.data?.items ?? [];
  const entryId = savedId ?? (entries.length ? selectedId || entries[0]!.id : null);
  const disabled = busy || saving;
  const save = async () => {
    if (!client || !available || disabled || submitting.current) return;
    if (entryId) { onComplete(entryId); return; }
    submitting.current = true; setSaving(true); setError("");
    try {
      const { item } = await client.saveBrowserPassword({ origin: request.website, label: request.label, username, password });
      if (!active.current) return;
      setPassword(""); setSavedId(item.id);
      void cache.invalidateQueries({ queryKey: ["browser-passwords", client.baseUrl] });
      onComplete(item.id);
    } catch {
      if (active.current) setError(t("browser_password_request.save_failed"));
    } finally {
      submitting.current = false;
      if (active.current) setSaving(false);
    }
  };
  return <form className="space-y-3 rounded-xl border border-dls-border bg-dls-surface p-4" data-private data-ph-mask
    onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="flex items-center gap-2"><KeyRound className="size-4" /><h3 className="text-sm font-semibold">{t("browser_password_request.title")}</h3></div>
    <p className="break-all text-sm font-medium">{request.website}</p>
    <p className="text-xs text-muted-foreground">{t("browser_password_request.description")}</p>
    {!available ? <p role="alert" className="text-sm text-muted-foreground">{t("browser_password_request.unavailable")}</p> : null}
    {existing.isLoading ? <p role="status" className="text-sm text-muted-foreground">{t("settings.browser_passwords.loading")}</p> : null}
    {existing.error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{t("browser_password_request.load_failed")}</p>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void existing.refetch()}>{t("browser_password_request.retry")}</Button></div> : null}
    {entryId ? <div className="space-y-2">
      <p role="status" className="text-sm">{t("browser_password_request.saved")}</p>
      {entries.length > 1 ? <select aria-label={t("browser_password_request.account")} className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={entryId} disabled={disabled}
        onChange={event => setSelectedId(event.currentTarget.value)}>
        {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.label}{entry.username ? ` · ${entry.username}` : ""}</option>)}
      </select> : null}
    </div> : <div className="space-y-3">
      <Field><FieldLabel htmlFor={`${id}-username`}>{t("settings.browser_passwords.username")}</FieldLabel>
        <Input id={`${id}-username`} autoComplete="username" value={username} maxLength={500} disabled={disabled || !available} onChange={event => setUsername(event.currentTarget.value)} />
      </Field>
      <Field><FieldLabel htmlFor={`${id}-password`}>{t("settings.browser_passwords.password")}</FieldLabel>
        <Input id={`${id}-password`} type="password" autoComplete="current-password" value={password} required maxLength={10000} disabled={disabled || !available} onChange={event => setPassword(event.currentTarget.value)} />
      </Field>
    </div>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={disabled || !available || existing.isLoading || Boolean(existing.error) || !entryId && !password}>
        {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {t(saving ? "settings.environment.saving" : entryId ? "browser_password_request.continue" : "browser_password_request.save")}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { setPassword(""); onCancel(); }}>{t("settings.environment.cancel")}</Button>
    </div>
    <p className="text-xs text-muted-foreground">{t("browser_password_request.manage")}</p>
  </form>;
}

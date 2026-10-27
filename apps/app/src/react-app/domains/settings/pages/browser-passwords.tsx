/** @jsxImportSource react */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { LayoutSection, LayoutSectionDescription, LayoutSectionHeader, LayoutSectionTitle } from "../settings-layout";
import { SettingsNotice } from "../settings-section";
import type { LegalworkBrowserPassword, LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

type Draft = { id?: string; label: string; origin: string; username: string; password: string };
export function BrowserPasswords({ client }: { client: LegalworkServerClient }) {
  const queryClient = useQueryClient();
  const queryKey = ["browser-passwords", client.baseUrl];
  const list = useQuery({ queryKey, queryFn: () => client.listBrowserPasswords() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<LegalworkBrowserPassword | null>(null);
  const fieldsId = useId();
  const save = useMutation({ gcTime: 0, mutationFn: (value: Draft) => client.saveBrowserPassword(value), onSuccess: async () => {
    setDraft(null); save.reset(); await queryClient.invalidateQueries({ queryKey });
  } });
  const remove = useMutation({ mutationFn: (id: string) => client.deleteBrowserPassword(id), onSuccess: async () => {
    setRemoving(null); await queryClient.invalidateQueries({ queryKey });
  } });
  const busy = save.isPending || remove.isPending;
  const open = (value: Draft) => { save.reset(); setDraft(value); };
  return <LayoutSection>
    <LayoutSectionHeader>
      <div className="flex items-start justify-between gap-4">
        <div>
          <LayoutSectionTitle>{t("settings.browser_passwords.title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.browser_passwords.description")}</LayoutSectionDescription>
        </div>
        <Button className="shrink-0" onClick={() => open({ label: "", origin: "", username: "", password: "" })}>
          <Plus className="size-4" />{t("settings.browser_passwords.add")}
        </Button>
      </div>
    </LayoutSectionHeader>
    <p className="text-sm text-muted-foreground">{t("settings.browser_passwords.privacy")}</p>
    {list.error ? <SettingsNotice tone="error">{list.error.message}</SettingsNotice> : null}
    {list.isLoading ? <p className="text-sm text-muted-foreground">{t("settings.browser_passwords.loading")}</p> : null}
    {list.data?.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("settings.browser_passwords.empty")}</p> : null}
    <div className="divide-y rounded-lg border">
      {list.data?.items.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="font-medium break-words">{item.label}</p>
          <p className="text-sm text-muted-foreground break-all">{item.origin}{item.username ? ` · ${item.username}` : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => open({ ...item, password: "" })}>{t("settings.browser_passwords.edit")}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { remove.reset(); setRemoving(item); }}>{t("settings.environment.delete")}</Button>
        </div>
      </div>)}
    </div>
    <Dialog open={draft !== null} onOpenChange={value => { if (!value && !save.isPending) setDraft(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t(draft?.id ? "settings.browser_passwords.edit" : "settings.browser_passwords.add")}</DialogTitle></DialogHeader>
        {draft ? <form onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate(draft); }}>
          <FieldGroup>
            <Field><FieldLabel htmlFor={`${fieldsId}-label`}>{t("settings.browser_passwords.label")}</FieldLabel>
              <Input id={`${fieldsId}-label`} value={draft.label} required maxLength={200} disabled={save.isPending} onChange={e => setDraft({ ...draft, label: e.target.value })} />
            </Field>
            <Field><FieldLabel htmlFor={`${fieldsId}-origin`}>{t("settings.browser_passwords.website")}</FieldLabel>
              <Input id={`${fieldsId}-origin`} value={draft.origin} type="url" required maxLength={2000} disabled={save.isPending} placeholder="https://example.com" onChange={e => setDraft({ ...draft, origin: e.target.value })} />
              <FieldDescription>{t("settings.browser_passwords.website_hint")}</FieldDescription>
            </Field>
            <Field><FieldLabel htmlFor={`${fieldsId}-username`}>{t("settings.browser_passwords.username")}</FieldLabel>
              <Input id={`${fieldsId}-username`} value={draft.username} maxLength={500} disabled={save.isPending} autoComplete="off" onChange={e => setDraft({ ...draft, username: e.target.value })} />
            </Field>
            <Field><FieldLabel htmlFor={`${fieldsId}-password`}>{t("settings.browser_passwords.password")}</FieldLabel>
              <Input id={`${fieldsId}-password`} value={draft.password} type="password" required={!draft.id} maxLength={10000} disabled={save.isPending} autoComplete="new-password" onChange={e => setDraft({ ...draft, password: e.target.value })} />
              {draft.id ? <FieldDescription>{t("settings.browser_passwords.keep_password")}</FieldDescription> : null}
            </Field>
          </FieldGroup>
          {save.error ? <SettingsNotice tone="error">{save.error.message}</SettingsNotice> : null}
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={() => setDraft(null)}>{t("settings.environment.cancel")}</Button>
            <Button type="submit" disabled={save.isPending}>{t(save.isPending ? "settings.environment.saving" : "settings.environment.save")}</Button>
          </DialogFooter>
        </form> : null}
      </DialogContent>
    </Dialog>
    {remove.error ? <SettingsNotice tone="error">{remove.error.message}</SettingsNotice> : null}
    <ConfirmModal open={removing !== null} title={t("settings.browser_passwords.delete_title")}
      message={t("settings.browser_passwords.delete_message").replace("{label}", removing?.label ?? "")}
      confirmLabel={t("settings.environment.delete")} cancelLabel={t("settings.environment.cancel")} variant="danger" confirmButtonVariant="destructive"
      onCancel={() => { if (!remove.isPending) setRemoving(null); }} onConfirm={() => { if (removing && !remove.isPending) remove.mutate(removing.id); }} />
  </LayoutSection>;
}

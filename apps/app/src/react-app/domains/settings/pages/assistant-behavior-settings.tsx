import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AssistantProjectAccessSchema, type AssistantSettings, type AssistantSettingsCatalog, type AssistantResource } from "@legalwork/types/main-assistant";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t } from "@/i18n";

export function AssistantBehaviorSettings({ client }: { client: LegalworkServerClient }) {
  const cache = useQueryClient();
  const settings = useQuery({ queryKey: ["assistant-settings", client.baseUrl], queryFn: () => client.assistantSettings() });
  const catalog = useQuery({ queryKey: ["assistant-settings-catalog", client.baseUrl], queryFn: () => client.assistantSettingsCatalog() });
  if (settings.isPending || catalog.isPending) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("assistant.settings_loading")}</p>;
  if (settings.isError || catalog.isError) return <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{t("assistant.settings_load_failed")}</p><Button variant="outline" onClick={() => { void settings.refetch(); void catalog.refetch(); }}>{t("assistant.attention_retry")}</Button></div>;
  return <AssistantBehaviorForm settings={settings.data.settings} catalog={catalog.data} onSave={async draft => {
    const saved = await client.updateAssistantSettings(draft);
    cache.setQueryData(["assistant-settings", client.baseUrl], saved);
    return saved.settings;
  }} />;
}

const accessModes: Array<{ value: AssistantSettings["projectAccess"]["mode"]; label: "assistant.access_all" | "assistant.access_none" | "assistant.access_exclude" | "assistant.access_include" }> = [
  { value: "all", label: "assistant.access_all" }, { value: "none", label: "assistant.access_none" },
  { value: "exclude", label: "assistant.access_exclude" }, { value: "include", label: "assistant.access_include" },
];
const resourceKinds: Array<{ kind: AssistantResource["kind"]; label: "extensions.filter_plugins" | "sidebar.workflows" | "dashboard.skills" }> = [
  { kind: "plugin", label: "extensions.filter_plugins" }, { kind: "workflow", label: "sidebar.workflows" }, { kind: "skill", label: "dashboard.skills" },
];
function toggle(items: string[], id: string, checked: boolean) {
  return checked ? [...new Set([...items, id])] : items.filter(item => item !== id);
}

export function AssistantBehaviorForm({ settings, catalog, onSave }: {
  settings: AssistantSettings; catalog: AssistantSettingsCatalog; onSave: (settings: AssistantSettings) => Promise<AssistantSettings>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(settings);
  const [resourceSearch, setResourceSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const resources = catalog.resources.filter(item => `${item.name} ${item.description} ${item.projectName ?? ""}`.toLocaleLowerCase().includes(resourceSearch.toLocaleLowerCase()));
  const missing = draft.resourceIds.filter(ref => !catalog.resources.some(item => item.id === ref));
  const projects = catalog.projects.filter(project => project.name.toLocaleLowerCase().includes(projectSearch.toLocaleLowerCase()));
  const missingProjects = draft.projectAccess.projectIds.filter(ref => !catalog.projects.some(project => project.id === ref));
  return <form className="space-y-6 border-t border-border pt-5" onSubmit={event => {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true); setStatus(null);
    void onSave(draft).then(value => { setSaved(value); setDraft(value); setStatus("saved"); }).catch(() => setStatus("error")).finally(() => setSaving(false));
  }}>
    <fieldset disabled={saving} className="space-y-6">
      <div className="space-y-2">
        <label htmlFor={`${id}-prompt`} className="text-sm font-medium">{t("assistant.instructions")}</label>
        <p id={`${id}-prompt-help`} className="text-xs text-muted-foreground">{t("assistant.instructions_hint")}</p>
        <Textarea id={`${id}-prompt`} aria-describedby={`${id}-prompt-help`} value={draft.systemPromptAddition} rows={5} placeholder={t("assistant.instructions_placeholder")} onChange={event => { setDraft({ ...draft, systemPromptAddition: event.target.value }); setStatus(null); }} />
      </div>
      <div className="space-y-3 border-t border-border pt-5">
        <div className="space-y-1"><h3 className="text-sm font-medium">{t("assistant.resources")}</h3><p className="text-xs text-muted-foreground">{t("assistant.resources_hint")}</p></div>
        {catalog.unavailable.length > 0 && <p role="status" className="text-xs text-muted-foreground">{t("assistant.resources_partial")}</p>}
        <Input aria-label={t("assistant.resources_search")} placeholder={t("assistant.resources_search")} value={resourceSearch} onChange={event => setResourceSearch(event.target.value)} />
        {resourceKinds.map(({ kind, label }) => <details key={kind} className="group border-b border-border pb-3" open={resourceSearch ? true : undefined}>
          <summary className="cursor-pointer text-sm font-medium">{t(label)} <span className="ml-1 text-xs font-normal text-muted-foreground">({catalog.resources.filter(item => item.kind === kind && draft.resourceIds.includes(item.id)).length})</span></summary>
          <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-2">
            {resources.filter(item => item.kind === kind).map(item => <label key={item.id} className="flex cursor-pointer items-start gap-3">
              <Checkbox className="mt-0.5" checked={draft.resourceIds.includes(item.id)} onCheckedChange={checked => { setDraft({ ...draft, resourceIds: toggle(draft.resourceIds, item.id, checked) }); setStatus(null); }} />
              <span className="min-w-0 space-y-0.5"><span className="block text-sm">{item.name}<span className="ml-2 text-xs text-muted-foreground">{item.projectName ?? t("assistant.resources_global")}</span></span>
                {item.description && <span className="block text-xs text-muted-foreground">{item.description}</span>}
                {item.projectId && catalog.projects.some(project => project.id === item.projectId) && !projectAllowed(draft, item.projectId) && <span className="block text-xs text-muted-foreground">{t("assistant.resource_project_blocked")}</span>}
              </span>
            </label>)}
            {!resources.some(item => item.kind === kind) && <p className="text-xs text-muted-foreground">{t("assistant.resources_empty")}</p>}
          </div>
        </details>)}
        {missing.map(ref => <label key={ref} className="flex items-center gap-3 text-xs text-muted-foreground"><Checkbox checked onCheckedChange={() => setDraft({ ...draft, resourceIds: draft.resourceIds.filter(item => item !== ref) })} />{t("assistant.resource_unavailable")}</label>)}
      </div>
      <div className="space-y-3 border-t border-border pt-5">
        <div className="space-y-1"><label id={`${id}-access-label`} className="text-sm font-medium">{t("assistant.project_access")}</label><p className="text-xs text-muted-foreground">{t("assistant.project_access_hint")}</p></div>
        <Select value={draft.projectAccess.mode} onValueChange={value => {
          const parsed = AssistantProjectAccessSchema.shape.mode.safeParse(value);
          if (parsed.success) { setDraft({ ...draft, projectAccess: { ...draft.projectAccess, mode: parsed.data } }); setStatus(null); }
        }}><SelectTrigger aria-labelledby={`${id}-access-label`} className="min-w-56"><SelectValue>{value => t(accessModes.find(mode => mode.value === value)?.label ?? "assistant.access_all")}</SelectValue></SelectTrigger><SelectContent>{accessModes.map(mode => <SelectItem key={mode.value} value={mode.value}>{t(mode.label)}</SelectItem>)}</SelectContent></Select>
        {(draft.projectAccess.mode === "include" || draft.projectAccess.mode === "exclude") && <div className="space-y-3">
          <Input aria-label={t("assistant.projects_search")} placeholder={t("assistant.projects_search")} value={projectSearch} onChange={event => setProjectSearch(event.target.value)} />
          <div className="max-h-64 space-y-3 overflow-y-auto">
            {projects.map(project => <label key={project.id} className="flex cursor-pointer items-center gap-3 text-sm"><Checkbox checked={draft.projectAccess.projectIds.includes(project.id)} onCheckedChange={checked => { setDraft({ ...draft, projectAccess: { ...draft.projectAccess, projectIds: toggle(draft.projectAccess.projectIds, project.id, checked) } }); setStatus(null); }} />{project.name}</label>)}
            {missingProjects.map(ref => <label key={ref} className="flex items-center gap-3 text-xs text-muted-foreground"><Checkbox checked onCheckedChange={() => setDraft({ ...draft, projectAccess: { ...draft.projectAccess, projectIds: draft.projectAccess.projectIds.filter(item => item !== ref) } })} />{t("assistant.project_unavailable")}</label>)}
            {!projects.length && <p className="text-xs text-muted-foreground">{t("assistant.projects_empty")}</p>}
          </div>
        </div>}
        <p className="text-xs text-muted-foreground">{t("assistant.project_access_scope")}</p>
      </div>
    </fieldset>
    <div className="flex items-center gap-3"><Button type="submit" disabled={!dirty || saving}>{saving && <Loader2 className="size-4 animate-spin" />}{t(saving ? "common.saving" : "common.save")}</Button>
      {status && <p role={status === "error" ? "alert" : "status"} className={status === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{t(status === "error" ? "assistant.save_failed" : "assistant.settings_saved")}</p>}
    </div>
  </form>;
}
function projectAllowed(settings: AssistantSettings, id: string) {
  const access = settings.projectAccess;
  return access.mode === "all" || access.mode === "include" && access.projectIds.includes(id) || access.mode === "exclude" && !access.projectIds.includes(id);
}

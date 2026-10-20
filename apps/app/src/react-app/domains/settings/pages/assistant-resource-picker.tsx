import { useState } from "react";
import { Blocks, Plus, Search, Sparkles, Workflow, X } from "lucide-react";
import type { AssistantResource } from "@legalwork/types/main-assistant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/i18n";

type Props = {
  kind: AssistantResource["kind"];
  label: string;
  resources: AssistantResource[];
  selectedIds: string[];
  onToggle: (id: string, checked: boolean) => void;
  projectAllowed: (id: string) => boolean;
  disabled?: boolean;
};

export function AssistantResourcePicker({ kind, label, resources, selectedIds, onToggle, projectAllowed, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = resources.filter(item => selectedIds.includes(item.id));
  const query = search.trim().toLocaleLowerCase();
  const matches = resources.filter(item => `${item.name} ${item.description} ${item.projectName ?? ""}`.toLocaleLowerCase().includes(query));
  const Icon = kind === "plugin" ? Blocks : kind === "workflow" ? Workflow : Sparkles;
  return <div className="flex items-start gap-3 py-2">
    <Icon aria-hidden="true" className="mt-2 size-4 shrink-0 text-muted-foreground" />
    <div className="min-w-0 flex-1">
      <h4 className="text-sm leading-8">{label}</h4>
      {selected.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5 pb-1">
        {selected.map(item => <Badge key={item.id} variant="secondary" className="h-auto min-h-6 max-w-full gap-0.5 py-0 pl-2 pr-0 font-normal" title={item.projectId && !projectAllowed(item.projectId) ? t("assistant.resource_project_blocked") : item.projectName ?? item.name}>
          <span className="min-w-0 truncate">{item.name}</span>
          <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`${t("common.remove")}: ${item.name}`} onClick={() => onToggle(item.id, false)}><X /></Button>
        </Badge>)}
      </div>}
    </div>
    <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setSearch(""); }}>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1.5 text-xs" disabled={disabled} aria-label={`${t("common.add")}: ${label}`} />}><Plus className="size-3.5" />{t("common.add")}</PopoverTrigger>
      <PopoverContent align="end" className="w-[min(420px,calc(100vw-32px))] gap-0 overflow-hidden p-0">
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        <div className="relative border-b border-border">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={search} onChange={event => setSearch(event.target.value)} aria-label={`${t("assistant.resources_search")}: ${label}`} placeholder={t("assistant.resources_search")} className="h-11 rounded-none border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0" />
        </div>
        {open && <AssistantResourceOptions resources={matches} selectedIds={selectedIds} onToggle={onToggle} projectAllowed={projectAllowed} disabled={disabled} />}
      </PopoverContent>
    </Popover>
  </div>;
}

export function AssistantResourceOptions({ resources, selectedIds, onToggle, projectAllowed, disabled }: Omit<Props, "kind" | "label">) {
  return <div className="max-h-72 overflow-y-auto p-1.5">
    {resources.map(item => <label key={item.id} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
      <Checkbox className="mt-0.5" checked={selectedIds.includes(item.id)} disabled={disabled} onCheckedChange={checked => onToggle(item.id, checked)} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5">{item.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.projectName ?? t("assistant.resources_global")}</span>
        {item.description && <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground" title={item.description}>{item.description}</span>}
        {item.projectId && !projectAllowed(item.projectId) && <span className="mt-1 block text-xs text-muted-foreground">{t("assistant.resource_project_blocked")}</span>}
      </span>
    </label>)}
    {!resources.length && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("assistant.resources_empty")}</p>}
  </div>;
}

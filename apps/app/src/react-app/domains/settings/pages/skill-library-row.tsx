import type { ReactNode } from "react";
import { Blocks, ChevronRight, Download, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";

export function SkillLibraryRow(props: { name: string; description: string; source?: ReactNode; busy: boolean; onOpen: () => void; onExport?: () => void; onShare?: () => void; onRemove?: () => void }) {
  return <div className="flex items-center gap-3 rounded-xl px-1 py-2.5 transition-colors hover:bg-muted/30">
    <button type="button" onClick={props.onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border"><Blocks className="size-4 text-muted-foreground" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{props.name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{props.description}</span></span>
    </button>
    {props.source ? <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{props.source}</span> : null}
    {props.onExport || props.onShare || props.onRemove ? <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={props.busy} aria-label={t("integrations.skill_actions", { name: props.name })} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={props.onOpen}><Pencil />{t("common.edit")}</DropdownMenuItem>
        {props.onExport ? <DropdownMenuItem onClick={props.onExport}><Download />{t("skill_export.action")}</DropdownMenuItem> : null}
        {props.onShare ? <DropdownMenuItem onClick={props.onShare}><Share2 />{t("firm_hub.share_with_firm")}</DropdownMenuItem> : null}
        {props.onRemove ? <DropdownMenuItem variant="destructive" onClick={props.onRemove}><Trash2 />{t("skills.uninstall")}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
  </div>;
}

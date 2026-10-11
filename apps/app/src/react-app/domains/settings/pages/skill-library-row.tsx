import type { ReactNode } from "react";
import { Blocks, Download, Share2, Trash2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { IntegrationLibraryRow } from "./integration-library";
import { t } from "@/i18n";

export function SkillLibraryRow(props: { name: string; description: string; source?: ReactNode; busy: boolean; onOpen: () => void; onExport?: () => void; onShare?: () => void; onRemove?: () => void }) {
  return <IntegrationLibraryRow {...props} icon={<span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border"><Blocks className="size-4 text-muted-foreground" /></span>}
    openLabel={props.onRemove ? t("common.edit") : undefined} actions={<>
        {props.onExport ? <DropdownMenuItem onClick={props.onExport}><Download />{t("skill_export.action")}</DropdownMenuItem> : null}
        {props.onShare ? <DropdownMenuItem onClick={props.onShare}><Share2 />{t("firm_hub.share_with_firm")}</DropdownMenuItem> : null}
        {props.onRemove ? <DropdownMenuItem variant="destructive" onClick={props.onRemove}><Trash2 />{t("skills.uninstall")}</DropdownMenuItem> : null}
    </>} />;
}

import { Trash2, type LucideIcon } from "lucide-react";
import { t } from "@/i18n";
import { optionId } from "./launcher-keyboard";

export type NavigationRow = { id: string; title: string; subtitle?: string; Icon: LucideIcon; run: () => void | Promise<unknown>; remove?: () => void; shortcut?: string };

export function LauncherNavigationRows({ rows, selected, onSelect, onError }: { rows: NavigationRow[]; selected: string | null; onSelect: (id: string) => void; onError: (error: unknown) => void }) {
  return <>{rows.map(({ id, title, subtitle, Icon, run, remove, shortcut }) => <div key={id} id={optionId(id)} data-launcher-item role="option" aria-selected={selected === id} data-selected={selected === id} className="launcher-row"
    onMouseMove={() => onSelect(id)} onClick={() => void Promise.resolve().then(run).catch(onError)}>
    <span className="launcher-row-icon"><Icon className="size-4" /></span>
    <div className="launcher-row-main"><div className="launcher-row-title">{title}</div>{subtitle && <div className="launcher-row-meta">{subtitle}</div>}</div>
    {shortcut && <kbd className="launcher-row-shortcut">{shortcut}</kbd>}
    {remove && <button type="button" className="launcher-row-remove" aria-label={t("launcher.saved.delete")} onClick={event => { event.stopPropagation(); remove(); }}><Trash2 className="size-3.5" /></button>}
  </div>)}</>;
}

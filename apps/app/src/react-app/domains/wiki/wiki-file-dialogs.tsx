import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import type { WikiEntry, WikiEntryOperation } from "@legalwork/types/wiki";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import { wikiError } from "./wiki-dialogs";

export type WikiFileDialogAction = { action: "create-folder"; path: string } | { action: "rename" | "move" | "copy" | "trash"; entry: WikiEntry; value: string };

export function WikiFileDialog(props: { value: WikiFileDialogAction; folders: string[]; onClose: () => void; onSubmit: (operation: WikiEntryOperation) => Promise<void> }) {
  const action = props.value.action;
  const source = "entry" in props.value ? props.value.entry : null;
  const parent = source?.path.includes("/") ? source.path.slice(0, source.path.lastIndexOf("/")) : "";
  const destinations = [{ value: "", label: t("wiki.wiki_root") }, ...props.folders.filter((folder) => source?.kind !== "folder" || (folder !== source.path && !folder.startsWith(`${source.path}/`))).map((folder) => ({ value: folder, label: folder }))];
  const [value, setValue] = useState("value" in props.value ? props.value.value : props.value.path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = t(action === "create-folder" ? "wiki.new_folder" : action === "rename" ? "wiki.rename" : action === "move" ? "wiki.move" : action === "copy" ? "wiki.duplicate" : "wiki.move_to_trash");
  const submit = async () => {
    let operation: WikiEntryOperation;
    if (action === "create-folder") operation = { action, path: value.trim() };
    else if (!source) return;
    else if (action === "trash") operation = { action, path: source.path, baseRevision: source.revision };
    else {
      const name = source.path.split("/").at(-1) ?? source.path;
      if (action === "rename" && (!value.trim() || /[/\\\x00-\x1f\x7f]/.test(value))) throw new Error(t("wiki.invalid_entry_name"));
      const renamed = source.kind === "file" && /\.md$/i.test(source.path) && !/\.md$/i.test(value) ? `${value.trim()}.md` : value.trim();
      const destination = action === "move" ? `${value ? `${value}/` : ""}${name}` : action === "rename" ? `${parent ? `${parent}/` : ""}${renamed}` : value.trim();
      operation = { action: action === "copy" ? "copy" : "move", path: source.path, destination, baseRevision: source.revision };
    }
    await props.onSubmit(operation);
    props.onClose();
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) props.onClose(); }}>
    <DialogContent className="wiki-dialog sm:max-w-md">
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(null); void submit().catch((error) => setError(wikiError(error))).finally(() => setBusy(false)); }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{action === "trash" ? t("wiki.trash_hint") : source?.path ?? t("wiki.new_folder_hint")}</DialogDescription></DialogHeader>
        {action === "trash" ? <p className="break-all text-sm font-medium">{source?.path}</p> : <label className="grid gap-2 text-sm">{t(action === "move" ? "wiki.destination_folder" : action === "rename" ? "wiki.entry_name" : "wiki.relative_path")}
          {action === "move" ? <Select value={value} items={destinations} disabled={busy} onValueChange={(next) => { if (next !== null) setValue(next); }}><SelectTrigger autoFocus className="w-full" aria-label={t("wiki.destination_folder")}><SelectValue /></SelectTrigger><SelectContent>{destinations.map((folder) => <SelectItem key={folder.value} value={folder.value}>{folder.label}</SelectItem>)}</SelectContent></Select>
            : <Input autoFocus required value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} />}
        </label>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={props.onClose}>{t("wiki.cancel")}</Button><Button type="submit" variant={action === "trash" ? "destructive" : "default"} disabled={busy || (action === "move" ? value === parent : action !== "trash" && !value.trim())}>{busy ? <Loader2 size={16} className="animate-spin" /> : null}{title}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function WikiTrashDialog(props: { client: LegalworkServerClient; serverUrl: string; wikiId: string; writable: boolean; onClose: () => void; onRestore: (id: string) => Promise<void> }) {
  const trash = useQuery({ queryKey: ["wiki-trash", props.serverUrl, props.wikiId], queryFn: () => props.client.wikiTrash(props.wikiId) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) props.onClose(); }}>
    <DialogContent className="wiki-dialog sm:max-w-xl">
      <DialogHeader><DialogTitle>{t("wiki.trash")}</DialogTitle><DialogDescription>{t("wiki.trash_hint")}</DialogDescription></DialogHeader>
      <div className="max-h-[55vh] overflow-y-auto">
        {trash.isLoading ? <Loader2 size={18} className="animate-spin" /> : trash.error ? <p role="alert" className="text-sm text-destructive">{wikiError(trash.error)}</p> : !trash.data?.items.length ? <p className="py-5 text-sm text-muted-foreground">{t("wiki.trash_empty")}</p> : trash.data.items.map((entry) => <div key={entry.id} className="flex items-center gap-3 border-b py-3 last:border-b-0"><span className="min-w-0 flex-1 truncate text-sm" title={entry.path}>{entry.path}</span><Button size="sm" variant="outline" disabled={!props.writable || Boolean(busy)} onClick={() => { setBusy(entry.id); setError(null); void props.onRestore(entry.id).then(() => trash.refetch()).catch((error) => setError(wikiError(error))).finally(() => setBusy(null)); }}>{busy === entry.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}{t("wiki.restore")}</Button></div>)}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button variant="ghost" disabled={Boolean(busy)} onClick={props.onClose}>{t("common.close")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

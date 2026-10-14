import { useEffect, useRef, useState, type RefObject } from "react";
import { DocxEditor, type DocxEditorRef } from "@eigenpal/docx-editor-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { compareWordDocuments, combineWordDocuments } from "./docx-comparison";
import { createCleanDocx, downloadDocx } from "./docx-export";
import { decorateWordFields, updateWordFields } from "./docx-fields";
import { useDocxPageFit } from "./use-docx-page-fit";
import { finalizeWordPackage, inspectWordPackage, readWordMetadata, removeWordPrivateData, reviewWordPackage, type InspectionFinding, type InspectionKind, type Protection, type WordMetadata } from "./docx-word-package";

type Props = { name: string; editorRef: RefObject<DocxEditorRef | null>; metadata: WordMetadata; readOnly: boolean; getBuffer: () => Promise<ArrayBuffer | null>; onProtection: (value: Protection) => void; onChanged: () => void };
function ComparisonEditor({ buffer, name, editorRef }: { buffer: ArrayBuffer; name: string; editorRef: RefObject<DocxEditorRef | null> }) {
  const container = useRef<HTMLDivElement>(null);
  useDocxPageFit(container, editorRef, true);
  useEffect(() => {
    let active = true;
    let cleanup = () => {};
    void readWordMetadata(buffer).then((metadata) => {
      if (!active) return;
      const host = container.current;
      const paint = () => { if (host && editorRef.current) decorateWordFields(host, editorRef.current, metadata); };
      host?.addEventListener("painter:painted", paint); paint();
      const timer = setInterval(paint, 500);
      cleanup = () => { host?.removeEventListener("painter:painted", paint); clearInterval(timer); };
    });
    return () => { active = false; cleanup(); };
  }, [buffer, editorRef]);
  return <div ref={container} className="docx-host min-h-0 flex-1 overflow-hidden"><DocxEditor ref={editorRef} documentBuffer={buffer} documentName={name} author="LegalWork" mode="suggesting" showFileOpen={false} showOutlineButton /></div>;
}
export function DocxWordTools({ name, editorRef, metadata, readOnly, getBuffer, onProtection, onChanged }: Props) {
  const [dialog, setDialog] = useState<"compare" | "inspect" | "protect" | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<File[]>([]);
  const [findings, setFindings] = useState<InspectionFinding[]>([]);
  const [selected, setSelected] = useState<InspectionKind[]>(["properties"]);
  const [preview, setPreview] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState("");
  const previewRef = useRef<DocxEditorRef>(null);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const openInspector = () => { setDialog("inspect"); void run(async () => { const buffer = await getBuffer(); if (buffer) setFindings(await inspectWordPackage(buffer)); }); };
  const updateFields = () => void run(async () => {
    if (!editorRef.current) return;
    await updateWordFields(editorRef.current, metadata);
    onChanged(); toast.success(t("docx.word.fields_updated"));
  });
  return <>
    <div className="docx-word-tools flex flex-wrap items-center gap-1 border-b border-border px-3 py-1" role="toolbar" aria-label={t("docx.word.tools")}>
      <Button size="sm" variant="ghost" disabled={readOnly || busy} onClick={updateFields}>{t("docx.word.update_fields")}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDialog("compare"); setPreview(null); setError(""); }}>{t("docx.word.compare")}</Button>
      <Button size="sm" variant="ghost" disabled={readOnly || busy} onClick={() => { setDialog("protect"); setError(""); }}>{t("docx.word.protect")}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={openInspector}>{t("docx.word.inspect")}</Button>
      {metadata.protection.mode !== "none" && <span className="px-2 text-xs text-muted-foreground">{t(`docx.word.protection_${metadata.protection.mode}`)}</span>}
    </div>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}>
      <DialogContent className={preview ? "flex h-[90vh] w-[95vw] max-w-[95vw] flex-col sm:max-w-[95vw]" : "max-w-lg sm:max-w-lg"}>
        <DialogHeader><DialogTitle>{t(dialog === "compare" ? "docx.word.compare" : dialog === "protect" ? "docx.word.protect" : "docx.word.inspect")}</DialogTitle>
          <DialogDescription>{t(dialog === "compare" ? "docx.word.compare_description" : dialog === "protect" ? "docx.word.protect_description" : "docx.word.inspect_description")}</DialogDescription>
        </DialogHeader>
        {dialog === "compare" && !preview && <>
          <p>{t("docx.word.original")}: {name}</p>
          <label className="grid gap-2">{t("docx.word.returned_drafts")}<input type="file" accept=".docx" multiple onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            const valid = files.every((file) => /\.docx$/i.test(file.name));
            setDrafts(valid ? files : []); setError(valid ? "" : t("docx.word.invalid_file"));
          }} /></label>
          <p className="text-xs text-muted-foreground">{t("docx.word.compare_baseline")}</p>
          <Button disabled={busy || !drafts.length} onClick={() => void run(async () => {
            const buffer = await getBuffer(); if (!buffer) return;
            const versions = await Promise.all(drafts.map(async (file) => ({ buffer: await file.arrayBuffer(), author: file.name.replace(/\.docx$/i, "") })));
            setPreview(versions.length === 1 ? await compareWordDocuments(buffer, versions[0].buffer, versions[0].author) : await combineWordDocuments(buffer, versions));
          })}>{t(drafts.length > 1 ? "docx.word.combine" : "docx.word.create_comparison")}</Button>
        </>}
        {preview && <>
          <div className="flex gap-2">{(["accept", "reject"] satisfies ("accept" | "reject")[]).map((decision) => <Button key={decision} size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
            const buffer = await previewRef.current?.save({ selective: false });
            if (!buffer) return;
            const reviewed = await finalizeWordPackage(await reviewWordPackage(buffer, decision), await readWordMetadata(preview));
            await previewRef.current?.loadDocumentBuffer(reviewed);
            setPreview(reviewed);
          })}>{t(`docx.word.${decision}_all`)}</Button>)}</div>
          <ComparisonEditor buffer={preview} editorRef={previewRef} name={name.replace(/\.docx$/i, "") + "_comparison.docx"} />
          <Button disabled={busy} onClick={() => void run(async () => {
            const buffer = await previewRef.current?.save({ selective: false });
            if (buffer) downloadDocx(await finalizeWordPackage(buffer, await readWordMetadata(preview)), name.replace(/\.docx$/i, "") + "_comparison.docx");
          })}>{t("docx.word.download_comparison")}</Button>
        </>}
        {dialog === "protect" && <>
          {metadata.protection.password ? <p>{t("docx.word.password_protected")}</p> : <div className="grid gap-2">
            {(["none", "forms", "trackedChanges"] satisfies Protection["mode"][]).map((mode) => <Button key={mode} variant={metadata.protection.mode === mode ? "default" : "outline"} onClick={() => { onProtection({ mode, password: false }); setDialog(null); }}>{t(`docx.word.protection_${mode}`)}</Button>)}
          </div>}
        </>}
        {dialog === "inspect" && <>
          {!busy && !findings.length && <p>{t("docx.word.nothing_found")}</p>}
          {findings.map((finding) => <label className="flex items-center gap-2" key={finding.kind}>
            <input type="checkbox" disabled={finding.kind === "externalLinks" || busy} checked={selected.includes(finding.kind)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, finding.kind] : value.filter((kind) => kind !== finding.kind))} />
            {t(`docx.word.inspection_${finding.kind}`)} ({finding.count})
          </label>)}
          <Button disabled={busy || !selected.some((kind) => findings.some((finding) => finding.kind === kind))} onClick={() => void run(async () => {
            const buffer = await getBuffer(); if (!buffer) return;
            const clean = selected.includes("revisions") || selected.includes("comments") ? await createCleanDocx(buffer, { acceptChanges: selected.includes("revisions"), removeComments: selected.includes("comments") }) : buffer;
            const result = await removeWordPrivateData(clean, selected);
            const remaining = await inspectWordPackage(result);
            if (remaining.some((finding) => selected.includes(finding.kind))) throw new Error(t("docx.word.inspection_incomplete"));
            downloadDocx(result, name.replace(/\.docx$/i, "") + "_clean.docx");
            toast.success(t("docx.word.clean_downloaded"));
          })}>{t("docx.word.download_clean")}</Button>
        </>}
        {busy && <p role="status">{t("docx.word.working")}</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}

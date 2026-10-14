/** @jsxImportSource react */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { DocxEditor, type DocxEditorRef, type EditorMode } from "@eigenpal/docx-editor-react";
import { DocxReviewer } from "@eigenpal/docx-editor-agents";
import { useDocxAgentTools } from "@eigenpal/docx-editor-agents/react";
import { setGoogleFontsEnabled } from "@eigenpal/docx-editor-core";
import { headerFooterToProseDoc } from "@eigenpal/docx-editor-core/prosemirror/conversion";
import { acceptChangeById, rejectChangeById } from "@eigenpal/docx-editor-core/prosemirror/commands";
import { extractTrackedChanges } from "@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges";
import { createSuggestionModePlugin, setSuggestionMode, suggestionModeKey } from "@eigenpal/docx-editor-core/prosemirror/plugins";
import "@eigenpal/docx-editor-react/styles.css";
import "./office-fonts.css";

import { getInitialThemeMode, subscribeToTheme, type ThemeMode } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { loadFontsFromGoogle, rememberFontDecision, unresolvedDocumentFonts } from "./docx-font-consent";
import { keepDocxVersion, readDocxRecovery, removeDocxRecovery, writeDocxRecovery, type DocxRecovery } from "./docx-recovery";
import { useDocxPageFit } from "./use-docx-page-fit";
import { useDocxReviewCard } from "./use-docx-review-card";
import "./docx-editor-layout.css";
import { useControlActions } from "../../../shell/control/control-provider";
import { t } from "@/i18n";
import { createWordProtectionPlugin } from "./docx-protection";
import { decorateWordFields, navigateWordNote, updateWordFields } from "./docx-fields";
import { emptyWordMetadata, finalizeWordPackage, inspectWordPackage, readWordMetadata, removeWordPrivateData, type InspectionKind, type Protection } from "./docx-word-package";
import { executeWordStructureTool, readWordStructure, WORD_STRUCTURE_MUTATIONS } from "./docx-agent-structure";
import { applyWordFormatting, preserveWordFormatting, readWordFormatting } from "./docx-agent-formatting";
import { compareWordDocuments, combineWordDocuments } from "./docx-comparison";
import { DocxWordTools } from "./docx-word-tools";
import { createCleanDocx, downloadDocx } from "./docx-export";

// The editor otherwise injects a fonts.googleapis.com stylesheet for any font a
// document names that isn't installed locally — which would tell Google the
// typefaces used in a client's file. office-fonts.css bundles the substitutes
// it used to fetch, so nothing is disclosed and nothing changes about how a
// document renders. Calibri, Cambria, Arial, Helvetica, Times New Roman and
// Courier New keep Word's pagination, being metric compatible; the other
// families are look-alikes and can re-wrap. Page-global, so it is set once at
// import, before any document.
setGoogleFontsEnabled(false);

export type DocxEditorApi = {
  /** Serialize and persist the current document. Never clears edits made during a save. */
  save: () => Promise<boolean>;
  /** Serialize the live draft without writing to the workspace or clearing its dirty state. */
  getBuffer: () => Promise<ArrayBuffer | null>;
  executeAgentTool: (toolName: string, args: Record<string, unknown>) => Promise<DocxEditorToolResult>;
  discardRecovery: () => void;
};

export type DocxEditorToolResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  saved?: boolean;
};

type ArtifactDocxEditorProps = {
  name: string;
  /** Captured on mount. The panel controls when a different disk revision is loaded. */
  content: ArrayBuffer;
  author?: string;
  readOnly?: boolean;
  onSave?: (buffer: ArrayBuffer) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  apiRef?: RefObject<DocxEditorApi | null>;
  recoveryKey?: string;
  baseUpdatedAt?: number | null;
  onRestore?: (baseUpdatedAt: number | null) => void;
};

const AUTHOR_KEY = "legalwork.docx.reviewer";
let documentInstance = 0;
// Eigenpal's File > Save exports a download, even when onSave is supplied.
// Name that action accurately; the panel Save button / Cmd+S persist to the workspace.
// Read lazily: a module-scope t() would freeze the English label at import,
// before initLocale() picks the language.
const EDITOR_LABELS = {
  toolbar: {
    get save() {
      return t("artifact.download_copy");
    },
    saveShortcut: "",
  },
};

const REVIEW_TOOL_NAMES = new Set(["accept_changes", "reject_changes"]);
const SDK_MUTATIONS = new Set(["suggest_change", "add_comment", "reply_comment", "resolve_comment", "apply_formatting", "set_paragraph_style", "insert_break"]);
const COPY_TOOLS = new Set(["create_clean_copy", "create_comparison_copy"]);

function encodeWordCopy(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

function requestedChangeIds(args: Record<string, unknown>): number[] | null {
  if (!Array.isArray(args.changeIds)) return null;
  const ids = args.changeIds.filter(
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0,
  );
  return ids.length === args.changeIds.length && ids.length > 0 ? [...new Set(ids)] : null;
}

function decideTrackedChanges(
  editor: DocxEditorRef | null,
  decision: "accept" | "reject",
  requestedIds: number[],
): DocxEditorToolResult {
  const view = editor?.getEditorRef()?.getView();
  if (!view) return { success: false, error: t("docx.editor_not_ready") };

  const { entries } = extractTrackedChanges(view.state);
  const ids = new Set<number>();
  for (const requestedId of requestedIds) {
    const entry = entries.find((candidate) => (
      Number(candidate.revisionId) === requestedId
      || Number(candidate.insertionRevisionId) === requestedId
      || candidate.coalescedRevisionIds?.some((id) => Number(id) === requestedId)
    ));
    if (!entry) {
      ids.add(requestedId);
      continue;
    }
    ids.add(Number(entry.revisionId));
    if (entry.insertionRevisionId !== undefined) ids.add(Number(entry.insertionRevisionId));
    entry.coalescedRevisionIds?.forEach((id) => ids.add(Number(id)));
  }

  const command = decision === "accept" ? acceptChangeById : rejectChangeById;
  let applied = 0;
  for (const id of ids) {
    if (command(id)(view.state, view.dispatch)) applied += 1;
  }
  if (applied === 0) {
    return { success: false, error: t("docx.unknown_change_ids") };
  }
  const verb = decision === "accept" ? "Accepted" : "Rejected";
  return { success: true, data: `${verb} ${applied} tracked-change revision${applied === 1 ? "" : "s"}.` };
}

function useThemeColorMode(): ThemeMode {
  return useSyncExternalStore(subscribeToTheme, getInitialThemeMode, getInitialThemeMode);
}

export function ArtifactDocxEditor(props: ArtifactDocxEditorProps) {
  const [recovery, setRecovery] = useState<DocxRecovery | null>(null);
  const [checked, setChecked] = useState(Boolean(!props.recoveryKey || props.readOnly));
  const [restored, setRestored] = useState<DocxRecovery | null>(null);
  useEffect(() => {
    if (!props.recoveryKey || props.readOnly) { setChecked(true); return; }
    let active = true;
    void readDocxRecovery(props.recoveryKey).then((draft) => {
      if (active) { setRecovery(draft); setChecked(true); }
    }).catch(() => {
      if (active) { setChecked(true); toast.error(t("docx.recovery_unavailable")); }
    });
    return () => { active = false; };
  }, [props.recoveryKey, props.readOnly]);
  if (!checked) return <div className="p-6 text-sm" role="status">{t("docx.checking_draft")}</div>;
  if (recovery) return <div className="space-y-4 p-6">
    <h3 className="font-medium">{t("docx.recover_prompt")}</h3>
    <p className="text-sm text-muted-foreground">A draft of {props.name} was kept on this device at {new Date(recovery.savedAt).toLocaleString()}. Restoring it does not overwrite the workspace file.</p>
    {recovery.baseUpdatedAt !== props.baseUpdatedAt && <p className="text-sm">{t("docx.recover_body")}</p>}
    <div className="flex gap-2">
      <Button onClick={() => { props.onRestore?.(recovery.baseUpdatedAt); setRestored(recovery); setRecovery(null); }}>{t("docx.recover_draft")}</Button>
      <Button variant="outline" onClick={() => {
        void removeDocxRecovery(recovery.key).then(() => setRecovery(null)).catch(() => toast.error(t("docx.discard_recovery_failed")));
      }}>{t("docx.discard_and_open")}</Button>
    </div>
  </div>;
  return <LiveDocxEditor {...props} content={restored?.buffer ?? props.content} recovered={!!restored} />;
}

function LiveDocxEditor({ name, content, author, readOnly = false, onSave, onDirtyChange, apiRef, recoveryKey, baseUpdatedAt = null, recovered }: ArtifactDocxEditorProps & { recovered: boolean }) {
  const colorMode = useThemeColorMode();
  const [documentBuffer] = useState(() => content.slice(0));
  const [documentId] = useState(() => `${Date.now()}:${++documentInstance}`);
  const [mode, setMode] = useState<EditorMode>("editing");
  const [wordMetadata, setWordMetadata] = useState(emptyWordMetadata);
  const metadataRef = useRef(wordMetadata);
  const [metadataReady, setMetadataReady] = useState(false);
  const [metadataError, setMetadataError] = useState("");
  useEffect(() => {
    let active = true;
    void readWordMetadata(documentBuffer).then((metadata) => {
      if (!active) return;
      metadataRef.current = metadata;
      setWordMetadata(metadata);
      if (metadata.protection.mode === "trackedChanges") setMode("suggesting");
      setMetadataReady(true);
    }).catch((error) => { if (active) setMetadataError(String(error)); });
    return () => { active = false; };
  }, [documentBuffer]);
  const [protectionPlugin] = useState(() => createWordProtectionPlugin(() => metadataRef.current.protection, () => toast.error(t("docx.word.edit_blocked"))));
  const [wordPlugins] = useState(() => [protectionPlugin]);
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(recovered);
  const checkpoint = useRef<() => Promise<void>>(async () => {});
  const checkpointed = useRef<{ revision: number; base: number | null } | null>(null);
  const [reviewer] = useState(() => {
    if (author) return author;
    try { return window.localStorage.getItem(AUTHOR_KEY) ?? ""; } catch { return ""; }
  });
  const editorRef = useRef<DocxEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [missingFonts, setMissingFonts] = useState<string[]>([]);
  const fitPage = useDocxPageFit(containerRef, editorRef, commentsOpen);
  const onReviewClick = useDocxReviewCard(containerRef, editorRef);
  const recoveryFailed = useRef(false);
  const { executeToolCall } = useDocxAgentTools({ editorRef, author: "LegalWork AI" });
  const revision = useRef(0);
  const ready = useRef(false);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const serialization = useRef<Promise<ArrayBuffer | null> | null>(null);
  const lastDocument = useRef<ReturnType<DocxEditorRef["getDocument"]>>(null);
  const lastPaintedLayout = useRef<ReturnType<NonNullable<ReturnType<DocxEditorRef["getEditorRef"]>>["getLayout"]>>(null);

  const markDirty = useCallback(() => {
    if (readOnly || !ready.current) return;
    revision.current += 1;
    dirty.current = true;
    onDirtyChange?.(true);
    if (recoveryKey) {
      if (checkpointTimer.current) clearTimeout(checkpointTimer.current);
      checkpointTimer.current = setTimeout(() => { void checkpoint.current(); }, 1000);
    }
  }, [readOnly, onDirtyChange, recoveryKey]);

  // Ask before fetching a font the document needs and this machine lacks — the
  // one case office-fonts.css cannot cover locally. Runs once the editor has
  // rendered, so canRenderFont() sees the faces the document embedded.
  const askAboutFonts = useCallback(() => {
    void unresolvedDocumentFonts(documentBuffer)
      .then((families) => { if (families.length > 0) setMissingFonts(families); })
      .catch(() => {});
  }, [documentBuffer]);

  const fontsUnavailable = useCallback((families: string[]) => {
    // Say so rather than leaving a pressed button looking like it did nothing.
    // Remember the answer too, so the same dead end is not offered again — but
    // not when this machine was simply offline, where a later open can still
    // succeed.
    if (navigator.onLine !== false) rememberFontDecision(families, false);
    toast.error(t("docx.font_download_failed", { count: families.length, fonts: families.join(", ") }));
  }, []);

  const resolveFonts = useCallback((allowed: boolean) => {
    const families = missingFonts;
    setMissingFonts([]);
    if (!allowed) {
      rememberFontDecision(families, false);
      return;
    }
    void loadFontsFromGoogle(families)
      .then((failed) => {
        fitPage();
        rememberFontDecision(families.filter((family) => !failed.includes(family)), true);
        if (failed.length > 0) fontsUnavailable(failed);
      })
      .catch(() => fontsUnavailable(families));
  }, [missingFonts, fitPage, fontsUnavailable]);

  const checkDocument = useCallback(() => {
    const editor = editorRef.current;
    const layout = editor?.getEditorRef()?.getLayout() ?? null;
    if (editor && containerRef.current && layout && layout !== lastPaintedLayout.current && decorateWordFields(containerRef.current, editor, metadataRef.current)) lastPaintedLayout.current = layout;
    const document = editorRef.current?.getDocument();
    if (!document || document === lastDocument.current) return;
    const hadDocument = lastDocument.current !== null;
    lastDocument.current = document;
    if (hadDocument) markDirty();
  }, [markDirty]);

  // The pinned adapter omits onChange for some header/footer and property-dialog
  // edits. Its immutable document reference covers those paths without serializing
  // or traversing a large contract on every keystroke. Check synchronously before save too.
  useEffect(() => {
    const timer = window.setInterval(checkDocument, 250);
    return () => window.clearInterval(timer);
  }, [checkDocument]);

  const getBuffer = useCallback(async () => {
    const serialize = async () => {
      const editor = editorRef.current; const doc = editor?.getEditorRef()?.getView()?.state.doc; const document = editor?.getDocument();
      const buffer = await editorRef.current?.save({ selective: false });
      return buffer ? await finalizeWordPackage(doc && document ? await preserveWordFormatting(buffer, doc, document) : buffer, metadataRef.current) : null;
    };
    const operation = serialization.current ? serialization.current.catch(() => null).then(serialize) : serialize();
    serialization.current = operation;
    try { return await operation; } finally { if (serialization.current === operation) serialization.current = null; }
  }, []);

  const syncTracking = (active: boolean) => {
    const paged = editorRef.current?.getEditorRef();
    const body = paged?.getView();
    if (body) setSuggestionMode(active, body.state, body.dispatch, reviewer.trim() || "LegalWork");
    for (const view of paged?.getHfPmViews().values() ?? []) {
      if (!suggestionModeKey.getState(view.state) && metadataRef.current.protection.mode === "trackedChanges") view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, createSuggestionModePlugin(active, reviewer.trim() || "LegalWork")] }));
      if (suggestionModeKey.getState(view.state)) setSuggestionMode(active, view.state, view.dispatch, reviewer.trim() || "LegalWork");
    }
  };
  const changeProtection = (protection: Protection) => {
    const metadata = { ...metadataRef.current, protection };
    metadataRef.current = metadata; setWordMetadata(metadata);
    if (protection.mode === "trackedChanges") { setMode("suggesting"); syncTracking(true); }
    markDirty();
  };
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const editor = editorRef.current;
        if (!editor) return;
        for (const view of editor.getEditorRef()?.getHfPmViews().values() ?? []) if (!view.state.plugins.includes(protectionPlugin)) {
          const tracking = suggestionModeKey.getState(view.state) || metadataRef.current.protection.mode !== "trackedChanges" ? [] : [createSuggestionModePlugin(true, reviewer.trim() || "LegalWork")];
          view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, ...tracking, protectionPlugin] }));
        }
        decorateWordFields(host, editor, metadataRef.current);
      });
    };
    host.addEventListener("painter:painted", paint);
    paint();
    return () => { host.removeEventListener("painter:painted", paint); cancelAnimationFrame(frame); };
  }, [metadataReady, protectionPlugin]);

  const navigateReference = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const download = target.closest('[role="menuitem"]');
    if (download?.textContent?.trim() === t("artifact.download_copy")) {
      event.preventDefault(); event.stopPropagation();
      void getBuffer().then((buffer) => { if (buffer) downloadDocx(buffer, name); }).catch((error) => toast.error(String(error)));
      return;
    }
    const bookmark = target.closest<HTMLElement>("[data-word-bookmark]")?.dataset.wordBookmark;
    if (!bookmark) { onReviewClick(event); return; }
    const view = editorRef.current?.getEditorRef()?.getView();
    let position: number | undefined;
    view?.state.doc.descendants((node, pos) => {
      if (Array.isArray(node.attrs.bookmarks) && node.attrs.bookmarks.some((mark) => mark.name === bookmark)) position ??= pos;
    });
    if (position !== undefined) { event.preventDefault(); event.stopPropagation(); editorRef.current?.highlightRange(position + 1, position + 1); }
  };

  checkpoint.current = async () => {
    if (!recoveryKey || !dirty.current || readOnly) return;
    const checkpointRevision = revision.current;
    if (checkpointed.current?.revision === checkpointRevision && checkpointed.current.base === baseUpdatedAt) return;
    try {
      const buffer = await getBuffer();
      if (!buffer || !dirty.current || checkpointRevision !== revision.current) return;
      await writeDocxRecovery({ key: recoveryKey, buffer, baseUpdatedAt, savedAt: Date.now() });
      checkpointed.current = { revision: checkpointRevision, base: baseUpdatedAt };
      recoveryFailed.current = false;
    } catch {
      if (!recoveryFailed.current) toast.error(t("docx.recovery_unavailable_save"));
      recoveryFailed.current = true;
    }
  };

  useLayoutEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") void checkpoint.current(); };
    const timer = setInterval(() => { void checkpoint.current(); }, 5000);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      clearInterval(timer);
      if (checkpointTimer.current) clearTimeout(checkpointTimer.current);
      void checkpoint.current();
    };
  }, []);

  const save = useCallback((): Promise<boolean> => {
    if (pendingSave.current) return pendingSave.current;
    if (readOnly || !onSave) return Promise.resolve(false);
    checkDocument();
    const savingRevision = revision.current;
    const operation = (async () => {
      const buffer = await getBuffer();
      if (!buffer) return false;
      await onSave(buffer);
      if (recoveryKey) void keepDocxVersion(recoveryKey, buffer.slice(0)).catch(() => toast.error(t("docx.saved_no_history")));
      checkDocument();
      if (revision.current === savingRevision) {
        dirty.current = false;
        onDirtyChange?.(false);
        if (recoveryKey) await removeDocxRecovery(recoveryKey).catch(() => toast.error(t("docx.saved_recovery_not_cleared")));
      }
      return true;
    })();
    pendingSave.current = operation.finally(() => { pendingSave.current = null; });
    return pendingSave.current;
  }, [readOnly, onSave, checkDocument, getBuffer, onDirtyChange, recoveryKey]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { save, getBuffer,
      executeAgentTool: async (toolName, args) => {
        if (!ready.current) return { success: false, error: t("docx.editor_not_ready") };
        checkDocument();
        const mutatesStructure = WORD_STRUCTURE_MUTATIONS.has(toolName) || ["apply_formatting", "update_fields", "set_page_numbering", "set_protection", "set_paragraph_style", "insert_break", "save_document"].includes(toolName);
        const mutatesDocument = SDK_MUTATIONS.has(toolName) || REVIEW_TOOL_NAMES.has(toolName) || mutatesStructure;
        if (readOnly && mutatesDocument) return { success: false, error: t("docx.read_only") };
        if ((mutatesStructure || COPY_TOOLS.has(toolName)) && (args.documentId !== documentId || args.draftRevision !== revision.current)) return { success: false, error: t("docx.read_draft_again") };
        const editor = editorRef.current; const view = editor?.getEditorRef()?.getView(); const document = editor?.getDocument();
        if (!editor || !view || !document) return { success: false, error: t("docx.editor_not_ready") };
        const structure = () => {
          const current = editor.getDocument() ?? document;
          const hfViews = editor.getEditorRef()?.getHfPmViews();
          const stories = new Map([...current.package.headers ?? [], ...current.package.footers ?? []]);
          return { documentId, draftRevision: revision.current, editorEditable: !readOnly, ...readWordStructure(view.state.doc, current, editor.getEditorRef()?.getLayout() ?? null, metadataRef.current), headerFooterFields: Array.from(stories).flatMap(([rid, story]) => readWordStructure(hfViews?.get(rid)?.state.doc ?? headerFooterToProseDoc(story.content, { styles: current.package.styles }), current, null, metadataRef.current, rid, view.state.doc, false).fields) };
        };
        if (toolName === "read_structure") return { success: true, data: structure() };
        if (toolName === "read_formatting") {
          try { return { success: true, data: { documentId, draftRevision: revision.current, editorEditable: !readOnly, ...readWordFormatting(view.state.doc, document, args) } }; }
          catch (cause) { return { success: false, error: cause instanceof Error ? cause.message : String(cause) }; }
        }
        if (toolName === "save_document") {
          try { const saved = await save(); return saved && !dirty.current ? { success: true, saved: true, data: { documentId, draftRevision: revision.current } } : { success: false, saved: false, error: t("docx.changed_not_saved") }; }
          catch (cause) { return { success: false, saved: false, error: `${t("docx.changed_not_saved")} ${cause instanceof Error ? cause.message : String(cause)}` }; }
        }
        if (toolName === "inspect_document") {
          const draftRevision = revision.current; const buffer = await getBuffer();
          if (!buffer || draftRevision !== revision.current) return { success: false, error: t("docx.read_draft_again") };
          return { success: true, data: { documentId, draftRevision, findings: await inspectWordPackage(buffer) } };
        }
        if (COPY_TOOLS.has(toolName)) {
          try {
            const draftRevision = revision.current; const buffer = await getBuffer();
            if (!buffer || draftRevision !== revision.current) return { success: false, error: t("docx.read_draft_again") };
            let copy: ArrayBuffer;
            if (toolName === "create_clean_copy") {
              const categories = args.categories;
              const selected: InspectionKind[] = [];
              if (!Array.isArray(categories) || !categories.length) throw new Error("Select inspection categories explicitly.");
              for (const kind of categories) {
                if (kind !== "properties" && kind !== "hiddenText" && kind !== "customXml" && kind !== "comments" && kind !== "revisions") throw new Error("Unsupported inspection category.");
                selected.push(kind);
              }
              const clean = selected.includes("revisions") || selected.includes("comments") ? await createCleanDocx(buffer, { acceptChanges: selected.includes("revisions"), removeComments: selected.includes("comments") }) : buffer;
              copy = await removeWordPrivateData(clean, selected);
              if ((await inspectWordPackage(copy)).some((finding) => selected.includes(finding.kind))) throw new Error(t("docx.word.inspection_incomplete"));
            } else {
              if (!Array.isArray(args.versions) || !args.versions.length || args.versions.length > 8) throw new Error("Provide between one and eight returned drafts.");
              const versions = args.versions.map((version: unknown) => {
                if (!version || typeof version !== "object" || !("base64" in version) || typeof version.base64 !== "string" || version.base64.length > 40_000_000 || !("author" in version) || typeof version.author !== "string") throw new Error("Invalid returned draft.");
                return { buffer: Uint8Array.from(atob(version.base64), (char) => char.charCodeAt(0)).buffer, author: version.author };
              });
              copy = versions.length === 1 ? await compareWordDocuments(buffer, versions[0].buffer, versions[0].author) : await combineWordDocuments(buffer, versions);
            }
            if (draftRevision !== revision.current) return { success: false, error: t("docx.read_draft_again") };
            const reviewer = await DocxReviewer.fromBuffer(copy);
            return { success: true, data: { bufferBase64: encodeWordCopy(copy), changes: reviewer.getChanges(), findings: await inspectWordPackage(copy), sourceChanged: false } };
          } catch (cause) { return { success: false, error: cause instanceof Error ? cause.message : String(cause) }; }
        }
        const isReviewDecision = REVIEW_TOOL_NAMES.has(toolName);
        if (isReviewDecision && metadataRef.current.protection.mode === "trackedChanges") return { success: false, error: t("docx.word.edit_blocked") };
        const before = view.state.doc;
        let result: DocxEditorToolResult;
        try {
          if (WORD_STRUCTURE_MUTATIONS.has(toolName)) {
            result = executeWordStructureTool({ view, document, layout: editor.getEditorRef()?.getLayout() ?? null, metadata: metadataRef.current, loadDocument: (document) => editor.loadDocument(document) }, toolName, args);
            if (toolName === "edit_note" || toolName === "insert_note") await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          } else if (toolName === "apply_formatting") {
            result = applyWordFormatting({ view, document, layout: editor.getEditorRef()?.getLayout() ?? null, metadata: metadataRef.current, loadDocument: (document) => editor.loadDocument(document) }, args);
            // React publishes its new getDocument handle on the following render.
            // Saving before that can mistake that publication for a concurrent edit.
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          } else if (toolName === "update_fields") {
            result = { success: true, data: { updated: await updateWordFields(editor, metadataRef.current) } };
          } else if (toolName === "set_protection") {
            const mode = args.mode;
            if (metadataRef.current.protection.password || mode !== "none" && mode !== "forms" && mode !== "trackedChanges") return { success: false, error: "Password protection cannot be changed by this tool, or the mode is unsupported." };
            changeProtection({ mode, password: false });
            result = { success: true, data: { protection: metadataRef.current.protection } };
          } else if (toolName === "set_page_numbering") {
            if (metadataRef.current.protection.mode !== "none") return { success: false, error: t("docx.word.edit_blocked") };
            const index = args.sectionIndex; const format = args.format; const start = args.start;
            if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= metadataRef.current.pages.length || typeof format !== "string" || !["decimal", "decimalZero", "upperRoman", "lowerRoman", "upperLetter", "lowerLetter"].includes(format) || start !== undefined && start !== null && (typeof start !== "number" || !Number.isInteger(start) || start < 1 || start > 32767)) return { success: false, error: "Invalid section index, page format or restart number." };
            const metadata = { ...metadataRef.current, pages: metadataRef.current.pages.map((rule, i) => i === index ? { format, ...(typeof start === "number" ? { start } : {}) } : rule) };
            metadataRef.current = metadata; setWordMetadata(metadata);
            await updateWordFields(editor, metadata);
            result = { success: true, data: { sections: metadata.pages, tracked: false } };
          } else if (isReviewDecision) {
            const changeIds = requestedChangeIds(args);
            if (!changeIds) {
              return { success: false, error: t("docx.change_ids_required") };
            }
            result = decideTrackedChanges(
              editorRef.current,
              toolName === "accept_changes" ? "accept" : "reject",
              changeIds,
            );
          } else {
            result = executeToolCall(toolName, args);
            if (result.success && toolName === "insert_break" && args.type !== "page") {
              let target = -1; let section = 0;
              before.descendants((node, pos) => { if (node.attrs.paraId === args.paraId) target = pos; });
              before.descendants((node, pos) => { if (pos < target && node.attrs.sectionBreakType) section++; });
              const pages = [...metadataRef.current.pages];
              pages.splice(section + 1, 0, { format: pages[section]?.format ?? "decimal" });
              const metadata = { ...metadataRef.current, pages }; metadataRef.current = metadata; setWordMetadata(metadata);
            }
          }
        } catch (cause) { return { success: false, error: cause instanceof Error ? cause.message : String(cause) }; }
        if (!result.success) return result;
        if ((toolName === "suggest_change" || ["set_paragraph_style", "insert_break"].includes(toolName) || isReviewDecision) && before === editorRef.current?.getEditorRef()?.getView()?.state.doc) return { success: false, error: t("docx.word.edit_blocked") };
        if (toolName === "read_document") return { ...result, data: { text: result.data, structure: structure(), formatting: readWordFormatting(view.state.doc, document, { fromIndex: args.fromIndex, limit: typeof args.toIndex === "number" ? Math.min(50, Math.max(1, args.toIndex - Number(args.fromIndex ?? 0) + 1)) : 20 }), comments: editor.getComments(), changes: executeToolCall("read_changes", {}).data } };
        if (!mutatesDocument) return result;
        markDirty();
        let saved: boolean;
        try { saved = await save(); }
        catch (cause) { return { success: false, saved: false, data: { applied: true, documentId, draftRevision: revision.current }, error: `${t("docx.changed_not_saved")} ${cause instanceof Error ? cause.message : String(cause)}` }; }
        if (!saved || dirty.current) return { success: false, saved: false, data: { applied: true, documentId, draftRevision: revision.current }, error: t("docx.changed_not_saved") };
        return { ...result, data: { result: result.data, documentId, draftRevision: revision.current }, saved: true };
      },
    discardRecovery: () => {
      dirty.current = false;
      onDirtyChange?.(false);
      if (recoveryKey) void removeDocxRecovery(recoveryKey).catch(() => toast.error(t("docx.recovery_not_cleared")));
    } };
    return () => { apiRef.current = null; };
  }, [apiRef, save, getBuffer, onDirtyChange, recoveryKey, executeToolCall, markDirty, readOnly, documentId, checkDocument]);

  useControlActions([
    {
      id: "document.read_draft", label: "Read the open document draft", sideEffect: "none",
      description: "Read the live DOCX, including unsaved edits, paragraph handles, comments and redlines. Use this instead of reading the older workspace file.",
      execute: async () => {
        const draftRevision = revision.current;
        const buffer = await getBuffer();
        if (!buffer) throw new Error(t("docx.still_loading"));
        const draft = await DocxReviewer.fromBuffer(buffer);
        if (draftRevision !== revision.current) throw new Error(t("docx.draft_changed_while_reading"));
        const editor = editorRef.current; const view = editor?.getEditorRef()?.getView(); const document = editor?.getDocument();
        return { name, documentId, draftRevision, text: draft.getContentAsText(), comments: draft.getComments(), changes: draft.getChanges(), structure: view && document ? readWordStructure(view.state.doc, document, editor?.getEditorRef()?.getLayout() ?? null, metadataRef.current) : null };
      },
    },
    {
      id: "document.propose_change", label: "Propose a change in the open document", sideEffect: "mutation", disabled: readOnly,
      description: "Apply a tracked proposal to the current draft. Requires name, documentId and draftRevision from document.read_draft. The lawyer reviews it with Accept/Reject; it is not saved automatically.",
      requiresArgs: true,
      args: [{ name: "name", type: "string", required: true }, { name: "documentId", type: "string", required: true }, { name: "draftRevision", type: "number", required: true }, { name: "paraId", type: "string", required: true }, { name: "search", type: "string", required: true }, { name: "replaceWith", type: "string", required: true }],
      execute: (args) => {
        if (readOnly) throw new Error(t("docx.read_only"));
        if (!args || typeof args !== "object" || !("name" in args) || args.name !== name ||
          !("documentId" in args) || args.documentId !== documentId ||
          !("draftRevision" in args) || args.draftRevision !== revision.current ||
          !("paraId" in args) || typeof args.paraId !== "string" ||
          !("search" in args) || typeof args.search !== "string" ||
          !("replaceWith" in args) || typeof args.replaceWith !== "string") throw new Error(t("docx.read_draft_again"));
        const before = editorRef.current?.getEditorRef()?.getView()?.state.doc;
        const applied = editorRef.current?.proposeChange({ paraId: args.paraId, search: args.search, replaceWith: args.replaceWith, author: "LegalWork AI" });
        if (!applied) throw new Error(t("docx.target_ambiguous"));
        if (before === editorRef.current?.getEditorRef()?.getView()?.state.doc) throw new Error(t("docx.word.edit_blocked"));
        markDirty();
        return { applied: true, saved: false, draftRevision: revision.current };
      },
    },
  ]);

  return (
    <div ref={containerRef} className="docx-host flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden" onClickCapture={navigateReference} onDoubleClickCapture={(event) => {
      if (event.target instanceof Element && editorRef.current && containerRef.current && navigateWordNote(event.target, containerRef.current, editorRef.current)) { event.preventDefault(); event.stopPropagation(); }
    }} onKeyDownCapture={(event) => {
      if (event.key === "Enter" && event.target instanceof HTMLElement && event.target.getAttribute("role") === "link") {
        if (event.target.dataset.wordBookmark) event.target.click();
        else if (editorRef.current && containerRef.current) navigateWordNote(event.target, containerRef.current, editorRef.current);
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s" || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (readOnly) return;
      void save().then((saved) => {
        if (!saved) toast.error(t("docx.save_failed_draft_open"));
      }).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t("docx.save_failed_draft_open"));
      });
    }}>
      {metadataReady && <DocxWordTools name={name} editorRef={editorRef} metadata={wordMetadata} readOnly={readOnly} getBuffer={getBuffer} onProtection={changeProtection} onChanged={markDirty} />}
      <div className="min-h-0 min-w-0 flex-1">
        {!metadataReady ? <p role="status" className="p-4">{metadataError || t("docx.word.working")}</p> : <DocxEditor
          ref={editorRef}
          documentBuffer={documentBuffer}
          documentName={name}
          documentNameEditable={false}
          author={reviewer.trim() || "LegalWork"}
          readOnly={readOnly || wordMetadata.protection.mode === "readOnly"}
          mode={readOnly || wordMetadata.protection.mode === "readOnly" ? "viewing" : mode}
          onModeChange={(value) => {
            const next = wordMetadata.protection.mode === "trackedChanges" ? "suggesting" : value;
            setMode(next); syncTracking(next === "suggesting");
          }}
          externalPlugins={wordPlugins}
          commentsSidebarOpen={commentsOpen}
          onCommentsSidebarOpenChange={setCommentsOpen}
          onFontsLoaded={fitPage}
          colorMode={colorMode}
          showFileOpen={false}
          showHelpMenu
          showOutlineButton
          showRuler={false}
          rulerUnit="cm"
          i18n={EDITOR_LABELS}
          className="h-full"
          onEditorViewReady={() => {
            // Initial import/normalization emits document and comment callbacks.
            // Establish the baseline after that first render, before accepting edits.
            requestAnimationFrame(() => {
              if (ready.current) return;
              lastDocument.current = editorRef.current?.getDocument() ?? null;
              ready.current = true;
              askAboutFonts();
              if (recovered) { dirty.current = true; onDirtyChange?.(true); }
            });
          }}
          onChange={(document) => { lastDocument.current = document; markDirty(); }}
          onCommentsChange={() => {
            // Loading the imported threads happens before the editor ref has a document.
            if (editorRef.current?.getDocument()) markDirty();
          }}
          onError={(error) => toast.error(error.message)}
        />}
      </div>
      <ConfirmModal
        open={missingFonts.length > 0}
        title={t("docx.font_missing_title", { count: missingFonts.length })}
        message={t("docx.font_missing_body", { count: missingFonts.length, fonts: missingFonts.join(", ") })}
        confirmLabel={t("docx.font_missing_confirm", { count: missingFonts.length })}
        cancelLabel={t("docx.font_missing_cancel", { count: missingFonts.length })}
        confirmButtonVariant="secondary"
        onConfirm={() => resolveFonts(true)}
        onCancel={() => resolveFonts(false)}
      />
    </div>
  );
}

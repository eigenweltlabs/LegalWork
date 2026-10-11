import { viewMarkdownPlugin } from "../../views/view-markdown-plugin";
import { useEffect, useMemo, useRef } from "react";
import {
  MDXEditor, type MDXEditorMethods,
  headingsPlugin, listsPlugin, quotePlugin, linkPlugin, linkDialogPlugin,
  imagePlugin, tablePlugin, thematicBreakPlugin, frontmatterPlugin,
  codeBlockPlugin, codeMirrorPlugin, diffSourcePlugin, toolbarPlugin, markdownShortcutPlugin,
  realmPlugin, viewMode$, markdownProcessingError$, markdown$, muteChange$, createRootEditorSubscription$, useCellValue, usePublisher, type RealmPlugin, type ViewMode,
} from "@mdxeditor/editor";
import { EditorView } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { Code, FileText, GitCompareArrows, Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MarkdownImageDialog } from "./markdown-image-dialog";
import "@mdxeditor/editor/style.css";
import "./markdown-editor.css";
import { markdownCodeTheme } from "./markdown-code-theme";
import { t } from "@/i18n";
import { markdownBlocksPlugin } from "./markdown-block-controls";
import { preservedFrontmatterPlugin } from "./markdown-frontmatter-plugin";
import { documentFingerprint, requiresMarkdownSource } from "./markdown-document-sync";
import { preserveMarkdownFrontmatter } from "./markdown-block-model";

type Props = {
  value: string;
  baseline: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  imageUpload: (file: File) => Promise<string>;
  imagePreview: (source: string) => Promise<string>;
  extensions?: RealmPlugin[];
  viewModeRequest?: { mode: ViewMode };
  linkSuggestions?: string[];
  onOpenLink?: (url: string) => void;
  suppressHtmlProcessing?: boolean;
  /** Render typed properties outside the editor while keeping full-file Source editing. */
  externalFrontmatter?: boolean;
};

function MarkdownToolbar({ rawMarkdown }: { rawMarkdown: () => string }) {
  const mode = useCellValue(viewMode$);
  const sourceRequired = requiresMarkdownSource(rawMarkdown());
  const changeMode = usePublisher(viewMode$);
  const changeSource = usePublisher(markdown$);
  const selectMode = (next: ViewMode) => {
    const raw = rawMarkdown();
    changeMode(next);
    if (next !== "rich-text") changeSource(raw);
  };
  return <div className="lw-markdown-tools">
    {mode !== "rich-text" && sourceRequired && <span className="lw-source-note" role="status">{t("markdown.blocks.source_required")}</span>}
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t("markdown.page.options")} />}><Ellipsis /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={sourceRequired} onClick={() => selectMode("rich-text")}><FileText />{t("markdown.toolbar.richText")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => selectMode("source")}><Code />{t("markdown.toolbar.source")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => selectMode("diff")}><GitCompareArrows />{t("markdown.toolbar.diffMode")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

export function ArtifactMarkdownEditor({ value, baseline, readOnly = false, onChange, imageUpload, imagePreview, extensions, viewModeRequest, linkSuggestions, onOpenLink, suppressHtmlProcessing = false, externalFrontmatter = false }: Props) {
  const editor = useRef<MDXEditorMethods>(null);
  const initial = useRef(value);
  const initialMode = useRef<ViewMode>(requiresMarkdownSource(value) ? "source" : viewModeRequest?.mode ?? "rich-text");
  const lastValue = useRef(value);
  const syncSource = useRef<((value: string, previous: string) => void) | null>(null);
  const lastViewRequest = useRef(viewModeRequest);
  const mode = useRef<ViewMode>(initialMode.current);
  const currentProps = useRef({ onChange, externalFrontmatter });
  currentProps.current = { onChange, externalFrontmatter };
  const publish = (next: string) => {
    if (next === lastValue.current) return;
    lastValue.current = next;
    currentProps.current.onChange(next);
  };
  const sourceExtensions = useMemo(() => [...markdownCodeTheme, EditorView.updateListener.of(update => {
    // The upstream SourceEditor reports focus/selection transactions as changes.
    // Only an actual source document edit may replace the canonical raw file.
    if (update.docChanged && !update.state.readOnly && mode.current !== "rich-text" && update.transactions.some(transaction => transaction.annotation(Transaction.userEvent))) publish(update.state.doc.toString());
  })], []);
  const requestedViewPlugin = useMemo(() => realmPlugin<{ mode: ViewMode }>({
    init(realm) {
      syncSource.current = (value, previous) => {
        if (requiresMarkdownSource(value)) realm.pub(viewMode$, "source");
        if (mode.current !== "rich-text") {
          // Source edits update the visible CodeMirror document independently of
          // markdown$. Advance that cell through the previous raw value so an
          // external edit still refreshes Diff after a user reverts a change.
          realm.pub(markdown$, previous);
          realm.pub(markdown$, value);
        }
      };
      let fingerprint: string | null = null;
      realm.pub(createRootEditorSubscription$, root => root.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
        if (!dirtyElements.size && !dirtyLeaves.size) return;
        const nextFingerprint = documentFingerprint(editorState.toJSON());
        const changed = fingerprint !== null && fingerprint !== nextFingerprint;
        fingerprint = nextFingerprint;
        if (changed && !realm.getValue(muteChange$) && !realm.getValue(markdownProcessingError$)) {
          const markdown = realm.getValue(markdown$);
          publish(currentProps.current.externalFrontmatter ? preserveMarkdownFrontmatter(lastValue.current, markdown) : markdown);
        }
        // SourceEditor initializes from markdown$, not markdownSourceEditorValue$.
        // Nested table editors can serialize on blur, after a view switch. Restore
        // the exact source after that flush even when there was no document edit.
        if (mode.current !== "rich-text") realm.pub(markdown$, lastValue.current);
      }));
      realm.sub(viewMode$, value => {
        mode.current = value;
        if (value === "rich-text" && requiresMarkdownSource(lastValue.current)) { realm.pub(viewMode$, "source"); return; }
        if (value !== "rich-text") realm.pub(markdown$, lastValue.current);
      });
      realm.sub(markdownProcessingError$, error => {
        if (!error) return;
        realm.pub(viewMode$, "source");
        realm.pub(markdown$, lastValue.current);
      });
    },
    update(realm, request) {
      if (request === lastViewRequest.current) return;
      lastViewRequest.current = request;
      if (request) realm.pub(viewMode$, request.mode);
    },
  }), []);
  const plugins = useMemo(() => [
    headingsPlugin(), listsPlugin(), quotePlugin(), linkPlugin(), linkDialogPlugin({ linkAutocompleteSuggestions: linkSuggestions, onClickLinkCallback: onOpenLink }),
    imagePlugin({ imageUploadHandler: imageUpload, imagePreviewHandler: imagePreview, ImageDialog: MarkdownImageDialog }),
    tablePlugin(), thematicBreakPlugin(), externalFrontmatter ? preservedFrontmatterPlugin() : frontmatterPlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
    viewMarkdownPlugin(),
    codeMirrorPlugin({ codeMirrorExtensions: markdownCodeTheme, codeBlockLanguages: { txt: "Text", js: "JavaScript", ts: "TypeScript", json: "JSON", python: "Python", sql: "SQL", bash: "Shell", mermaid: "Mermaid" } }),
    diffSourcePlugin({ codeMirrorExtensions: sourceExtensions, viewMode: initialMode.current, diffMarkdown: baseline }),
    requestedViewPlugin(viewModeRequest),
    ...(extensions ?? []),
    markdownShortcutPlugin(),
    markdownBlocksPlugin(),
    toolbarPlugin({ toolbarContents: () => <MarkdownToolbar rawMarkdown={() => lastValue.current} /> }),
  ], [baseline, sourceExtensions, imageUpload, imagePreview, extensions, requestedViewPlugin, viewModeRequest, linkSuggestions, onOpenLink, externalFrontmatter, readOnly]);

  useEffect(() => {
    if (value === lastValue.current) return;
    const previous = lastValue.current;
    lastValue.current = value;
    editor.current?.setMarkdown(value);
    syncSource.current?.(value, previous);
  }, [value]);

  return <MDXEditor
    ref={editor}
    translation={(key, defaultValue, interpolations) => {
      const translationKey = `markdown.${key}`;
      const translated = t(translationKey, Object.fromEntries(Object.entries(interpolations ?? {}).map(([name, value]) => [name, String(value)])));
      return translated === translationKey ? defaultValue : translated;
    }}
    className="lw-markdown-editor"
    contentEditableClassName="lw-markdown-page"
    markdown={initial.current}
    trim={false}
    readOnly={readOnly}
    suppressHtmlProcessing={suppressHtmlProcessing}
    plugins={plugins}
    placeholder={t("artifact.start_writing")}
  />;
}

import { useEffect, useMemo, useRef } from "react";
import {
  MDXEditor, type MDXEditorMethods, UndoRedo, BoldItalicUnderlineToggles,
  BlockTypeSelect, ListsToggle, CreateLink, InsertImage, InsertTable,
  InsertCodeBlock, InsertThematicBreak, Separator, DiffSourceToggleWrapper,
  headingsPlugin, listsPlugin, quotePlugin, linkPlugin, linkDialogPlugin,
  imagePlugin, tablePlugin, thematicBreakPlugin, frontmatterPlugin,
  codeBlockPlugin, codeMirrorPlugin, diffSourcePlugin, toolbarPlugin, markdownShortcutPlugin,
  realmPlugin, viewMode$, type RealmPlugin, type ViewMode,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "./markdown-editor.css";
import { markdownCodeTheme } from "./markdown-code-theme";
import { t } from "@/i18n";

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
};

export function ArtifactMarkdownEditor({ value, baseline, readOnly = false, onChange, imageUpload, imagePreview, extensions, viewModeRequest, linkSuggestions, onOpenLink, suppressHtmlProcessing = false }: Props) {
  const editor = useRef<MDXEditorMethods>(null);
  const initial = useRef(value);
  const lastValue = useRef(value);
  const lastViewRequest = useRef(viewModeRequest);
  const requestedViewPlugin = useMemo(() => realmPlugin<{ mode: ViewMode }>({
    update(realm, request) {
      if (request === lastViewRequest.current) return;
      lastViewRequest.current = request;
      if (request) realm.pub(viewMode$, request.mode);
    },
  }), []);
  const plugins = useMemo(() => [
    headingsPlugin(), listsPlugin(), quotePlugin(), linkPlugin(), linkDialogPlugin({ linkAutocompleteSuggestions: linkSuggestions, onClickLinkCallback: onOpenLink }),
    imagePlugin({ imageUploadHandler: imageUpload, imagePreviewHandler: imagePreview }),
    tablePlugin(), thematicBreakPlugin(), frontmatterPlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
    codeMirrorPlugin({ codeMirrorExtensions: markdownCodeTheme, codeBlockLanguages: { txt: "Text", js: "JavaScript", ts: "TypeScript", json: "JSON", python: "Python", sql: "SQL", bash: "Shell", mermaid: "Mermaid" } }),
    diffSourcePlugin({ codeMirrorExtensions: markdownCodeTheme, viewMode: viewModeRequest?.mode ?? "rich-text", diffMarkdown: baseline }),
    requestedViewPlugin(viewModeRequest),
    ...(extensions ?? []),
    markdownShortcutPlugin(),
    toolbarPlugin({ toolbarContents: () => (
      <DiffSourceToggleWrapper>
        <UndoRedo /><Separator /><BlockTypeSelect /><Separator />
        <BoldItalicUnderlineToggles options={["Bold", "Italic"]} /><ListsToggle />
        <Separator /><CreateLink /><InsertImage /><InsertTable /><InsertCodeBlock /><InsertThematicBreak />
      </DiffSourceToggleWrapper>
    ) }),
  ], [baseline, imageUpload, imagePreview, extensions, requestedViewPlugin, viewModeRequest, linkSuggestions, onOpenLink]);

  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    editor.current?.setMarkdown(value);
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
    onChange={(markdown, initialNormalize) => {
      // Opening a file must not rewrite its original whitespace or bullet style.
      if (initialNormalize) return;
      lastValue.current = markdown;
      onChange(markdown);
    }}
  />;
}

import type { ComponentProps, MouseEvent } from "react";
import { addMdastExtension$, addSyntaxExtension$, addToMarkdownExtension$, realmPlugin } from "@mdxeditor/editor";
import { ArtifactMarkdownEditor } from "../session/artifacts/artifact-markdown-editor";
import { wikiEditorLinkTarget, wikiLinkFromMarkdown, wikiLinkSyntax, wikiLinkToMarkdown } from "./wiki-markdown-syntax";

const wikiLinksPlugin = realmPlugin({ init(realm) {
  realm.pubIn({ [addSyntaxExtension$]: wikiLinkSyntax, [addMdastExtension$]: wikiLinkFromMarkdown, [addToMarkdownExtension$]: wikiLinkToMarkdown });
} });
const extensions = [wikiLinksPlugin()];

export function WikiMarkdownEditor(props: ComponentProps<typeof ArtifactMarkdownEditor>) {
  const pageLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.altKey || !props.onOpenLink || !(event.target instanceof Element)) return null;
    return event.target.closest<HTMLAnchorElement>(".lw-markdown-page a[href]");
  };
  return <div className="wiki-markdown-editor" onMouseDownCapture={event => {
    // Follow links without moving the editor selection into its link-edit popover.
    // Alt-click still places the caret for editing a link with the toolbar or Cmd/Ctrl+K.
    if (pageLink(event)) event.preventDefault();
  }} onClickCapture={event => {
    const link = pageLink(event);
    const href = link?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    props.onOpenLink?.(wikiEditorLinkTarget(href));
  }}><ArtifactMarkdownEditor {...props} onOpenLink={props.onOpenLink ? url => props.onOpenLink?.(wikiEditorLinkTarget(url)) : undefined} extensions={extensions} suppressHtmlProcessing /></div>;
}

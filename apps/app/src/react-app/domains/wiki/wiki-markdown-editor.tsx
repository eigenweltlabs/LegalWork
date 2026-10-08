import type { ComponentProps } from "react";
import { addMdastExtension$, addSyntaxExtension$, addToMarkdownExtension$, markdownProcessingError$, realmPlugin, viewMode$ } from "@mdxeditor/editor";
import { ArtifactMarkdownEditor } from "../session/artifacts/artifact-markdown-editor";
import { wikiLinkFromMarkdown, wikiLinkSyntax, wikiLinkToMarkdown } from "./wiki-markdown-syntax";

const wikiLinksPlugin = realmPlugin({ init(realm) {
  realm.pubIn({ [addSyntaxExtension$]: wikiLinkSyntax, [addMdastExtension$]: wikiLinkFromMarkdown, [addToMarkdownExtension$]: wikiLinkToMarkdown });
  // Unsupported syntax stays editable in the same editor's Source view.
  realm.sub(markdownProcessingError$, (error) => { if (error) realm.pub(viewMode$, "source"); });
} });
const extensions = [wikiLinksPlugin()];

export function WikiMarkdownEditor(props: ComponentProps<typeof ArtifactMarkdownEditor>) {
  return <ArtifactMarkdownEditor {...props} extensions={extensions} suppressHtmlProcessing />;
}

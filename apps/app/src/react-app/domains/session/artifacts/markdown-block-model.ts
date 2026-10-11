import { $createParagraphNode, $getNodeByKey, $getRoot, $getSelection, $isElementNode, $isRangeSelection, type LexicalNode } from "lexical";

/** A handle always moves a complete top-level block, including a list's children. */
export function $documentBlock(node: LexicalNode | null): LexicalNode | null {
  if (!node || node.getType() === "root") return null;
  const block = node.getTopLevelElement();
  return block && block.getType() !== "frontmatter" ? block : null;
}

export function $selectedDocumentBlock(): LexicalNode | null {
  const selection = $getSelection();
  return $isRangeSelection(selection) ? $documentBlock(selection.anchor.getNode()) : null;
}

export function $moveDocumentBlock(key: string, direction: "up" | "down"): boolean {
  const block = $documentBlock($getNodeByKey(key));
  if (!block) return false;
  const adjacent = direction === "up" ? block.getPreviousSibling() : block.getNextSibling();
  if (!adjacent || adjacent.getType() === "frontmatter") return false;
  if (direction === "up") adjacent.insertBefore(block);
  else adjacent.insertAfter(block);
  return true;
}

export function $dropDocumentBlock(key: string, targetKey: string, after: boolean): boolean {
  const block = $documentBlock($getNodeByKey(key));
  const target = $documentBlock($getNodeByKey(targetKey));
  if (!block || !target || block.is(target)) return false;
  if (after) target.insertAfter(block);
  else target.insertBefore(block);
  return true;
}

export function $deleteDocumentBlock(key: string): boolean {
  const block = $documentBlock($getNodeByKey(key));
  if (!block) return false;
  const next = block.getNextSibling();
  const previous = block.getPreviousSibling();
  if ($isElementNode(next)) next.selectStart();
  else if ($isElementNode(previous) && previous.getType() !== "frontmatter") previous.selectEnd();
  block.remove();
  if (!$documentBlocks().length) {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    paragraph.selectStart();
  }
  return true;
}

export function $documentBlocks() {
  return $getRoot().getChildren().filter(node => node.getType() !== "frontmatter");
}

/** Slash insertion is only offered in a standalone paragraph, never inside code or a table. */
export function $slashQuery(): { key: string; query: string } | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const block = $selectedDocumentBlock();
  if (!block || block.getType() !== "paragraph") return null;
  const text = block.getTextContent();
  if (!/^\/[^\n/]{0,40}$/.test(text)) return null;
  const anchor = selection.anchor;
  if (anchor.type !== "text" || anchor.offset !== anchor.getNode().getTextContentSize()) return null;
  return { key: block.getKey(), query: text.slice(1) };
}

/** Raw frontmatter is outside the block editor's editable body. Source mode can still edit it. */
export function markdownFrontmatter(source: string): { prefix: string; body: string } {
  const match = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(source);
  return match ? { prefix: match[0], body: source.slice(match[0].length) } : { prefix: "", body: source };
}

export function preserveMarkdownFrontmatter(previous: string, next: string): string {
  const original = markdownFrontmatter(previous);
  if (!original.prefix) return next;
  return original.prefix + markdownFrontmatter(next).body;
}

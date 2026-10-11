import { documentFingerprint, requiresMarkdownSource } from "../src/react-app/domains/session/artifacts/markdown-document-sync";
import { describe, expect, test } from "bun:test";
import { $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, $getSelection, $isElementNode, $isRangeSelection, createEditor, type LexicalEditor } from "lexical";
import { $deleteDocumentBlock, $documentBlocks, $dropDocumentBlock, $moveDocumentBlock, $selectedDocumentBlock, $slashQuery, markdownFrontmatter, preserveMarkdownFrontmatter } from "../src/react-app/domains/session/artifacts/markdown-block-model";
import { PreservedFrontmatterNode } from "../src/react-app/domains/session/artifacts/markdown-frontmatter-plugin";

function editorWithBlocks() {
  const editor = createEditor({ namespace: "block-tests", nodes: [PreservedFrontmatterNode], onError: error => { throw error; } });
  const keys: string[] = [];
  editor.update(() => {
    const yaml = new PreservedFrontmatterNode("enabled: false\ncount: 0\n# keep this comment");
    $getRoot().append(yaml);
    keys.push(yaml.getKey());
    for (const content of ["First block", "Second block", "Third block"]) {
      const paragraph = $createParagraphNode().append($createTextNode(content).toggleFormat("bold"));
      $getRoot().append(paragraph);
      keys.push(paragraph.getKey());
    }
  }, { discrete: true });
  return { editor, keys };
}

function text(editor: LexicalEditor) { return editor.getEditorState().read(() => $documentBlocks().map(block => block.getTextContent())); }

describe("Markdown block transactions", () => {
  test("keyboard movement reorders original nodes and preserves formatting and metadata", () => {
    const { editor, keys } = editorWithBlocks();
    const before = editor.getEditorState().read(() => $getNodeByKey(keys[2])?.exportJSON());
    editor.update(() => { expect($moveDocumentBlock(keys[2], "up")).toBe(true); }, { discrete: true });
    expect(text(editor)).toEqual(["Second block", "First block", "Third block"]);
    editor.getEditorState().read(() => {
      expect($getRoot().getFirstChild()?.getType()).toBe("frontmatter");
      expect($getNodeByKey(keys[2])?.exportJSON()).toEqual(before);
      const node = $getNodeByKey(keys[2]);
      expect($isElementNode(node) && node.getFirstChild()?.getTextContent()).toBe("Second block");
    });
    editor.update(() => { expect($moveDocumentBlock(keys[2], "down")).toBe(true); }, { discrete: true });
    expect(text(editor)).toEqual(["First block", "Second block", "Third block"]);
  });

  test("dragging moves a full block before or after the target without duplicating it", () => {
    const { editor, keys } = editorWithBlocks();
    editor.update(() => { expect($dropDocumentBlock(keys[1], keys[3], true)).toBe(true); }, { discrete: true });
    expect(text(editor)).toEqual(["Second block", "Third block", "First block"]);
    editor.update(() => { expect($dropDocumentBlock(keys[1], keys[2], false)).toBe(true); }, { discrete: true });
    expect(text(editor)).toEqual(["First block", "Second block", "Third block"]);
  });

  test("metadata and invalid or self destinations cannot be moved or deleted", () => {
    const { editor, keys } = editorWithBlocks();
    editor.update(() => {
      expect($moveDocumentBlock(keys[1], "up")).toBe(false);
      expect($moveDocumentBlock(keys[3], "down")).toBe(false);
      expect($moveDocumentBlock(keys[0], "down")).toBe(false);
      expect($deleteDocumentBlock(keys[0])).toBe(false);
      expect($dropDocumentBlock(keys[2], keys[2], true)).toBe(false);
      expect($dropDocumentBlock(keys[1], keys[0], false)).toBe(false);
      expect($dropDocumentBlock("missing", keys[1], false)).toBe(false);
    }, { discrete: true });
    expect(text(editor)).toEqual(["First block", "Second block", "Third block"]);
  });

  test("deleting the last body block leaves an editable paragraph and preserves YAML", () => {
    const { editor, keys } = editorWithBlocks();
    editor.update(() => { for (const key of keys.slice(1)) $deleteDocumentBlock(key); }, { discrete: true });
    expect(text(editor)).toEqual([""]);
    editor.getEditorState().read(() => {
      expect($getRoot().getFirstChild()?.exportJSON()).toMatchObject({ yaml: "enabled: false\ncount: 0\n# keep this comment" });
      expect($selectedDocumentBlock()?.getType()).toBe("paragraph");
    });
  });

  test("slash commands require an isolated paragraph and a collapsed end caret", () => {
    const { editor, keys } = editorWithBlocks();
    editor.update(() => {
      const block = $getNodeByKey(keys[1]);
      if (!$isElementNode(block)) throw new Error("Missing test paragraph");
      block.clear().append($createTextNode("/table"));
      block.selectEnd();
      expect($slashQuery()).toEqual({ key: keys[1], query: "table" });
      block.selectStart();
      expect($slashQuery()).toBeNull();
      block.clear().append($createTextNode("A /table reference"));
      block.selectEnd();
      expect($slashQuery()).toBeNull();
      block.clear().append($createTextNode("https://example.com"));
      block.selectEnd();
      expect($slashQuery()).toBeNull();
    }, { discrete: true });
  });

  test("selection remains in the moved text rather than moving to a different block", () => {
    const { editor, keys } = editorWithBlocks();
    editor.update(() => {
      const block = $getNodeByKey(keys[2]);
      if (!$isElementNode(block)) throw new Error("Missing test paragraph");
      block.selectEnd();
      $moveDocumentBlock(keys[2], "up");
      expect($selectedDocumentBlock()?.getKey()).toBe(keys[2]);
      const selection = $getSelection();
      expect($isRangeSelection(selection) && selection.anchor.offset).toBe("Second block".length);
    }, { discrete: true });
  });
});

describe("External property editor fidelity", () => {
  test("rich body edits retain the exact BOM, CRLF, comments, falsy values and YAML delimiter", () => {
    const prefix = "\uFEFF---\r\n# keep\r\nactive: false\r\ncount: 0\r\nunknown: {a: [1, 2]}\r\n...\r\n";
    const next = "---\nactive: false\ncount: 0\nunknown: {a: [1, 2]}\n---\n\n# Changed\n";
    expect(preserveMarkdownFrontmatter(prefix + "\r\n# Original\r\n", next)).toBe(prefix + "\n# Changed\n");
  });

  test("rich editing cannot accidentally remove external properties", () => {
    expect(preserveMarkdownFrontmatter("---\ntags: [one, two]\n---\n\nText", "Edited")).toBe("---\ntags: [one, two]\n---\nEdited");
  });

  test("a horizontal rule later in the body is not treated as frontmatter", () => {
    const source = "# Title\n\n---\nSome content\n---\n";
    expect(markdownFrontmatter(source)).toEqual({ prefix: "", body: source });
    expect(preserveMarkdownFrontmatter(source, "New body")).toBe("New body");
  });
});


describe("Document change detection", () => {
  test("table mount/blur caches and reparsed source offsets do not become edits", () => {
    const before = { type: "table", children: [{ type: "tableCell", children: [{ type: "text", value: "Retained", position: { start: { line: 2 } } }] }] };
    const after = { children: [{ __cacheKey: "new-cell-identity", children: [{ value: "Retained", type: "text" }], type: "tableCell" }], type: "table" };
    expect(documentFingerprint(before)).toBe(documentFingerprint(after));
  });

  test("cell text, alignment, and formatting changes are persisted", () => {
    const before = { type: "table", align: [null], children: [{ type: "text", value: "Original", format: 0 }] };
    expect(documentFingerprint(before)).not.toBe(documentFingerprint({ ...before, align: ["right"] }));
    expect(documentFingerprint(before)).not.toBe(documentFingerprint({ ...before, children: [{ type: "text", value: "Edited", format: 0 }] }));
    expect(documentFingerprint(before)).not.toBe(documentFingerprint({ ...before, children: [{ type: "text", value: "Original", format: 1 }] }));
  });
});


describe("Unsupported Markdown source fallback", () => {
  test("unsupported footnotes, directives and raw HTML use source editing", () => {
    for (const source of ["Text[^note]\n\n[^note]: Preserve me", ":::widget{key=one}\ncontent\n:::", "A :widget[value]", "<div data-unknown=\"keep\">Original</div>"]) expect(requiresMarkdownSource(source)).toBe(true);
  });
  test("unknown code fences, inline code, wiki links and metadata remain supported", () => {
    for (const source of ["```legalwork-view\n{\"keep\":true}\n```", "`[^example]` and `:widget[value]`", "[[Page|Alias]] and [ordinary](relative.md)", "---\nhtml: <div>\n---\n# Body"]) expect(requiresMarkdownSource(source)).toBe(false);
  });
});

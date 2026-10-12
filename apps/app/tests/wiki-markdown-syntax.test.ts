import { describe, expect, test } from "bun:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown, frontmatterToMarkdown } from "mdast-util-frontmatter";
import { wikiLinkFromMarkdown, wikiLinkSyntax, wikiLinkToMarkdown } from "../src/react-app/domains/wiki/wiki-markdown-syntax";

function roundTrip(markdown: string) {
  const tree = fromMarkdown(markdown, { extensions: [frontmatter(), wikiLinkSyntax], mdastExtensions: [frontmatterFromMarkdown("yaml"), wikiLinkFromMarkdown] });
  return toMarkdown(tree, { extensions: [frontmatterToMarkdown("yaml"), wikiLinkToMarkdown] });
}

describe("wiki links in the shared Markdown editor", () => {
  test("preserves page paths, aliases, Unicode and heading destinations after body edits", () => {
    const input = '[[Clients/Acme.md]] and [[Research/Überblick#Sources|Evidence]]\n';
    expect(roundTrip(input)).toBe(input);
    expect(roundTrip(input + '\nNew **body**.\n')).toContain(input);
  });
  test("uses a safe fragment URL in the editor and restores wiki syntax on save", () => {
    const tree = fromMarkdown("[[Clients/Überblick.md#Sources|Evidence]]", { extensions: [wikiLinkSyntax], mdastExtensions: [wikiLinkFromMarkdown] });
    expect(tree.children[0]).toMatchObject({ type: "paragraph", children: [{ type: "link", url: "#wiki:Clients%2F%C3%9Cberblick.md%23Sources" }] });
    expect(toMarkdown(tree, { extensions: [wikiLinkToMarkdown] })).toBe("[[Clients/Überblick.md#Sources|Evidence]]\n");
    expect(roundTrip("[Acme](#wiki:Clients%2FAcme.md)\n")).toBe("[[Clients/Acme.md|Acme]]\n");
  });
  test("preserves links to documents, images and saved dashboards", () => {
    for (const target of ["Templates/Engagement letter.docx", "Evidence/Contract.pdf", "Assets/Logo.png", "Reports/Firm.view.json"]) {
      expect(roundTrip(`[[${target}|Open file]]\n`)).toBe(`[[${target}|Open file]]\n`);
    }
  });
  test("keeps nested YAML definitions unchanged while editing the body", () => {
    const yaml = '---\ntype: page\naliases: [One, Two]\nviews:\n  - name: Deals\n    filter:\n      type: deal\n    columns: [title, status]\nsummary: |\n  Keep this multiline text.\n---\n';
    expect(roundTrip(yaml + '\n# Views\n\n[[Client]]\n')).toStartWith(yaml);
  });
  test("leaves ordinary Markdown links and bracket literals as their original kinds", () => {
    const input = '[Web](https://example.com) and [Page](../Other.md#Sources)\n\n`[[Code]]`\n\n```md\n[[Fenced code]]\n```\n\n\\[\\[Literal]]\n';
    const output = roundTrip(input);
    expect(output).toContain('[Web](https://example.com)');
    expect(output).toContain('[Page](../Other.md#Sources)');
    expect(output).toContain('`[[Code]]`');
    expect(output).toContain('```md\n[[Fenced code]]\n```');
    const tree = fromMarkdown(output, { extensions: [wikiLinkSyntax], mdastExtensions: [wikiLinkFromMarkdown] });
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: '[[Literal]]' }] });
  });
  test("converts links authored through the standard Create Link dialog", () => {
    expect(roundTrip('[Acme]([[Clients/Acme.md]])\n')).toBe('[[Clients/Acme.md|Acme]]\n');
    expect(roundTrip('[Acme](wiki:Clients%2FAcme.md)\n')).toBe('[[Clients/Acme.md|Acme]]\n');
    expect(toMarkdown({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'link', url: '[[Clients/Acme.md]]', children: [{ type: 'text', value: '[[Clients/Acme.md]]' }] }] }] }, { extensions: [wikiLinkToMarkdown] })).toBe('[[Clients/Acme.md]]\n');
  });
  test("preserves formatting and hover titles in Markdown links", () => {
    expect(roundTrip('[**Client**](../Client.md "Details")\n')).toBe('[**Client**](../Client.md "Details")\n');
  });
  test("treats incomplete or empty wiki links as text", () => {
    for (const source of ['[[', '[[]]', '[[|Alias]]', '[[One\nTwo]]']) {
      const tree = fromMarkdown(source, { extensions: [wikiLinkSyntax], mdastExtensions: [wikiLinkFromMarkdown] });
      expect(JSON.stringify(tree)).not.toContain('"type":"link"');
    }
  });
});


test("relative attachment links retain their original destination in the editor and on save", () => {
  const source = '[Edit](Attachments/Editable.txt "Original")\n';
  const tree = fromMarkdown(source, { extensions: [wikiLinkSyntax], mdastExtensions: [wikiLinkFromMarkdown] });
  expect(tree.children[0]).toMatchObject({ type: "paragraph", children: [{ type: "link", url: "#wiki-path:Attachments%2FEditable.txt", title: "Original" }] });
  expect(roundTrip(source)).toBe(source);
});

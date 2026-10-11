import { describe, expect, test } from "bun:test";
import type { WikiPage } from "@legalwork/types/wiki";
import { resolveWikiPage, updateWikiProperty, wikiBacklinks, wikiGraph, wikiMarkdownBody, wikiNewPagePath, wikiProcedurePrompt, wikiTemplateContent, wikiViewPages } from "../src/react-app/domains/wiki/wiki-model";
import { acceptWikiSave, type WikiDraft } from "../src/react-app/domains/wiki/wiki-drafts";

function page(path: string, patch: Partial<WikiPage> = {}): WikiPage {
  return { path, title: path.replace(/\.md$/, ""), type: "page", properties: {}, links: [], excerpt: "", revision: "a", updatedAt: 1, ...patch };
}

describe("Markdown wiki views and editing", () => {
  test("property moves preserve all other source, including CRLF and HTML", () => {
    const input = '---\r\ntype: deal\r\nstage: draft # old\r\nowner: "Team A"\r\n---\r\n\r\n<div>Keep me</div>\r\n[[Client]]\r\n';
    expect(updateWikiProperty(input, "stage", "signed")).toBe(input.replace('stage: draft # old', 'stage: "signed" # old'));
    expect(updateWikiProperty('---\n---\nBody\n', 'stage', 'x')).toBe('---\n"stage": "x"\n---\nBody\n');
    expect(updateWikiProperty('# Body\n', 'stage', 'x')).toBe('---\n"stage": "x"\n---\n\n# Body\n');
  });
  test("refuses complex YAML properties instead of corrupting source", () => {
    for (const yaml of ['stage: |\n  draft', 'stage:\n  - draft', 'stage: [a,b]', 'stage: draft\nstage: active']) {
      expect(() => updateWikiProperty(`---\n${yaml}\n---\nBody`, 'stage', 'new')).toThrow();
    }
    expect(() => updateWikiProperty('---\nx: a\n---\n', 'x: y', 'z')).toThrow();
  });
  test("resolves paths, relative paths, aliases and stable ids; refuses duplicate titles", () => {
    const client = page('Clients/A.md', { title: 'Acme', properties: { id: 'page-a', aliases: ['Old Acme'] } });
    const all = [client, page('Other/A.md', { title: 'Acme' }), page('Deals/Financing.md')];
    expect(resolveWikiPage(all, 'Acme')).toBeUndefined();
    expect(resolveWikiPage(all, 'Clients/A')).toBe(client);
    expect(resolveWikiPage(all, '../Clients/A.md', 'Deals/Financing.md')).toBe(client);
    expect(resolveWikiPage(all, 'Old Acme')).toBe(client);
    expect(resolveWikiPage(all, 'page-a')).toBe(client);
    expect(resolveWikiPage(all, 'Clients/A#Overview')).toBe(client);
  });
  test("backlinks include property links and the graph includes every page", () => {
    const target = page('Client.md');
    const from = page('Deal.md', { links: [{ target: 'Client.md', label: 'client', property: 'client', resolved: true }] });
    const all = [target, from, ...Array.from({ length: 100 }, (_, index) => page(`Note-${index}.md`))];
    expect(wikiBacklinks(all, target.path)).toEqual([from]);
    expect(wikiGraph(all, target.path).pages).toEqual([target, from]);
    expect(wikiGraph(all, null).pages).toHaveLength(all.length);
    expect(wikiGraph(all, null).truncated).toBe(false);
  });
  test("dynamic view filtering supports typed properties and tags", () => {
    const a = page('A.md', { type: 'deal', properties: { tags: ['VC', 'Firm'], active: true } });
    const b = page('B.md', { type: 'research', properties: { tags: ['VC'], active: false } });
    expect(wikiViewPages([a, b], { name: 'Deals', type: 'table', columns: ['title'], filter: { type: 'deal', tags: 'VC', active: true } })).toEqual([a]);
  });
  test("strips only leading frontmatter for reading", () => {
    expect(wikiMarkdownBody('---\n---\n# Title')).toBe('# Title');
    expect(wikiMarkdownBody('---\ntype: page\n---\n# Title')).toBe('# Title');
  });
  test("copies editable page templates without reusing identities or template type", () => {
    const content = '---\nid: template-id\ntype: template\ntemplate_for: process\nstatus: draft\n---\n# Process template\n\n## Sources\n';
    const output = wikiTemplateContent(content, page('Templates/Process.md', { type: 'template', properties: { template_for: 'process' } }), 'Financing');
    expect(output).toContain('type: "process"');
    expect(output).toContain('status: draft');
    expect(output).toContain('# Financing\n');
    expect(output).not.toContain('template_for:');
    expect(output).not.toContain('template-id');
  });
  test("page paths cannot escape the folder", () => {
    expect(wikiNewPagePath('Processes/Financing')).toBe('Processes/Financing.md');
    for (const path of ['../Private', '/etc/file', 'Folder//Page', 'a/./b', 'a\\..\\b']) expect(() => wikiNewPagePath(path)).toThrow();
  });
  test("agent procedures adapt to an existing wiki without starter files", () => {
    expect(wikiProcedurePrompt([page("Skills/Bootstrap.md")], "Skills/Bootstrap.md", "help build knowledge.")).toStartWith("Read Skills/Bootstrap.md");
    const fallback = wikiProcedurePrompt([page("Structure.md")], "Skills/Bootstrap.md", "help build knowledge.");
    expect(fallback).toStartWith("Read Structure.md"); expect(fallback).not.toContain("Skills/Bootstrap.md");
  });
  test("an autosave response preserves edits typed while saving", () => {
    const draft: WikiDraft = { wikiId: 'wiki', path: 'A.md', content: 'Newer edit', baseline: 'Original', revision: 'a', updatedAt: 1, saving: true, error: null };
    const saved = acceptWikiSave(draft, 'Sent edit', { path: 'A.md', content: 'Sent edit', revision: 'b', updatedAt: 2 });
    expect(saved.content).toBe('Newer edit'); expect(saved.baseline).toBe('Sent edit'); expect(saved.revision).toBe('b');
  });
});

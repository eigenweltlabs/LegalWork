import { describe, expect, test } from "bun:test";
import { WikiGraphIndex } from "./graph.js";
import { parseWikiPage } from "./markdown.js";

function page(path: string, content: string) { return parseWikiPage(path, content, content, 1).page; }

describe("Compact wiki graph index", () => {
  test("resolves body and property links, refuses ambiguous names, and deduplicates identical relations", () => {
    const index = new WikiGraphIndex();
    index.update([page("People/A.md", "---\naliases: [Partner]\n---\n# Ada"), page("B.md", "---\nowner: '[[Partner]]'\n---\n# Deal\n[[Partner]] [[Partner]] [[Ada]] [[B]]"), page("Other.md", "# Ada")]);
    const result = index.response();
    expect(result.kind).toBe("snapshot");
    if (result.kind !== "snapshot") throw new Error("Expected snapshot");
    expect(result.nodes).toHaveLength(3);
    expect(result.edges.map((edge) => [edge.source, edge.target, edge.relation])).toEqual([["B.md", "People/A.md", null], ["B.md", "People/A.md", "owner"]]);
  });
  test("body-only edits preserve the compact revision, while graph edits send only their delta", () => {
    const index = new WikiGraphIndex(), a = page("A.md", "# A\n[[B]]"), b = page("B.md", "# B");
    index.update([a, b]); const revision = index.revision;
    index.update([{ ...a, excerpt: "Different body", revision: "new" }, b]);
    expect(index.response(revision)).toEqual({ kind: "unchanged", revision });
    index.update([a, { ...b, title: "Renamed" }]);
    const delta = index.response(revision);
    expect(delta.kind).toBe("delta");
    if (delta.kind !== "delta") throw new Error("Expected delta");
    expect(delta.nodes.map((node) => node.title)).toEqual(["Renamed"]); expect(delta.edges).toEqual([]);
    index.update([a]); const removed = index.response(revision);
    if (removed.kind !== "delta") throw new Error("Expected removal delta");
    expect(removed.nodes).toEqual([]); expect(removed.removedNodes).toEqual(["B.md"]); expect(removed.removedEdges).toHaveLength(1);
  });
  test("coalesces delete/re-add and falls back to a snapshot for expired or foreign revisions", () => {
    const index = new WikiGraphIndex(), a = page("A.md", "# A"); index.update([a]); const revision = index.revision;
    index.update([]); index.update([{ ...a, title: "Back" }]); const result = index.response(revision);
    if (result.kind !== "delta") throw new Error("Expected delta");
    expect(result.nodes.map((node) => node.title)).toEqual(["Back"]); expect(result.removedNodes).toEqual([]);
    for (let i = 0; i < 20; i++) index.update([{ ...a, title: `Title ${i}` }]);
    expect(index.response(revision).kind).toBe("snapshot"); expect(index.response("another-server:1").kind).toBe("snapshot");
  });
});

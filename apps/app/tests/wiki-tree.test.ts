import { expect, test } from "bun:test";
import { wikiCopyPath, wikiTree } from "../src/react-app/domains/wiki/wiki-tree";

test("wiki folders form a real hierarchy, including empty folders and attachments", () => {
  const tree = wikiTree(["Research/Deals/Note.md", "Research/scan.pdf", "Wiki.md"], ["Research/Empty"]);
  expect(tree.map((node) => node.path)).toEqual(["Research", "Wiki.md"]);
  expect(tree[0].children.map((node) => node.path)).toEqual(["Research/Deals", "Research/Empty", "Research/scan.pdf"]);
  expect(tree[0].children[0].children[0].path).toBe("Research/Deals/Note.md");
  expect(tree[0].children[1].children).toEqual([]);
});

test("duplicate paths retain their extension and avoid existing files", () => {
  expect(wikiCopyPath("Research/Note.md", ["Research/Note copy.md", "Research/Note copy 2.md"])).toBe("Research/Note copy 3.md");
  expect(wikiCopyPath("Empty", [])).toBe("Empty copy");
});

import { describe, expect, test } from "bun:test";
import { parseWikiPage, parseWikiViews, resolveWikiLinks } from "./markdown.js";
import { createWikiStarterFiles, WIKI_CONTROL_FILES } from "./templates.js";

describe("portable wiki starters", () => {
  test("firm starter renders valid views and every real cross-reference resolves", () => {
    const files = createWikiStarterFiles("firm", "Our firm");
    const pages = resolveWikiLinks(Object.entries(files).map(([path, content]) => parseWikiPage(path, content, "starter", 1).page));
    expect(pages.flatMap((page) => page.links.filter((link) => !link.resolved).map((link) => `${page.path}: ${link.target}`))).toEqual([]);
    const views = parseWikiViews(files["Views.md"]!);
    expect(views.warnings).toEqual([]);
    expect(views.views.some((view) => view.type === "kanban" && view.groupBy === "status")).toBe(true);
    expect(pages.some((page) => page.path === "Templates/Process.md" && page.properties.template_for === "process")).toBe(true);
  });

  test("blank starter keeps editable control files and procedures without invented firm knowledge", () => {
    const files = createWikiStarterFiles("blank", "Notes\nwith a title");
    expect(WIKI_CONTROL_FILES.every((path) => typeof files[path] === "string")).toBe(true);
    expect(files["Wiki.md"]).toStartWith("# Notes with a title\n");
    expect(Object.keys(files).some((path) => path.startsWith("Processes/") || path.startsWith("Research/"))).toBe(false);
    expect(files["Structure.md"]).toContain("Write your inclusion criteria");
    expect(files["Skills/Bootstrap.md"]).toContain("storage_read_file");
    expect(files["Instructions.md"]).toContain("sync automatically");
    expect(files["Skills/Anonymize.md"]).toContain("frontmatter, source labels, links, filenames, attachment names");
  });
});

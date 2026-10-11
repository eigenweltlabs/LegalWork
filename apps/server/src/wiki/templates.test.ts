import { describe, expect, test } from "bun:test";
import { parseWikiPage, parseWikiViews, resolveWikiLinks } from "./markdown.js";
import { createWikiStarterFiles, WIKI_CONTROL_FILES } from "./templates.js";

describe("portable wiki starters", () => {
  test("firm workflows and folder landing pages resolve without invented entity records", () => {
    const files = createWikiStarterFiles("firm", "Our firm");
    const pages = resolveWikiLinks(Object.entries(files).map(([path, content]) => parseWikiPage(path, content, "starter", 1).page));
    expect(pages.flatMap((page) => page.links.filter((link) => !link.resolved).map((link) => `${page.path}: ${link.target}`))).toEqual([]);
    const views = parseWikiViews(files["Views.md"]!);
    expect(views.warnings).toEqual([]);
    expect(views.views).toEqual([]);
    expect(pages.filter((page) => ["client", "matter", "person"].includes(String(page.properties.type)))).toEqual([]);
    for (const folder of ["Clients", "Matters", "People", "Processes", "Research", "Templates", "Sources", "Views", "Reports"]) {
      expect(pages.find((page) => page.path === `${folder}/${folder}.md`)?.properties.type).toBe("index");
    }
    expect(files["Skills/Build firm wiki.md"]).toContain("next folder/cursor");
    expect(files["Skills/Build firm wiki.md"]).toContain("user approval");
    expect(files["Skills/Dashboards and reports.md"]).toContain("server groupBy/metrics");
    expect(files["Skills/Dashboards and reports.md"]).toContain("view_create");
    expect(files["Skills/Dashboards and reports.md"]).toContain("legalwork-view");
    expect(Object.values(files).join("\n")).not.toContain("\u2014");
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
    expect(parseWikiViews(files["Views.md"]!).views.some((view) => view.type === "kanban")).toBe(true);
  });
});

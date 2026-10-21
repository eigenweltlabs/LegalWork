import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LauncherFileIndex } from "./launcher-file-index.js";

test("filename search ranks exact, prefix, word, substring and fuzzy matches and skips tool folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "launcher-index-"));
  const index = new LauncherFileIndex({ watch: false });
  try {
    await mkdir(join(root, "Müller", "Verträge"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "Müller", "Verträge", "Mietvertrag.docx"), "a");
    await writeFile(join(root, "Müller", "Verträge", "Mietvertrag-alt.docx"), "b");
    await writeFile(join(root, "Müller", "Untermietvertrag.pdf"), "c");
    await writeFile(join(root, "Notizen Vertrag.md"), "d");
    await writeFile(join(root, "node_modules", "pkg", "mietvertrag.js"), "e");
    await writeFile(join(root, ".hidden-mietvertrag.txt"), "f");
    expect(index.state("w")).toBe("unavailable");
    await index.ensure("w", root, true);
    expect(index.state("w")).toBe("ready");
    expect(index.size("w")).toBe(4);
    const results = index.search("w", "mietvertrag").map(item => [item.entry.path, item.match]);
    expect(results).toEqual([["Müller/Verträge/Mietvertrag.docx", "exact"], ["Müller/Verträge/Mietvertrag-alt.docx", "prefix"], ["Müller/Untermietvertrag.pdf", "substring"]]);
    const multi = index.search("w", "müller vertrag").map(item => item.entry.path);
    expect(multi[0]).toBe("Müller/Verträge/Mietvertrag.docx");
    expect(multi.slice(1).sort()).toEqual(["Müller/Untermietvertrag.pdf", "Müller/Verträge/Mietvertrag-alt.docx"]);
    expect(index.search("w", "vertrag").map(item => item.match)).toContain("word");
    expect(index.search("w", "mvtr").map(item => item.match)).toEqual(["fuzzy", "fuzzy", "fuzzy"]);
    expect(index.search("w", "zzzz")).toEqual([]);
    // A later walk sees the change; keystrokes in between search memory only.
    await writeFile(join(root, "Kaufvertrag.docx"), "g");
    expect(index.search("w", "kaufvertrag")).toEqual([]);
    index.invalidate("w");
    await index.ensure("w", root, true);
    expect(index.search("w", "kaufvertrag")[0]?.entry.name).toBe("Kaufvertrag.docx");
  } finally { index.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("a bounded index reports itself as limited instead of pretending completeness", async () => {
  const root = await mkdtemp(join(tmpdir(), "launcher-index-limit-"));
  const index = new LauncherFileIndex({ watch: false, maxEntries: 2 });
  try {
    for (const name of ["a.txt", "b.txt", "c.txt"]) await writeFile(join(root, name), name);
    await index.ensure("w", root, true);
    expect(index.state("w")).toBe("limited");
    expect(index.size("w")).toBe(2);
  } finally { index.dispose(); await rm(root, { recursive: true, force: true }); }
});

import { expect, test } from "bun:test";
import { matchingFilterProjects, matchesLauncherFileFilter, namedFileTypeFilter, typedFilterSuggestions } from "../src/react-app/launcher/launcher-typed-filters";
import { LANGUAGES, t } from "../src/i18n";

test("project filters require at least two characters at word boundaries", () => {
  const projects = [{ id: "aster", name: "Aster Retail - Software Agreement" }];
  for (const query of ["", "f", "a", "ster", "ware", "tail"]) expect(matchingFilterProjects(query, projects)).toEqual([]);
  for (const query of ["as", "RET", "soft", "aster agr"]) expect(matchingFilterProjects(query, projects).map(item => item.id)).toEqual(["aster"]);
  expect(typedFilterSuggestions("f", projects).filter(item => item.project)).toEqual([]);
});

test("match quality outranks current project and recency", () => {
  const projects = [{ id: "current", name: "Retail - Aster" }, { id: "prefix", name: "Aster Retail" }, { id: "exact", name: "Aster" }];
  expect(matchingFilterProjects("aster", projects, { currentProjectId: "current", recentProjectIds: ["current", "prefix"] }).map(item => item.id)).toEqual(["exact", "prefix", "current"]);
});

test("equally good matches prefer the current project, then recent use, and show at most three", () => {
  const projects = ["Alpha", "Beta", "Gamma", "Delta"].map(id => ({ id, name: `Retail ${id}` }));
  expect(matchingFilterProjects("ret", projects, { currentProjectId: "Gamma", recentProjectIds: ["Beta", "Alpha"] }).map(item => item.id)).toEqual(["Gamma", "Beta", "Alpha"]);
  expect(matchingFilterProjects("Beta", projects, { currentProjectId: "Gamma" }).map(item => item.id)).toEqual(["Beta"]);
});

test("display names and accents match, while Wikis and the Assistant remain separate", () => {
  const projects = [{ id: "project", name: "internal", displayName: "Müller – Verträge" }, { id: "wiki", name: "Müller", preset: "wiki" }, { id: "assistant", name: "Müller", preset: "main-assistant" }];
  expect(matchingFilterProjects("muller ver", projects)).toEqual([{ id: "project", name: "Müller – Verträge" }]);
  expect(matchingFilterProjects("internal", projects)).toEqual([]);
});

test("file type labels work in every shipped language and images exclude folders and documents", () => {
  for (const lng of LANGUAGES) {
    for (const name of ["images", "documents", "presentations", "spreadsheets", "emails", "pdf"]) {
      const label = t(`launcher.typed.${name}`, lng);
      expect(namedFileTypeFilter(label)?.name).toBe(name);
      expect(typedFilterSuggestions(label, []).some(item => item.id === `filter:type:${name}`)).toBe(true);
    }
  }
  const imageTypes = namedFileTypeFilter("Bilder")?.extensions ?? [];
  const filter = { types: imageTypes, modifiedAfter: null };
  const files = ["jpg", "WEBP", "svg", "pdf", "docx", "folder"].map(fileType => ({ fileType, title: `Images.${fileType}`, updatedAt: 1 }));
  expect(files.filter(file => matchesLauncherFileFilter(file, filter)).map(file => file.fileType)).toEqual(["jpg", "WEBP", "svg"]);
  expect(namedFileTypeFilter("image rights agreement")).toBeNull();
});

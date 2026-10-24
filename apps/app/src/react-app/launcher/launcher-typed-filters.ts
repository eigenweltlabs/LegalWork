import type { LauncherFileFilter } from "@legalwork/types/launcher";
import { t } from "@/i18n";

type FilterSuggestion = { id: string; title: string; files?: LauncherFileFilter; project?: { id: string; name: string } };
const types = [
  { words: ["emails", "email", "mails", "mail", "e-mails"], extensions: ["eml", "msg"], name: "emails" },
  { words: ["documents", "document", "dokumente", "dokument"], extensions: ["docx", "doc", "pdf", "md", "txt", "rtf", "odt"], name: "documents" },
  { words: ["presentations", "powerpoint", "präsentationen"], extensions: ["pptx", "ppt"], name: "presentations" },
  { words: ["pdf", "pdfs"], extensions: ["pdf"], name: "pdf" },
  { words: ["images", "image", "bilder", "bild"], extensions: ["png", "jpg", "jpeg", "webp", "gif", "tiff", "heic"], name: "images" },
  { words: ["spreadsheets", "excel", "tabellen"], extensions: ["xlsx", "xls", "csv"], name: "spreadsheets" },
];
const units = ["days", "weeks", "months", "years"];
const names = [["day", "days", "tag", "tage", "tagen"], ["week", "weeks", "woche", "wochen"], ["month", "months", "monat", "monate", "monaten"], ["year", "years", "jahr", "jahre", "jahren"]];
export function typedFilterSuggestions(raw: string, projects: { id: string; name: string; displayName?: string | null }[], now = new Date()): FilterSuggestion[] {
  const query = raw.trim().toLocaleLowerCase();
  if (!query) return [];
  const suggestions: FilterSuggestion[] = types.filter(type => type.words.some(word => word.startsWith(query))).map(type => ({ id: `filter:type:${type.name}`, title: t(`launcher.typed.${type.name}`), files: { types: type.extensions, modifiedAfter: null } }));
  const date = /^(?:last|past|letzte[nr]?)\s+(\d+)\s*([\p{L}]*)$/u.exec(query);
  const ranges = date ? names.flatMap((aliases, index) => (!date[2] || aliases.some(name => name.startsWith(date[2]))) ? [{ count: Number(date[1]), unit: units[index] }] : []) : ["last", "letzte", "past"].some(word => word.startsWith(query)) ? [{ count: 7, unit: "days" }, { count: 30, unit: "days" }, { count: 1, unit: "years" }] : [];
  for (const { count, unit } of ranges) {
    if (!Number.isInteger(count) || count < 1 || count > 10000) continue;
    const since = new Date(now);
    if (unit === "years") since.setFullYear(since.getFullYear() - count);
    else if (unit === "months") since.setMonth(since.getMonth() - count);
    else since.setDate(since.getDate() - count * (unit === "weeks" ? 7 : 1));
    if (since.getTime() <= 0) continue;
    suggestions.push({ id: `filter:date:${count}:${unit}`, title: t("launcher.typed.last", { count, unit: t(`launcher.typed.${unit}`) }), files: { types: null, modifiedAfter: since.getTime() } });
  }
  for (const project of projects) {
    const name = project.displayName || project.name;
    if (name.toLocaleLowerCase().includes(query)) suggestions.push({ id: `filter:project:${project.id}`, title: t("launcher.typed.project", { name }), project: { id: project.id, name } });
  }
  return suggestions.slice(0, 10);
}

export function dateFilterLabel(since: number, now = Date.now()) {
  const days = Math.max(1, Math.round((now - since) / 86_400_000));
  const [count, unit] = days >= 360 && Math.abs(days / 365.25 - Math.round(days / 365.25)) < .02 ? [Math.round(days / 365.25), "years"] : days >= 28 && Math.abs(days / 30.44 - Math.round(days / 30.44)) < .08 ? [Math.round(days / 30.44), "months"] : days % 7 === 0 ? [days / 7, "weeks"] : [days, "days"];
  return t("launcher.typed.last", { count, unit: t(`launcher.typed.${unit}`) });
}

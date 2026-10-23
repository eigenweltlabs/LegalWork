import { DEFAULT_LAUNCHER_ALIASES, LAUNCHER_SEARCH_KINDS, type LauncherSearchKind } from "@legalwork/types/launcher";

export type LauncherAliases = Record<LauncherSearchKind, string>;
export type LauncherEntryMode = "search" | "command" | "ask";
export type ParsedLauncherEntry = { mode: LauncherEntryMode; text: string };

const ALIAS_PATTERN = /^[a-z0-9]{1,3}$/;
export const CATEGORY_WORDS: Record<LauncherSearchKind, string[]> = {
  files: ["files", "file", "dateien", "datei"], projects: ["projects", "project", "projekte", "projekt"],
  chats: ["chats", "chat", "conversations", "gespräche"], tasks: ["tasks", "task", "aufgaben", "aufgabe", "todos"],
  recordings: ["recordings", "recording", "aufnahmen", "aufnahme"],
};

/** Full category names browse immediately; partial names and aliases complete first. */
export function namedCategoryQuery(raw: string): { category: LauncherSearchKind; rest: string } | null {
  const [word] = raw.trim().toLocaleLowerCase().split(/\s+/);
  const category = LAUNCHER_SEARCH_KINDS.find(kind => CATEGORY_WORDS[kind].includes(word));
  return category ? { category, rest: raw.trim().split(/\s+/).slice(1).join(" ") } : null;
}
export function categorySuggestions(raw: string, aliases: LauncherAliases): LauncherSearchKind[] {
  const query = raw.trim().toLocaleLowerCase();
  if (!query) return [...LAUNCHER_SEARCH_KINDS];
  if (namedCategoryQuery(raw)) return [];
  return LAUNCHER_SEARCH_KINDS.filter(kind => aliases[kind] === query || CATEGORY_WORDS[kind].some(word => word.startsWith(query)))
    .sort((a, b) => Number(aliases[b] === query) - Number(aliases[a] === query));
}

/** Aliases are configurable; collisions are reported, never silently resolved. */
export function normalizeLauncherAliases(input: Partial<Record<string, string>> | null | undefined): LauncherAliases {
  const aliases = { ...DEFAULT_LAUNCHER_ALIASES };
  for (const kind of LAUNCHER_SEARCH_KINDS) {
    const value = input?.[kind]?.trim().toLowerCase();
    if (value && ALIAS_PATTERN.test(value)) aliases[kind] = value;
  }
  return aliases;
}
export function launcherAliasCollisions(aliases: LauncherAliases): { alias: string; kinds: LauncherSearchKind[] }[] {
  const byAlias = new Map<string, LauncherSearchKind[]>();
  for (const kind of LAUNCHER_SEARCH_KINDS) byAlias.set(aliases[kind], [...(byAlias.get(aliases[kind]) ?? []), kind]);
  return [...byAlias].filter(([, kinds]) => kinds.length > 1).map(([alias, kinds]) => ({ alias, kinds }));
}

/**
 * Whether typing turned the start of the query into a category chip. Only an
 * exact alias followed by its delimiter counts: `f` alone, pasted prose and
 * text inside an active conversation stay ordinary text.
 */
export function activateCategoryAlias(raw: string, aliases: LauncherAliases, delimiter: "space" | "tab" = "space"): { category: LauncherSearchKind; rest: string } | null {
  const match = delimiter === "space" ? /^(\S+) ([\s\S]*)$/.exec(raw) : /^(\S+)$/.exec(raw);
  if (!match) return null;
  const kind = LAUNCHER_SEARCH_KINDS.find(kind => aliases[kind] === match[1].toLowerCase() || CATEGORY_WORDS[kind].includes(match[1].toLowerCase()));
  return kind ? { category: kind, rest: match[2] ?? "" } : null;
}

/** Commands start with `/`; `?` plus a space enters a conversation. Everything else searches. */
export function parseLauncherEntry(raw: string): ParsedLauncherEntry {
  if (raw.startsWith("/")) return { mode: "command", text: raw.slice(1) };
  if (/^\? /.test(raw)) return { mode: "ask", text: raw.slice(2) };
  if (raw === "?") return { mode: "ask", text: "" };
  return { mode: "search", text: raw };
}

/** A question-shaped search remains a search until the user chooses Ask. */
export function looksLikeQuestion(text: string) {
  return /\?\s*$/.test(text.trim()) || /^(wer|was|wann|wo|wie|warum|welche[rs]?|who|what|when|where|why|how|which)\b/i.test(text.trim());
}

import { isMap, isScalar, parseDocument } from "yaml";

export type WikiPropertyScalar = string | number | boolean | null;
export type WikiPropertyField = { key: string; value: WikiPropertyScalar; editable: boolean; source: string };

export function wikiFrontmatter(content: string) {
  const match = /^(\uFEFF?---\r?\n)([\s\S]*?)^((?:---|\.\.\.)(?:\r?\n|$))/m.exec(content);
  if (!match || match.index !== 0) return null;
  return { opening: match[1], yaml: match[2], closing: match[3], end: match[0].length };
}

function scalar(value: unknown): value is WikiPropertyScalar {
  return value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
}

export function wikiPropertyFields(content: string): { fields: WikiPropertyField[]; error: boolean } {
  const header = wikiFrontmatter(content);
  if (!header) return { fields: [], error: /^\uFEFF?---\r?\n/.test(content) };
  const document = parseDocument(header.yaml, { keepSourceTokens: true });
  if (document.errors.length || document.contents && !isMap(document.contents)) return { fields: [], error: true };
  if (!isMap(document.contents)) return { fields: [], error: false };
  const fields: WikiPropertyField[] = [];
  for (const pair of document.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
    const node = pair.value;
    const editable = isScalar(node) && scalar(node.value) && !node.anchor && !node.tag && node.type !== "BLOCK_LITERAL" && node.type !== "BLOCK_FOLDED";
    fields.push({ key: pair.key.value, value: editable && isScalar(node) && scalar(node.value) ? node.value : null, editable, source: node?.range ? header.yaml.slice(node.range[0], node.range[1]) : "" });
  }
  return { fields, error: false };
}

/** Replace only the selected scalar's source range, preserving comments and unknown YAML. */
export function setWikiProperty(content: string, key: string, value: WikiPropertyScalar): string {
  if (!key.trim() || /[\r\n\x00-\x1f]/.test(key) || !scalar(value)) throw new Error("Invalid property.");
  const header = wikiFrontmatter(content);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const encoded = JSON.stringify(value);
  const property = `${JSON.stringify(key)}: ${encoded}${newline}`;
  if (!header) {
    if (/^\uFEFF?---\r?\n/.test(content)) throw new Error("Repair the frontmatter in Source before editing properties.");
    return `---${newline}${property}---${newline}${newline}${content}`;
  }
  const document = parseDocument(header.yaml, { keepSourceTokens: true });
  if (document.errors.length || document.contents && !isMap(document.contents)) throw new Error("Repair the frontmatter in Source before editing properties.");
  const pair = isMap(document.contents) ? document.contents.items.find(pair => isScalar(pair.key) && pair.key.value === key) : undefined;
  let yaml: string;
  if (pair) {
    const node = pair.value;
    if (!isScalar(node) || !scalar(node.value) || node.anchor || node.tag || !node.range || node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED") throw new Error("Edit this complex property in Source.");
    const [start, end] = node.range;
    const spacer = start > 0 && header.yaml[start - 1] === ":" ? " " : "";
    yaml = header.yaml.slice(0, start) + spacer + encoded + header.yaml.slice(end);
  } else yaml = header.yaml + (header.yaml && !header.yaml.endsWith("\n") ? newline : "") + property;
  return header.opening + yaml + header.closing + content.slice(header.end);
}

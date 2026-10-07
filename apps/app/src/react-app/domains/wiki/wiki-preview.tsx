import { useEffect, useMemo, useRef } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import type { WikiPage } from "@legalwork/types/wiki";
import { openDesktopUrl } from "@/app/lib/desktop";
import { resolveWikiPage, wikiMarkdownBody } from "./wiki-model";
import "../session/artifacts/markdown-editor.css";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const parser = new Marked({ gfm: true, breaks: false, renderer: {
  checkbox(token) { return token.checked ? "☑ " : "☐ "; },
  image(token) { return `<img data-wiki-image="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}" loading="lazy" />`; },
} });
parser.use({ extensions: [{
  name: "wikilink", level: "inline",
  start: (source) => source.indexOf("[["),
  tokenizer(source) {
    const match = /^\[\[([^\]\n]+)\]\]/.exec(source);
    if (!match) return;
    const [target, label] = match[1].split("|");
    return { type: "wikilink", raw: match[0], target, label: label ?? target };
  },
  renderer(token) {
    return `<a href="wiki:${encodeURIComponent(String(token.target))}">${escapeHtml(String(token.label))}</a>`;
  },
}] });

export function renderWikiMarkdown(content: string) {
  return DOMPurify.sanitize(parser.parse(wikiMarkdownBody(content), { async: false }), {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|wiki):|[^a-z]|[a-z+.-]+(?:[^a-z+.:\-]|$))/i,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["style", "srcset", "src"],
  });
}

export function WikiPreview(props: {
  content: string;
  path: string;
  pages: WikiPage[];
  onOpen: (path: string) => void;
  onMissing: (target: string) => void;
  onAsset: (path: string) => void;
  imagePreview: (path: string) => Promise<string>;
}) {
  const element = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderWikiMarkdown(props.content), [props.content]);
  useEffect(() => {
    let cancelled = false;
    const images = element.current?.querySelectorAll("img");
    for (const img of images ?? []) {
      const source = img.getAttribute("data-wiki-image") ?? "";
      // Remote images need explicit user navigation; a wiki must not beacon its reader.
      img.removeAttribute("src");
      if (!source || /^[A-Za-z][A-Za-z0-9+.-]*:|^\/\//.test(source)) continue;
      void props.imagePreview(source).then((url) => { if (!cancelled) img.src = url; }).catch(() => { img.alt ||= source; });
    }
    return () => { cancelled = true; };
  }, [html, props.imagePreview]);

  return <div
    ref={element}
    className="lw-markdown-page wiki-preview"
    dangerouslySetInnerHTML={{ __html: html }}
    onClick={(event) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      if (/^https?:|^mailto:|^tel:/i.test(href)) { void openDesktopUrl(href); return; }
      if (href.startsWith("#")) { element.current?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: "smooth" }); return; }
      let target: string;
      try { target = decodeURIComponent(href.replace(/^wiki:/, "")); } catch { return; }
      const page = resolveWikiPage(props.pages, target, props.path);
      if (page) props.onOpen(page.path);
      else if (href.startsWith("wiki:") || /\.md(?:#.*)?$/i.test(href)) props.onMissing(target);
      else props.onAsset(target);
    }}
  />;
}

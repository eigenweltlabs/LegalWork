// Bundled into web-worker-code.ts so Node, Bun and the standalone server use
// the same parser without resolving packages or source files at runtime.
import { parentPort, workerData } from "node:worker_threads";
import TurndownService from "turndown";
const { content, format } = workerData;
const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const hidden = ["script", "style", "meta", "link", "iframe", "object", "embed"];
converter.remove(node => hidden.includes(node.nodeName.toLowerCase()));
if (format === "text") converter.addRule("plainText", { filter: () => true,
  replacement: (content, node) => hidden.includes(node.nodeName.toLowerCase()) ? "" : /^(?:P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|TR|BR|HR|SECTION|ARTICLE)$/.test(node.nodeName) ? `\n\n${content}\n\n` : content,
});
parentPort?.postMessage(converter.turndown(content));

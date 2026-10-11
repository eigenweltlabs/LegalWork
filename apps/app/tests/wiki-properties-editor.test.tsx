import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WikiPage } from "@legalwork/types/wiki";
import { setLocale } from "../src/i18n";
import { WikiPropertiesEditor } from "../src/react-app/domains/wiki/wiki-properties-editor";

const client: WikiPage = { path: "Clients/Alpha.md", title: "Alpha", type: "client", properties: {}, links: [], excerpt: "", revision: "a", updatedAt: 1 };
const noop = () => {};

test("properties are visible immediately with typed rows and inline list and page values", () => {
  setLocale("en");
  const html = renderToStaticMarkup(<WikiPropertiesEditor content={'---\ntype: entity\ntags: [competition, 2025]\nupdated: 2026-10-11\nactive: false\namount: 0\nclient: "[[Clients/Alpha.md]]"\nunknown: {nested: value}\n---\n# Page title\n'} pages={[client]} path="Current.md" onChange={noop} onSource={noop} onOpen={noop} />);
  expect(html).toContain('<section class="wiki-properties wiki-properties-editor"');
  expect(html).not.toContain("<details");
  expect(html).not.toContain("<h1");
  for (const type of ["text", "list", "date", "boolean", "number", "page", "complex"]) expect(html).toContain(`data-property-type="${type}"`);
  expect(html).toContain('type="date"');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('value="0"');
  expect(html).toContain('value="2025"');
  expect(html).toContain('class="wiki-property-chip"');
  expect(html).toContain("Alpha</span>");
  expect(html).toContain("Add property");
  expect(html).toContain("Edit in Source");
  expect(html).not.toContain("nested: value</button>");
});

test("invalid properties retain the visible source repair action", () => {
  setLocale("en");
  const html = renderToStaticMarkup(<WikiPropertiesEditor content={"---\ninvalid: [\n---\nBody"} pages={[]} path="Current.md" onChange={noop} onSource={noop} onOpen={noop} />);
  expect(html).toContain("Properties</h2>");
  expect(html).toContain("Edit in Source");
  expect(html).not.toContain('class="wiki-property-row"');
});

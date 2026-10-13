import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILT_IN_LEGALWORK_EXTENSION_MANIFESTS } from "../src/app/extensions";
import { ActaportConfig } from "../src/react-app/domains/settings/actaport-config";

test("Actaport is a bundled MCP extension with a dedicated setup form", () => {
  const entry = BUILT_IN_LEGALWORK_EXTENSION_MANIFESTS.find((item) => item.id === "actaport");
  expect(entry?.resources[0].localCommandRef).toBe("legalwork.actaportMcp");
  expect(entry?.resources[0].command?.join(" ")).not.toContain("npx");
  const html = renderToStaticMarkup(React.createElement(ActaportConfig));
  expect((html.match(/<input/g) ?? []).length).toBe(5);
  expect((html.match(/type="password"/g) ?? []).length).toBe(2);
  expect(html).toContain("Kanzlei-Alias");
  expect(html).toContain("API username");
  expect(html).toContain("API password");
  expect(html).toContain("API add-on");
  expect(html).not.toContain("ACTAPORT_CLIENT_SECRET");
});

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { McpView, type McpViewProps } from "../src/react-app/domains/settings/pages/mcp-view";
import type { McpDirectoryInfo } from "../src/app/constants";

const noop = () => {};
const attioUrl = "https://example.invalid/attio";
const attio: McpDirectoryInfo = { name: "Attio", serverName: "attio", description: "Manage your CRM", type: "remote", url: attioUrl, oauth: true, iconSlug: "attio" };
const available: McpDirectoryInfo = { name: "Directory-only tool", serverName: "directory-only", description: "Available to connect", oauth: false };
const native: McpDirectoryInfo = { name: "Built-in Browser", serverName: "browser", description: "Browse with LegalWork", kind: "extension", oauth: false };
const props: McpViewProps = {
  busy: false, selectedWorkspaceRoot: "/project", isRemoteWorkspace: false, showHeader: false,
  mcpServers: [
    { name: "paused", source: "config.remote", config: { type: "remote", url: "https://example.invalid/paused", enabled: false } },
    { name: "attio", source: "config.remote", config: { type: "remote", url: attioUrl, enabled: true } },
  ],
  mcpStatus: null, mcpLastUpdatedAt: null, mcpStatuses: { attio: { status: "connected" } }, mcpConnectingName: null, selectedMcp: null,
  setSelectedMcp: noop, quickConnect: [attio, available, native], connectMcp: noop, authorizeMcp: noop, logoutMcpAuth: noop, removeMcp: noop,
  setMcpEnabled: async () => {}, isExtensionConnected: entry => entry === native,
};

test("connector library leads with saved connectors and keeps available entries behind Browse directory", () => {
  const html = renderToStaticMarkup(<McpView {...props} />);
  expect(html).toContain("Browse directory");
  expect(html).toContain("Add own connector");
  expect(html).toContain("Your connectors");
  expect(html).toContain("Manage your CRM");
  expect(html).not.toContain("Directory-only tool");
  expect(html).not.toContain("Available connectors");
  expect(html.match(/Manage your CRM/g)).toHaveLength(1);
});

test("ready connectors and active built-ins come before paused connectors without losing paused settings", () => {
  const html = renderToStaticMarkup(<McpView {...props} />);
  expect(html.indexOf("Attio")).toBeLessThan(html.indexOf(">paused<"));
  expect(html.indexOf("Built-in Browser")).toBeLessThan(html.indexOf(">paused<"));
  expect(html).toContain('aria-label="Enable paused"');
  expect(html).toContain('aria-label="Disable Attio"');
  expect(html).toContain('aria-checked="false"');
  expect(html).toContain('aria-checked="true"');
});

test("empty library points to directory or own connector instead of rendering the catalog", () => {
  const html = renderToStaticMarkup(<McpView {...props} mcpServers={[]} isExtensionConnected={() => false} />);
  expect(html).toContain("Browse the directory or add your own connector");
  expect(html).not.toContain("Directory-only tool");
});

test("global config file connectors retain their existing read-only toggle behavior", () => {
  const html = renderToStaticMarkup(<McpView {...props} quickConnect={[]} mcpServers={[
    { name: "managed", source: "config.global", config: { type: "remote", url: "https://example.invalid/managed" } },
  ]} />);
  expect(html).toContain("managed");
  expect(html).not.toContain('role="switch"');
});

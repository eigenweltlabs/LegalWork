import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverConnectorImports } from "./connector-imports.js";
import { discoverPluginImports, parsePluginImportRequest, resolvePluginImports } from "./plugin-imports.js";
import { installPluginImport } from "./plugin-import-install.js";
import { removeCloudPlugin } from "./cloud-plugins.js";
import { GLOBAL_MCP_ID, readRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "legalwork-connector-import-"));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function write(path: string, config: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof config === "string" ? config : JSON.stringify(config));
}

test("discovers individual Claude user, local-project, project and Desktop connectors without returning credentials", async () => fixture(async home => {
  const workspace = join(home, "project");
  const configPath = join(home, ".claude.json");
  await write(configPath, { accountToken: "never-export", mcpServers: { search: { command: "node", args: ["search.js"], env: { TOKEN: "private-key" } } }, projects: {
    [workspace]: { mcpServers: { search: { type: "http", url: "https://project.example/mcp" } } },
    [join(home, "other")]: { mcpServers: { literature: { type: "http", url: "https://literature.example/mcp" } } },
  } });
  await write(join(workspace, ".mcp.json"), { mcpServers: { docket: { type: "http", url: "https://docket.example/mcp" } } });
  await write(join(home, "other/.mcp.json"), { mcpServers: { otherProject: { type: "http", url: "https://other.example/mcp" } } });
  await write(join(home, "Library/Application Support/Claude/claude_desktop_config.json"), { mcpServers: { desktop: { command: "npx", args: ["server"] } } });
  const items = await discoverConnectorImports("claude", workspace, home, join(home, ".codex"), join(home, ".claude"));
  expect(items).toHaveLength(6);
  expect(items.filter(item => item.name === "search")).toHaveLength(2);
  expect(items.find(item => item.name === "literature")?.connector?.project).toBe(join(home, "other"));
  expect(items.find(item => item.name === "desktop")?.description).toBe("Claude Desktop");
  expect(JSON.stringify(items)).not.toContain("private-key");
  expect(JSON.stringify(items)).not.toContain("never-export");
  const req = parsePluginImportRequest({ source: { provider: "claude", path: configPath, connector: { name: "search", project: workspace } }, scope: "global" });
  const [plan] = await resolvePluginImports(req, workspace);
  expect(plan!.preview.components.map(item => item.name)).toEqual(["search"]);
  expect(JSON.stringify(plan!.resolved)).toContain("https://project.example/mcp");
  expect(JSON.stringify(plan!.resourceFiles.map(file => Buffer.from(file.bytes).toString()))).not.toContain("private-key");
}));

test("discovers custom Codex config and current-project TOML alongside existing plugins", async () => fixture(async home => {
  const previous = new Map(["LEGALWORK_PLUGIN_DISCOVERY_HOME", "CODEX_HOME"].map(key => [key, process.env[key]]));
  const codex = join(home, "custom-codex");
  const workspace = join(home, "project");
  const knownProject = join(home, "other-project");
  try {
    process.env.LEGALWORK_PLUGIN_DISCOVERY_HOME = home;
    process.env.CODEX_HOME = codex;
    await write(join(codex, "config.toml"), `[projects.${JSON.stringify(knownProject)}]\ntrust_level = "trusted"\n[mcp_servers.patent_search]\ncommand = "node"\nargs = ["search.js"]\n[mcp_servers.patent_search.env]\nKEY = "keep-local"\n`);
    await write(join(workspace, ".codex/config.toml"), '[mcp_servers.literature]\nurl = "https://literature.example/mcp"\n');
    await write(join(knownProject, ".codex/config.toml"), '[mcp_servers.docket]\nurl = "https://docket.example/mcp"\n');
    await write(join(codex, "plugins/patent/.codex-plugin/plugin.json"), { name: "patent" });
    const items = await discoverPluginImports("chatgpt", workspace);
    expect(items.map(item => item.name).sort()).toEqual(["docket", "literature", "patent", "patent_search"]);
    expect(items.filter(item => item.kind === "connector")).toHaveLength(3);
    expect(JSON.stringify(items)).not.toContain("keep-local");
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}));

test("maps Codex environment and HTTP authentication fields without reading environment secrets", async () => fixture(async root => {
  const configPath = join(root, "config.toml");
  await write(configPath, '[mcp_servers.search]\nurl = "https://search.example/mcp"\nbearer_token_env_var = "IMPORT_TOKEN"\nenabled_tools = ["search"]\ntool_timeout_sec = 30\nhttp_headers = { "X-Region" = "eu" }\nenv_http_headers = { "X-Key" = "IMPORT_KEY" }\n[mcp_servers.search.oauth]\nclient_id = "registered-client"\n[mcp_servers.local]\ncommand = "node"\nargs = ["server.js", "argument with spaces"]\nenv_vars = ["IMPORT_TOKEN"]\n[mcp_servers.local.env]\nFIXED = "literal"\n');
  const request = { source: { provider: "chatgpt", path: configPath, connector: { name: "search" } }, scope: "global" } satisfies Parameters<typeof resolvePluginImports>[0];
  const [remote] = await resolvePluginImports(request, root);
  const text = JSON.stringify(remote!.resolved);
  expect(text).toContain('"Authorization":"Bearer ${IMPORT_TOKEN}"');
  expect(text).toContain('"X-Key":"${IMPORT_KEY}"');
  expect(text).toContain('"X-Region":"eu"');
  expect(text).toContain('"clientId":"registered-client"');
  expect(text).toContain('"enabled":false');
  expect(remote!.preview.format).toBe("connectors");
  expect(remote!.resolved.plugin.sourceKind).toBe("connector");
  expect(remote!.preview.warnings.some(warning => warning.includes("tool filters"))).toBe(true);
  const [local] = await resolvePluginImports({ ...request, source: { ...request.source, connector: { name: "local" } } }, root);
  expect(JSON.stringify(local!.resolved)).toContain('"args":["server.js","argument with spaces"]');
  expect(JSON.stringify(local!.resolved)).toContain('"IMPORT_TOKEN":"${IMPORT_TOKEN}"');
  expect(JSON.stringify(local!.resolved)).toContain('"FIXED":"literal"');
}));

test("imports only a selected connector, replaces it, prunes its old entry and removes it globally", async () => fixture(async root => {
  const previous = new Map(["LEGALWORK_RUNTIME_DB", "XDG_CONFIG_HOME"].map(key => [key, process.env[key]]));
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.XDG_CONFIG_HOME = join(root, "global");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "test", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], workspaces: [{ id: "test", name: "Test", path: root, preset: "starter", workspaceType: "local" }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  const sourcePath = join(root, ".claude.json");
  const req = parsePluginImportRequest({ source: { provider: "claude", path: sourcePath, connector: { name: "docket" } }, scope: "global" });
  try {
    await write(sourcePath, { account: "do-not-copy", mcpServers: { docket: { url: "https://docket.example/mcp", headers: { "X-Key": "selected-key" } }, private: { url: "https://other.example/mcp", headers: { "X-Key": "other-key" } } } });
    const [before] = await resolvePluginImports(req, root);
    const originalText = await readFile(sourcePath, "utf8");
    const resources = before!.resourceFiles.map(file => Buffer.from(file.bytes).toString()).join("\n");
    expect(resources).toContain("selected-key");
    expect(resources).not.toContain("other-key");
    expect(resources).not.toContain("do-not-copy");
    await installPluginImport(config, "test", root, before!, true);
    expect(await readFile(sourcePath, "utf8")).toBe(originalText);
    const installedName = before!.preview.components[0]!.installedName;
    expect((await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.[installedName]).toMatchObject({ url: "https://docket.example/mcp", enabled: false, headers: { "X-Key": "selected-key" } });
    await write(sourcePath, { mcpServers: { docket: { command: "node", args: ["new.js"], env: { FIXED: "value" } } } });
    const [after] = await resolvePluginImports(req, root);
    expect(after!.preview.id).toBe(before!.preview.id);
    expect(after!.preview.digest).not.toBe(before!.preview.digest);
    expect(after!.preview.components[0]!.installedName).toBe(installedName);
    await installPluginImport(config, "test", root, after!, true);
    expect((await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.[installedName]).toMatchObject({ type: "local", command: ["node", "new.js"], enabled: false });
    await removeCloudPlugin({ serverConfig: config, workspaceId: "test", workspaceRoot: root, pluginId: after!.preview.id, scope: "global" });
    expect((await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.[installedName]).toBeUndefined();
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}));

test("malformed configurations and links do not hide valid sources, and missing selectors cannot access inherited properties", async () => fixture(async home => {
  const workspace = join(home, "project");
  await write(join(home, ".claude.json"), "{malformed");
  await write(join(workspace, ".mcp.json"), { mcpServers: { valid: { url: "https://example.com/mcp" } } });
  const linked = join(home, ".claude/.claude.json");
  await mkdir(dirname(linked), { recursive: true });
  await symlink(join(workspace, ".mcp.json"), linked);
  expect((await discoverConnectorImports("claude", workspace, home, join(home, ".codex"), join(home, ".claude"))).map(item => item.name)).toEqual(["valid"]);
  const request = { source: { provider: "claude", path: linked, connector: { name: "valid" } }, scope: "global" } satisfies Parameters<typeof resolvePluginImports>[0];
  await expect(resolvePluginImports(request, workspace)).rejects.toThrow("Could not read");
  await expect(resolvePluginImports({ ...request, source: { ...request.source, path: join(workspace, ".mcp.json"), connector: { name: "__proto__" } } }, workspace)).rejects.toThrow("no longer");
  expect(() => parsePluginImportRequest({ source: { provider: "claude", zipBase64: "UEs=", connector: { name: "valid" } }, scope: "global" })).toThrow();
}));

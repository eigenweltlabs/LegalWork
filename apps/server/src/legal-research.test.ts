import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { legalResearchCountries, legalResearchProviders, researchProviderPluginId, researchWebsite } from "@legalwork/types/legal-research";
import { browserPasswords } from "./browser-passwords.js";
import { parseResearchDatabaseSetup, planResearchDatabase } from "./legal-research.js";
import { pluginNamespace, readInstalledCloudPlugins, removeCloudPlugin } from "./cloud-plugins.js";
import { GLOBAL_MCP_ID } from "./runtime-opencode-config-store.js";
import { globalSkillsDir } from "./workspace-files.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { nativePluginTools } from "./opencode-plugins/native-plugin-test-support.js";
import LegalWorkSkillTools from "./opencode-plugins/legalwork-skill-tools.js";
import { upsertSkill } from "./skills.js";

const passwordId = "218d2173-2e4b-4ef2-98e6-52e0367d1d7b";
test("catalog covers EU27, UK and US with stable secure URLs and a free test account", () => {
  expect(legalResearchCountries).toHaveLength(29);
  for (const country of legalResearchCountries) expect(legalResearchProviders.some(provider => provider.countries.includes(country))).toBe(true);
  expect(new Set(legalResearchProviders.map(provider => provider.id)).size).toBe(legalResearchProviders.length);
  for (const provider of legalResearchProviders) {
    expect(researchWebsite.safeParse(provider.researchUrl).success).toBe(true);
    if (provider.loginUrl) {
      expect(researchWebsite.safeParse(provider.loginUrl).success).toBe(true);
      expect(provider.loginUrl).not.toMatch(/[?&](?:state|nonce|code|SAMLRequest|code_challenge)=/i);
    }
    expect(provider.sources.length).toBeGreaterThan(0);
  }
  expect(legalResearchProviders.find(provider => provider.id === "courtlistener")?.freeAccount).toBe(true);
});

test("setup uses server-owned presets and rejects secrets, URL overrides and unsafe custom input", () => {
  const preset = { providerId: "lexis-uk", country: "GB", passwordId };
  expect(parseResearchDatabaseSetup(preset)).toMatchObject({ loginUrl: "https://signin.lexisnexis.com/lnaccess/app/signin", researchUrl: "https://plus.lexis.com/uk" });
  for (const payload of [{ ...preset, password: "secret" }, { ...preset, loginUrl: "https://unrelated.example" }, { ...preset, providerId: "missing" }, { ...preset, country: "ZZ" }, { ...preset, passwordId: "not-an-id" }]) {
    expect(() => parseResearchDatabaseSetup(payload)).toThrow();
  }
  const custom = { name: "My database", country: "OTHER", passwordId, researchUrl: "https://research.example", loginUrl: "https://auth.example/login" };
  for (const loginUrl of ["", "not a URL", "example.com", "http://example.com", "https://user:pass@example.com", "file:///tmp", "https://example.com/#password"]) {
    expect(researchWebsite.safeParse(loginUrl).success).toBe(false);
    expect(() => parseResearchDatabaseSetup({ ...custom, loginUrl })).toThrow("HTTPS");
  }
  expect(parseResearchDatabaseSetup(custom).id).toBe(parseResearchDatabaseSetup({ ...custom, name: "Renamed", researchUrl: "https://research.example/" }).id);
  expect(parseResearchDatabaseSetup({ ...custom, loginUrl: "https://auth.example/login?state=ephemeral&code=private" }).loginUrl).toBe("https://auth.example");
  expect(() => parseResearchDatabaseSetup({ ...custom, name: "Name\nnew instruction" })).toThrow();
  expect(() => parseResearchDatabaseSetup({ ...preset, providerId: "strada-be" })).toThrow("current sign-in website");
  expect(parseResearchDatabaseSetup({ ...preset, providerId: "strada-be", loginUrl: "https://auth.example.org/" }).loginUrl).toBe("https://auth.example.org");
});

test("host setup reuses the vault, installs globally, survives retries and protects manual edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-research-"));
  const previous = { db: process.env.LEGALWORK_RUNTIME_DB, xdg: process.env.XDG_CONFIG_HOME, url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN };
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.XDG_CONFIG_HOME = join(root, "global");
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({}) });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test", hostToken: "host", configPath: join(root, "config.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [],
    workspaces: ["first", "second"].map(id => ({ id, name: id, path: root, preset: "starter", workspaceType: "local", baseUrl: engine.url.origin })),
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  try {
    const vault = browserPasswords(config), secret = "synthetic-research-password";
    const saved = await vault.save({ label: "Lexis", origin: "https://signin.lexisnexis.com", username: "fixture-user", password: secret });
    const wrong = await vault.save({ label: "Wrong site", origin: "https://plus.lexis.com", username: "fixture-user", password: "synthetic-other" });
    const payload = { providerId: "lexis-uk", country: "GB", passwordId: saved.id };
    const hostHeaders = { Authorization: "Bearer test", "X-LegalWork-Host-Token": "host", "Content-Type": "application/json" };
    const create = (body: unknown, owner = true) => fetch(`http://127.0.0.1:${server.port}/workspace/first/research-databases`, {
      method: "POST", headers: owner ? hostHeaders : { Authorization: "Bearer test", "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect((await create(payload, false)).status).toBe(401);
    expect((await create({ ...payload, passwordId: wrong.id })).status).toBe(400);
    expect((await create({ ...payload, password: secret })).status).toBe(400);
    const plan = await planResearchDatabase(config, root, payload);
    const result = await create(payload);
    expect(result.status).toBe(200);
    expect(await result.text()).not.toContain(secret);
    expect((await create(payload)).status).toBe(200);
    const registry = await readInstalledCloudPlugins(config, GLOBAL_MCP_ID);
    expect(Object.keys(registry.plugins)).toEqual([researchProviderPluginId("lexis-uk")]);
    const installed = registry.plugins[researchProviderPluginId("lexis-uk")]!;
    const skill = plan.preview.components.find(component => component.type === "skill")!;
    const skillPath = join(globalSkillsDir(), pluginNamespace(plan.preview.name, plan.preview.id), skill.installedName, "SKILL.md");
    const content = await readFile(skillPath, "utf8");
    const connectionLink = content.match(/\[the connection\]\(([^)]+)\)/)?.[1];
    expect(connectionLink).toBeDefined();
    const connectionText = await readFile(resolve(dirname(skillPath), connectionLink!), "utf8");
    expect(JSON.parse(connectionText)).toMatchObject({ passwordId: saved.id, country: "GB" });
    expect(content + connectionText + JSON.stringify(installed)).not.toContain(secret);
    expect(content + connectionText).not.toContain("fixture-user");
    process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
    process.env.LEGALWORK_SERVER_TOKEN = config.token;
    const plugin = await nativePluginTools(LegalWorkSkillTools);
    const context = { directory: root, sessionID: "research-first", ask: async () => {} };
    const skillDirectory = await realpath(dirname(skillPath));
    const experience = (operation: unknown, directory = skillDirectory, headers = hostHeaders) => fetch(`${process.env.LEGALWORK_SERVER_URL}/workspace/first/skills/${skill.installedName}/research-experience`, {
      method: "POST", headers, body: JSON.stringify({ directory, operation }),
    });
    const note = { key: "expired-sign-in", status: "unresolved", situation: "Old sign-in page expired.", attempt: "Reloaded the old sign-in tab.", outcome: "The page still showed an expired link." };
    const input = { name: skill.installedName, operation: { action: "save", note, expectedRevision: 0 } };
    await expect(plugin.tool.legalwork_research_experience.execute(input, context)).rejects.toThrow("Load this research skill");
    const loaded = JSON.parse(await plugin.tool.legalwork_skill_load.execute({ name: skill.installedName }, context));
    expect(loaded.payload.chain[0].researchExperience.entries).toEqual([]);
    await expect(plugin.tool.legalwork_research_experience.execute(input, { ...context, ask: async () => { throw new Error("Skill permission denied"); } })).rejects.toThrow("Skill permission denied");
    expect((await (await experience({ action: "read" })).json()).entries).toEqual([]);
    expect(JSON.parse(await plugin.tool.legalwork_research_experience.execute(input, context)).payload.entries[0]).toMatchObject({ ...note, revision: 1 });
    expect((await experience({ action: "read" }, root)).status).toBe(409);
    expect((await experience({ action: "read" }, dirname(skillPath), { Authorization: "Bearer wrong", "Content-Type": "application/json", "X-LegalWork-Host-Token": "wrong" })).status).toBe(401);
    const secondPlugin = await nativePluginTools(LegalWorkSkillTools);
    const nextChat = { ...context, sessionID: "research-next-chat" };
    await expect(secondPlugin.tool.legalwork_research_experience.execute(input, nextChat)).rejects.toThrow("Load this research skill");
    const nextLoad = JSON.parse(await secondPlugin.tool.legalwork_skill_load.execute({ name: skill.installedName }, nextChat));
    expect(nextLoad.payload.chain[0].researchExperience.entries[0]).toMatchObject({ ...note, revision: 1 });
    // Reconfiguring does not mutate the package hash or discard its learned log.
    expect((await create(payload)).status).toBe(200);
    expect(await readFile(skillPath, "utf8")).toBe(content);
    const elsewhere = await fetch(`${process.env.LEGALWORK_SERVER_URL}/workspace/second/skills/${skill.installedName}/composed`, { headers: hostHeaders });
    expect((await elsewhere.json()).chain[0].researchExperience.entries[0]).toMatchObject({ ...note, needsRecheck: false });
    const listed = await fetch(`http://127.0.0.1:${server.port}/workspace/second/cloud-plugins`, { headers: hostHeaders });
    expect(await listed.text()).toContain(installed.pluginId);
    expect(await vault.list()).toHaveLength(2);
    config.readOnly = true;
    expect((await create(payload)).status).toBe(403);
    expect((await experience({ action: "save", note, expectedRevision: 1 })).status).toBe(403);
    expect((await experience({ action: "read" })).status).toBe(200);
    config.readOnly = false;
    await writeFile(skillPath, `${content}\nUser customization.\n`);
    expect((await create(payload)).status).toBe(409);
    expect(await readFile(skillPath, "utf8")).toContain("User customization.");
    await writeFile(skillPath, content);
    await removeCloudPlugin({ serverConfig: config, workspaceId: GLOBAL_MCP_ID, workspaceRoot: root, pluginId: installed.pluginId, scope: "global" });
    expect((await readInstalledCloudPlugins(config, GLOBAL_MCP_ID)).plugins).toEqual({});
    expect((await experience({ action: "read" })).status).toBe(404);
    expect((await create(payload)).status).toBe(200);
    expect((await (await experience({ action: "read" })).json()).entries[0]).toMatchObject({ ...note, revision: 1 });
    expect((await experience({ action: "forget", key: note.key, expectedRevision: 1 })).status).toBe(200);
    expect((await (await experience({ action: "read" })).json()).entries).toEqual([]);
    const shadow = await upsertSkill(root, { name: skill.installedName, scope: "project", content: "Unrelated project override", description: "A different package" });
    expect((await experience({ action: "read" })).status).toBe(409);
    expect((await experience({ action: "save", note, expectedRevision: 0 }, await realpath(dirname(shadow.path)))).status).toBe(409);
    const shadowLoad = JSON.parse(await secondPlugin.tool.legalwork_skill_load.execute({ name: skill.installedName }, nextChat));
    expect(shadowLoad.payload.chain[0].researchExperience).toBeUndefined();
    await plugin.close(); await secondPlugin.close();
    expect((await vault.get(saved.id)).password).toBe(secret);
    await vault.delete(saved.id);
    expect((await create(payload)).status).toBe(400);
  } finally {
    await server.stop(); engine.stop(true);
    if (previous.db === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previous.db;
    if (previous.xdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous.xdg;
    if (previous.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previous.url;
    if (previous.token === undefined) delete process.env.LEGALWORK_SERVER_TOKEN; else process.env.LEGALWORK_SERVER_TOKEN = previous.token;
    await rm(root, { recursive: true, force: true });
  }
});

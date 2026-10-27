import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode, type JsonValue } from "@opencode/client";
import { createManagedOpencodeServer } from "./managed-opencode.js";
import { legalworkMandatoryRuntimeConfigContent, legalworkRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "./legalwork-runtime-config.js";
import { orgPolicyEngineDir } from "./org-policy-engine.js";
import { closeRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const rpc = { id: "fixture.managed-files", methods: { run: {
  input: { type: "object", properties: { sessionID: { type: "string" }, tool: { type: "string" }, input: { type: "object" } }, required: ["sessionID", "tool", "input"] },
  output: { type: "string" },
} }, events: {} };

test.skipIf(!binary).each([false, true])("real managed file tools enforce project folder approvals (Git ancestor: %s)", async git => {
  // Keep this outside the checkout: native file tools also consider the
  // surrounding Git worktree internal, which would hide a missing default.
  const root = await realpath(await mkdtemp(join(tmpdir(), "legalwork-managed-files-")));
  const previous = { ...process.env }, a = join(root, "a"), b = join(root, "b"), added = join(root, "added"), outside = join(root, "outside");
  const library = join(root, "library", "opencode"), probe = join(library, "plugins", "file-probe");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    managedEngineStorageDirectory: join(root, "private"), engineConfigurationMode: "managed", engineProjectTrustRequired: true,
    workspaces: [a, b].map((path, index) => ({ id: index ? "b" : "a", name: "Matter", path, preset: "starter", workspaceType: "local" })),
    authorizedRoots: [a, b], approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  let server: Awaited<ReturnType<typeof startServer>> | undefined, engine: Awaited<ReturnType<typeof createManagedOpencodeServer>> | undefined;
  try {
    process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
    process.env.XDG_CONFIG_HOME = join(root, "library");
    for (const directory of [a, b, added, outside, probe, join(library, "agents")]) await mkdir(directory, { recursive: true });
    if (git) {
      const child = Bun.spawn(["git", "init", "--quiet", root], { stdout: "pipe", stderr: "pipe" });
      expect(await child.exited).toBe(0);
    }
    await writeFile(join(a, "inside.txt"), "project-readable");
    await writeFile(join(a, ".env"), "protected-project-secret");
    await writeFile(join(a, ".env.example"), "safe-example");
    await writeFile(join(a, "target.env"), "sensitive-symlink-target");
    await symlink(join(a, "target.env"), join(a, "source.env"), "file");
    await writeFile(join(added, "added.txt"), "approved-folder-content");
    const external = join(outside, "private.txt");
    await writeFile(external, "private-outside-content");
    await symlink(external, join(added, "linked.txt"), "file");
    await writeFile(join(library, "agents", "helper.md"), "---\ndescription: File fixture helper\nmode: subagent\n---\nRead approved files.\n");
    for (const effect of ["ask", "deny"]) await writeFile(join(library, "agents", `helper-${effect}.md`),
      `---\nmode: subagent\npermissions: ${JSON.stringify([{ action: "external_directory", resource: join(added, "*").replaceAll("\\", "/"), effect }])}\n---\nKeep the explicit folder restriction.\n`);
    await writeFile(join(probe, "index.js"), `import {Plugin} from '@opencode/plugin';
      export default Plugin.define({id:'fixture.managed-files',async setup(ctx){const outcomes=new Map();
        await ctx.rpc.register(${JSON.stringify(rpc)},{async run(input){
          if(input.tool==='result')return outcomes.get(input.sessionID)||'pending';
          if(input.tool==='verified-output-read'){await ctx.permission.assert({sessionID:input.sessionID,agent:'legalwork',action:'read',resources:[input.input.path],metadata:{legalworkVerifiedToolOutput:true}});return 'verified'}
          if(input.tool==='start-upload-read'){outcomes.set(input.sessionID,'pending');void ctx.permission.assert({sessionID:input.sessionID,agent:'legalwork',action:'read',resources:[input.input.path],metadata:{browserUpload:true}}).then(()=>outcomes.set(input.sessionID,'authorized'),()=>outcomes.set(input.sessionID,'rejected'));return 'started'}
          const session=await ctx.session.get({sessionID:input.sessionID});
          const tool=(await ctx.tool.list()).find(tool=>tool.name===input.tool.replace(/^start-/,''));
          if(!tool)throw new Error('Missing file tool');
          const execute=()=>tool.execute(input.input,{sessionID:input.sessionID,agent:session.agent||'legalwork',messageID:'msg_managed_files',id:'call_managed_files',signal:new AbortController().signal,progress:async()=>{}});
          if(input.tool.startsWith('start-')){outcomes.set(input.sessionID,'pending');void execute().then(value=>outcomes.set(input.sessionID,JSON.stringify(value)),()=>outcomes.set(input.sessionID,'rejected'));return 'started'}
          return JSON.stringify(await execute());
        }})}});`);
    await writeRuntimeOpencodeConfig(config, "a", () => ({ permission: { external_directory: { [join(added, "*")]: "allow" } } }));
    await writeLegalworkRuntimeConfigFile(config, "a");
    server = await startServer(config);
    const serverPort = server.port;
    const start = async () => createManagedOpencodeServer({ bin: binary, cwd: a, timeoutMs: 30_000, env: {
      HOME: join(root, "home"), USERPROFILE: join(root, "home"), XDG_CONFIG_HOME: join(root, "engine-config"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"),
      OPENCODE_CONFIG_DIR: orgPolicyEngineDir(config), OPENCODE_CONFIG: legalworkRuntimeConfigFilePath(config), OPENCODE_CONFIG_CONTENT: await legalworkMandatoryRuntimeConfigContent(config),
      OPENCODE_DB: join(root, "engine.db"), OPENCODE_CONFIG_PROJECT_DISABLE: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
      LEGALWORK_SERVER_URL: `http://127.0.0.1:${serverPort}`, LEGALWORK_SERVER_TOKEN: config.token,
    } });
    engine = await start();
    config.opencodeBaseUrl = engine.url; config.opencodeUsername = engine.username; config.opencodePassword = engine.password;
    const connect = () => {
      if (!engine) throw new Error("Fixture engine is not running");
      return OpenCode.make({ baseUrl: engine.url, headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
    };
    let client = connect();
    const location = { directory: a }, otherLocation = { directory: b };
    const invoke = (sessionID: string, tool: string, input: Record<string, JsonValue>, target = location) => client.rpc.call({ rpcID: rpc.id, method: "run", input: { sessionID, tool, input }, location: target }, { signal: AbortSignal.timeout(10_000) }).catch(error => { throw new Error(`${tool} ${JSON.stringify(input)} failed`, { cause: error }); });
    const waitForOutcome = async (sessionID: string, target = location) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = (await invoke(sessionID, "result", {}, target)).output;
        if (result !== "pending") return result;
        await Bun.sleep(10);
      }
      throw new Error("File permission did not settle");
    };
    const pending = async (sessionID: string, target = location) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const request = (await client.permission.list({ sessionID })).find(request => request.sessionID === sessionID);
        if (request) { expect((await invoke(sessionID, "result", {}, target)).output).toBe("pending"); return request; }
        await Bun.sleep(10);
      }
      throw new Error("No folder permission was requested");
    };
    for (const agent of ["legalwork", "explore", "helper"]) {
      const session = await client.session.create({ location, agent });
      expect((await invoke(session.id, "read", { path: join(a, "inside.txt") })).output).toContain("project-readable");
      expect((await invoke(session.id, "read", { path: join(added, "added.txt") })).output).toContain("approved-folder-content");
      expect((await invoke(session.id, "start-glob", { path: outside, pattern: "*" })).output).toBe("started");
      const request = await pending(session.id);
      expect(request.action).toBe("external_directory");
      expect(request.resources).toEqual([join(outside, "*").replaceAll("\\", "/")]);
      await client.permission.reply({ sessionID: session.id, requestID: request.id, decision: "reject" });
      expect(await waitForOutcome(session.id)).toBe("rejected");
    }
    const approved = await client.session.create({ location, agent: "legalwork" });
    await invoke(approved.id, "start-read", { path: external });
    const request = await pending(approved.id);
    expect(request.action).toBe("external_directory");
    await client.permission.reply({ sessionID: approved.id, requestID: request.id, decision: "once" });
    expect(await waitForOutcome(approved.id)).toContain("private-outside-content");
    const deniedHelper = await client.session.create({ location, agent: "helper-deny" });
    await expect(invoke(deniedHelper.id, "read", { path: join(added, "added.txt") })).rejects.toThrow();
    const askingHelper = await client.session.create({ location, agent: "helper-ask" });
    await invoke(askingHelper.id, "start-read", { path: join(added, "added.txt") });
    const helperRequest = await pending(askingHelper.id);
    await client.permission.reply({ sessionID: askingHelper.id, requestID: helperRequest.id, decision: "reject" });
    expect(await waitForOutcome(askingHelper.id)).toBe("rejected");
    const directoryRead = await client.session.create({ location, agent: "legalwork" });
    await invoke(directoryRead.id, "start-read", { path: outside });
    const directoryRequest = await pending(directoryRead.id);
    expect(directoryRequest.resources).toEqual([join(outside, "*").replaceAll("\\", "/")]);
    await client.permission.reply({ sessionID: directoryRead.id, requestID: directoryRequest.id, decision: "reject" });
    expect(await waitForOutcome(directoryRead.id)).toBe("rejected");
    const deniedWrite = await client.session.create({ location, agent: "legalwork" });
    await invoke(deniedWrite.id, "start-write", { path: external, content: "escaped" });
    const writing = await pending(deniedWrite.id);
    await client.permission.reply({ sessionID: deniedWrite.id, requestID: writing.id, decision: "reject" });
    expect(await waitForOutcome(deniedWrite.id)).toBe("rejected");
    expect(await readFile(external, "utf8")).toBe("private-outside-content");
    const other = await client.session.create({ location: otherLocation, agent: "legalwork" });
    await invoke(other.id, "start-read", { path: join(added, "added.txt") }, otherLocation);
    const unshared = await pending(other.id, otherLocation);
    expect(unshared.action).toBe("external_directory");
    await client.permission.reply({ sessionID: other.id, requestID: unshared.id, decision: "reject" });
    expect(await waitForOutcome(other.id, otherLocation)).toBe("rejected");
    const env = await client.session.create({ location, agent: "legalwork" });
    expect((await invoke(env.id, "read", { path: join(a, ".env.example") })).output).toContain("safe-example");
    await invoke(env.id, "start-read", { path: join(a, ".env") });
    const sensitive = await pending(env.id);
    expect(sensitive.action).toBe("read");
    await client.permission.reply({ sessionID: env.id, requestID: sensitive.id, decision: "reject" });
    expect(await waitForOutcome(env.id)).toBe("rejected");
    const sensitiveAlias = await client.session.create({ location, agent: "legalwork" });
    await invoke(sensitiveAlias.id, "start-read", { path: join(a, "source.env") });
    const aliasSensitiveRequest = await pending(sensitiveAlias.id);
    expect(aliasSensitiveRequest.action).toBe("read");
    expect(aliasSensitiveRequest.resources).toContain(join(a, "target.env"));
    await client.permission.reply({ sessionID: sensitiveAlias.id, requestID: aliasSensitiveRequest.id, decision: "once" });
    expect(await waitForOutcome(sensitiveAlias.id)).toContain("sensitive-symlink-target");
    expect(await client.permission.list({ sessionID: sensitiveAlias.id })).toEqual([]);
    const savedResult = join(outside, "saved-result.txt");
    await writeFile(savedResult, "verified-private-output");
    await symlink(savedResult, join(added, "saved-result.txt"), "file");
    const verifiedOutput = await client.session.create({ location, agent: "legalwork" });
    expect((await invoke(verifiedOutput.id, "verified-output-read", { path: join(added, "saved-result.txt") })).output).toBe("verified");
    expect(await client.permission.list({ sessionID: verifiedOutput.id })).toEqual([]);
    const upload = await client.session.create({ location, agent: "legalwork" });
    await invoke(upload.id, "start-upload-read", { path: external });
    const uploadRequest = await pending(upload.id);
    expect(uploadRequest.action).toBe("external_directory");
    expect(uploadRequest.resources).toEqual([join(outside, "*").replaceAll("\\", "/")]);
    await client.permission.reply({ sessionID: upload.id, requestID: uploadRequest.id, decision: "reject" });
    expect(await waitForOutcome(upload.id)).toBe("rejected");
    const alias = await client.session.create({ location, agent: "legalwork" });
    await invoke(alias.id, "start-read", { path: join(added, "linked.txt") });
    const escaped = await pending(alias.id);
    expect(escaped.resources).toEqual([join(outside, "*").replaceAll("\\", "/")]);
    await client.permission.reply({ sessionID: alias.id, requestID: escaped.id, decision: "reject" });
    expect(await waitForOutcome(alias.id)).toBe("rejected");
    // Exercise the actual app reply route. Native Git-project-wide "always"
    // must become an exact LegalWork-project grant, effective on the next tool.
    const shadowed = join(root, "shadowed");
    await mkdir(shadowed); await writeFile(join(shadowed, "private.txt"), "unrelated-shadowed-content");
    const restricted = join(outside, "restricted");
    const wildcardRestricted = join(outside, "wildcard-restricted");
    await mkdir(restricted); await mkdir(wildcardRestricted);
    await writeFile(join(restricted, "private.txt"), "restricted-child-content");
    await writeFile(join(wildcardRestricted, "private.txt"), "wildcard-restricted-child-content");
    await writeRuntimeOpencodeConfig(config, "a", () => ({ permission: { external_directory: {
      [join(shadowed, "*")]: "allow", [join(outside, "*")]: "ask", "*": "ask", [join(added, "*")]: "allow", [join(restricted, "*")]: "deny", "*/wildcard-restricted/*": "deny",
    } } }));
    await writeLegalworkRuntimeConfigFile(config, "a");
    const remembered = await client.session.create({ location, agent: "legalwork" });
    await invoke(remembered.id, "start-read", { path: external });
    const remembering = await pending(remembered.id);
    const reply = await fetch(`http://127.0.0.1:${server.port}/workspace/a/opencode/api/session/${remembered.id}/permission/${remembering.id}/reply`, {
      method: "POST", headers: { authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ decision: "always" }),
    });
    expect(reply.status, await reply.text()).toBe(204);
    expect(await waitForOutcome(remembered.id)).toContain("private-outside-content");
    expect((await invoke(remembered.id, "read", { path: external })).output).toContain("private-outside-content");
    await invoke(remembered.id, "start-read", { path: join(shadowed, "private.txt") });
    const shadowedRequest = await pending(remembered.id);
    expect(shadowedRequest.action).toBe("external_directory");
    await client.permission.reply({ sessionID: remembered.id, requestID: shadowedRequest.id, decision: "reject" });
    expect(await waitForOutcome(remembered.id)).toBe("rejected");
    await expect(invoke(remembered.id, "read", { path: join(restricted, "private.txt") })).rejects.toThrow();
    await expect(invoke(remembered.id, "read", { path: join(wildcardRestricted, "private.txt") })).rejects.toThrow();
    expect((await invoke(remembered.id, "read", { path: join(added, "linked.txt") })).output).toContain("private-outside-content");
    const next = await client.session.create({ location, agent: "helper" });
    expect((await invoke(next.id, "read", { path: external })).output).toContain("private-outside-content");
    await engine.close();
    engine = await start();
    config.opencodeBaseUrl = engine.url; config.opencodeUsername = engine.username; config.opencodePassword = engine.password;
    client = connect();
    expect((await invoke(remembered.id, "read", { path: external })).output).toContain("private-outside-content");
    const aliasDirectory = join(root, "outside-alias");
    await symlink(outside, aliasDirectory, process.platform === "win32" ? "junction" : "dir");
    if (!git) {
      await invoke(remembered.id, "start-read", { path: join(aliasDirectory, "private.txt") });
      const aliasApproval = await pending(remembered.id);
      expect(aliasApproval.message).toContain(outside);
      const aliasReply = await fetch(`http://127.0.0.1:${serverPort}/workspace/a/opencode/api/session/${remembered.id}/permission/${aliasApproval.id}/reply`, {
        method: "POST", headers: { authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ decision: "always" }),
      });
      expect(aliasReply.status, await aliasReply.text()).toBe(204);
      expect(await waitForOutcome(remembered.id)).toContain("private-outside-content");
    }
    expect((await invoke(remembered.id, "read", { path: join(aliasDirectory, "private.txt") })).output).toContain("private-outside-content");
    const changed = join(root, "changed-target");
    await mkdir(changed); await writeFile(join(changed, "private.txt"), "unapproved-new-target");
    await rm(aliasDirectory); await symlink(changed, aliasDirectory, process.platform === "win32" ? "junction" : "dir");
    await invoke(remembered.id, "start-read", { path: join(aliasDirectory, "private.txt") });
    const changedTarget = await pending(remembered.id);
    expect(changedTarget.resources).toEqual([join(changed, "*").replaceAll("\\", "/")]);
    await client.permission.reply({ sessionID: remembered.id, requestID: changedTarget.id, decision: "reject" });
    expect(await waitForOutcome(remembered.id)).toBe("rejected");
    const foreign = await client.session.create({ location: otherLocation, agent: "helper" });
    await invoke(foreign.id, "start-read", { path: external }, otherLocation);
    const foreignRequest = await pending(foreign.id, otherLocation);
    await client.permission.reply({ sessionID: foreign.id, requestID: foreignRequest.id, decision: "reject" });
    expect(await waitForOutcome(foreign.id, otherLocation)).toBe("rejected");
    await writeRuntimeOpencodeConfig(config, "a", () => ({ permission: { external_directory: { [join(added, "*")]: "allow" } } }));
    await writeLegalworkRuntimeConfigFile(config, "a");
    await invoke(next.id, "start-read", { path: external });
    const revoked = await pending(next.id);
    await client.permission.reply({ sessionID: next.id, requestID: revoked.id, decision: "reject" });
    expect(await waitForOutcome(next.id)).toBe("rejected");
  } finally {
    await engine?.close(); await server?.stop(); await closeRuntimeOpencodeConfig(config);
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

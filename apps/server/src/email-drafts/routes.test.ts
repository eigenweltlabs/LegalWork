import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("draft HTTP routes enforce auth, revisions, workspace boundaries and read-only mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "drafts-http-"));
  const script = join(root, "check.mjs");
  await writeFile(script, `
    import { mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import assert from "node:assert/strict";
    const { startServer } = await import(${JSON.stringify(new URL("../server.ts", import.meta.url).href)});
    const root = process.env.XDG_CONFIG_HOME, folder = join(root, "project");
    await mkdir(join(folder, ".git"), { recursive: true });
    await writeFile(join(folder, "contract.txt"), "Synthetic contract");
    const config = { host: "127.0.0.1", port: 0, token: "test", hostToken: "host", configPath: join(root, "server.json"),
      approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
      workspaces: ["project", "other"].map(id => ({ id, name: id, path: folder, preset: "starter", workspaceType: "local" })),
      authorizedRoots: [folder], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
    const server = await startServer(config), base = "http://127.0.0.1:" + server.port;
    const call = (path, method="GET", body, token="test") => fetch(base + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    try {
      const issued = await fetch(base + "/tokens", { method: "POST", headers: { "x-legalwork-host-token": "host", "content-type": "application/json" }, body: JSON.stringify({ scope: "viewer", label: "draft-test" }) });
      assert.equal(issued.status, 201);
      const viewer = (await issued.json()).token;
      for (const kind of ["email", "calendar"]) {
        const path = "/workspace/project/" + kind + "-drafts";
        const input = kind === "email"
          ? { to: "client@example.com", subject: "Review contract", body: "Please review.", attachments: [{ path: "contract.txt", contentType: "text/plain" }] }
          : { title: "Contract review", start: "2026-10-13T14:00:00", end: "2026-10-13T15:00:00", timeZone: "Europe/Berlin" };
        assert.equal((await call(path, "POST", input, "bad")).status, 401);
        assert.equal((await call(path, "POST", input, viewer)).status, 403);
        const created = await call(path, "POST", input);
        assert.equal(created.status, 200);
        const draft = (await created.json()).draft, itemPath = path + "/" + draft.id;
        assert.equal((await call(itemPath, "GET", undefined, viewer)).status, 200);
        assert.equal((await call(itemPath, "PUT", draft, viewer)).status, 403);
        assert.equal((await call("/workspace/other/" + kind + "-drafts/" + draft.id)).status, 404);
        assert.equal((await call("/workspace/other/" + kind + "-drafts/" + draft.id, "PUT", draft)).status, 409);
        const raw = await call("/workspace/project/files/raw?path=" + encodeURIComponent(draft.path));
        assert.equal(raw.status, 200);
        assert.match(await raw.text(), kind === "email" ? /X-Unsent: 1/ : /BEGIN:VEVENT/);
        const edit = kind === "email" ? { subject: "Human correction" } : { title: "Human correction" };
        const updated = await call(itemPath, "PUT", { ...draft, ...edit });
        assert.equal(updated.status, 200);
        const saved = (await updated.json()).draft;
        assert.notEqual(saved.revision, draft.revision);
        if (kind === "calendar") {
          assert.equal(saved.sequence, 1);
          assert.equal(saved.startInstant, "2026-10-13T12:00:00.000Z");
        }
        assert.equal((await call(itemPath, "PUT", draft)).status, 409);
        assert.deepEqual((await (await call(itemPath)).json()).draft, saved);
        const invalid = kind === "email" ? { ...input, subject: "Injected\\r\\nBcc: other@example.com" } : { ...input, end: input.start };
        assert.equal((await call(path, "POST", invalid)).status, 400);
        config.readOnly = true;
        assert.equal((await call(path, "POST", input)).status, 403);
        assert.equal((await call(itemPath, "PUT", saved)).status, 403);
        assert.equal((await call(itemPath)).status, 200);
        config.readOnly = false;
      }
      const traversal = await call("/workspace/project/email-drafts", "POST", { attachments: [{ path: "../secret" }] });
      assert.equal(traversal.status, 400);
      console.log("draft HTTP checks passed");
    } finally { await server.stop(); }
  `);
  try {
    const child = Bun.spawn([process.execPath, script], {
      env: { ...process.env, XDG_CONFIG_HOME: root, LEGALWORK_RUNTIME_DB: join(root, "runtime.sqlite") },
      stdout: "pipe", stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, failure: exit === 0 ? "" : stderr + stdout }).toEqual({ exit: 0, failure: "" });
    expect(stdout).toContain("draft HTTP checks passed");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);

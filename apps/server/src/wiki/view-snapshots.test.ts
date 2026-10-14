import { afterEach, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { ServerConfig } from "../types.js";
import { WikiStore } from "./store.js";
import { ViewRepository } from "../views/repository.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wiki-view-history-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "test", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const store = new WikiStore(config); cleanup.push(() => store.close());
  const wiki = await store.create({ name: "History", template: "blank" });
  const views = new ViewRepository({ kind: "wiki", id: wiki.id }, { list: async () => (await store.files(wiki.id)).map(file => file.path), read: path => store.readAsset(wiki.id, path), write: async (path, bytes, revision) => { await store.writeAsset(wiki.id, path, bytes, revision); } });
  return { root, store, wiki, views, config };
}
test("historical embeds preserve both layout and query data across edits and restart", async () => {
  const { store, wiki, views, config } = await fixture();
  const page = await store.write(wiki.id, "Client.md", "---\ntype: client\namount: 10\n---\n# Client", "");
  const view = await views.create({ version: 1, title: "Totals", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Original")', queries: { clients: { pageType: "client", fields: ["title", "amount"] } } });
  const content = `# Dashboard\n\n\`\`\`legalwork-view\n${view.id}\n\`\`\``;
  const document = await store.write(wiki.id, "Dashboard.md", content, "");
  const history = (await store.history(wiki.id, "Dashboard.md"))[0];
  await store.write(wiki.id, "Client.md", "---\ntype: client\namount: 99\n---\n# Client", page.revision);
  // Strip storage fields for the actual update, like the API does.
  const { id, owner, revision, updatedAt, savedFrom, ...input } = view;
  await views.update(id, { ...input, program: 'root = Text("Updated")' }, revision);
  await store.write(wiki.id, "Dashboard.md", `${content}\n\nNew text`, document.revision);
  await store.close();
  const reopened = new WikiStore(config); cleanup.push(() => reopened.close());
  const historic = await reopened.revision(wiki.id, "Dashboard.md", history.id);
  const snapshot = historic.viewSnapshots?.[`legalwork-view://wiki/${wiki.id}/${view.id}`];
  expect(snapshot?.program).toBe('root = Text("Original")');
  expect(snapshot?.datasets?.clients.rows[0].amount).toBe(10);
  expect(snapshot?.queries).toEqual({});
});
test("legacy revisions without a captured snapshot remain unavailable", async () => {
  const { root, store, wiki } = await fixture();
  await store.write(wiki.id, "Legacy.md", "# Legacy", "");
  const revision = (await store.history(wiki.id, "Legacy.md"))[0];
  const db = new Database(join(root, "wiki-state.sqlite"));
  db.query("DELETE FROM wiki_history_views WHERE historyId=?").run(revision.id); db.close();
  expect((await store.revision(wiki.id, "Legacy.md", revision.id)).viewSnapshots).toBeUndefined();
});

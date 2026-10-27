import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { Browser } from "@opencode/plugin-browser/rpc";
import { Schema } from "effect";
import { createBrowserPage } from "../electron/browser-native/runtime/chromium.mjs";

// Exercise the shipping controller and real Chromium without activating the desktop.
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "legalwork-browser-observation-")));
app.setPath("userData", path.join(root, "profile"));
const fixture = createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  if (request.url === "/long") return response.end(`<!doctype html><title>Long results</title>${Array.from({ length: 600 }, (_, i) => `<button>Record ${i}</button>`).join("")}<input aria-label="Final record">`);
  if (request.url === "/frame") return response.end('<!doctype html><title>Frame</title><input aria-label="Frame field">');
  if (request.url === "/frames") return response.end(`<!doctype html><title>Frames</title><iframe src="/frame"></iframe><iframe src="http://localhost:${fixture.address().port}/frame"></iframe>`);
  response.end(`<!doctype html><title>Deep form</title><style>body{font:18px sans-serif;padding:24px}input,button{font:inherit}</style><h1>Deep form</h1>${"<div>".repeat(40)}<main><label>Case number <input aria-label="Case number"></label><button>Search records</button><button style="display:none">Hidden action</button></main>${"</div>".repeat(40)}`);
});
function ref(snapshot, label, role) {
  const line = snapshot.content.split("\n").find(line => line.includes(`[${role}]`) && line.includes(JSON.stringify(label)));
  assert.ok(line, `Missing ${role} ${label}:\n${snapshot.content}`);
  const match = /@(e\d+)/.exec(line);
  assert.ok(match, `Missing ref for ${label}`);
  return match[1];
}
let owner, page;
const deadline = setTimeout(() => { console.error("Browser observation regression timed out"); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  let status = 0;
  try {
    await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${fixture.address().port}`;
    owner = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true });
    await owner.loadURL("about:blank");
    let nextRef = 0;
    page = createBrowserPage(owner, {
      id: "tab_00000000-0000-4000-8000-000000000001", partition: "observation-fixture", network: null,
      publish() {}, fail() { throw new Error("Browser renderer failed"); },
      popup() { throw new Error("Unexpected popup"); }, shared: { ref: () => `e${++nextRef}` },
      embeds: { create(view) {
        owner.contentView.addChildView(view);
        return { id: "observation", show: visible => view.setVisible(visible), on: () => () => {}, dispose() {} };
      } },
    });
    const run = async (type, input = {}) => {
      const command = Schema.decodeUnknownSync(Browser.Command)({ action: { type, tabID: page.state().id, ...input }, files: [] });
      return (await page.execute(command, new AbortController().signal)).value;
    };
    await run("navigate", { url: origin });
    const deep = await run("snapshot");
    const field = ref(deep, "Case number", "textbox");
    assert.equal(deep.truncated, false);
    ref(deep, "Search records", "button");
    assert.doesNotMatch(deep.content, /Hidden action|\[InlineTextBox\]|\[generic\] ""/);
    await run("fill", { ref: field, text: "Observed through forty wrappers" });
    assert.equal((await run("evaluate", { script: "document.querySelector('input').value" })).value, "Observed through forty wrappers");
    console.log("PASS default snapshot exposes usable controls through forty layout wrappers and omits hidden/duplicate content");

    const shallow = await run("snapshot", { depth: 1 });
    assert.equal(shallow.truncated, true);
    assert.doesNotMatch(shallow.content, /\[textbox\]/);
    ref(await run("snapshot", { depth: 2 }), "Search records", "button");
    ref(await run("snapshot", { depth: 3 }), "Case number", "textbox");
    console.log("PASS explicit depth counts semantic structure instead of empty layout nesting");

    const found = await run("find", { text: "CASE NUMBER" });
    assert.equal(found.truncated, false);
    await run("fill", { ref: ref(found, "Case number", "textbox"), text: "Fresh find ref" });
    await assert.rejects(run("fill", { ref: field, text: "Stale ref" }), /stale|another tab/i);
    console.log("PASS full-tree case-insensitive find returns usable fresh refs and invalidates old refs");

    await run("navigate", { url: origin + "/long" });
    const bounded = await run("snapshot");
    assert.equal(bounded.truncated, true);
    assert.ok(bounded.content.split("\n").length <= 500);
    assert.doesNotMatch(bounded.content, /Final record/);
    const late = await run("find", { text: "final RECORD" });
    assert.equal(late.truncated, false);
    await run("fill", { ref: ref(late, "Final record", "textbox"), text: "Found after 600 records" });
    assert.equal((await run("evaluate", { script: "document.querySelector('input').value" })).value, "Found after 600 records");
    const many = await run("find", { text: "Record " });
    assert.equal(many.truncated, true);
    assert.equal(many.content.split("\n").length, 500);
    assert.ok(many.content.length <= Browser.MAX_TEXT);
    const absent = await run("find", { text: "No matching record exists" });
    assert.equal(absent.content, "");
    assert.equal(absent.truncated, false);
    console.log("PASS find searches beyond the snapshot cutoff while snapshot and matching-result output stay bounded");

    await run("navigate", { url: origin + "/frames" });
    const frames = (await run("frames")).frames.filter(frame => frame.parentID);
    assert.equal(frames.length, 2);
    for (const frame of frames) {
      const snapshot = await run("find", { frameID: frame.id, text: "Frame field" });
      await run("fill", { ref: ref(snapshot, "Frame field", "textbox"), text: "Frame preserved" });
      assert.equal((await run("evaluate", { frameID: frame.id, script: "document.querySelector('input').value" })).value, "Frame preserved");
    }
    console.log("PASS same-origin and cross-origin frame searches retain the correct action target");

    assert.equal(owner.isVisible(), false);
    assert.equal(owner.isFocused(), false);
    console.log("PASS all observations and interactions stayed in an unfocused hidden window; zero model calls");
  } catch (error) { status = 1; console.error(error); }
  finally {
    clearTimeout(deadline);
    await page?.dispose();
    owner?.destroy();
    fixture.close();
    await once(fixture, "close");
    rmSync(root, { recursive: true, force: true });
    app.exit(status);
  }
});

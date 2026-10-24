import assert from "node:assert/strict";
import { app, BrowserWindow, clipboard, systemPreferences } from "electron";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import os from "node:os";
import path from "node:path";
import { SystemDictationService } from "../electron/audio/system-dictation.mjs";

const directory = mkdtempSync(path.join(os.tmpdir(), "lw-paste-regression-"));
const output = process.env.LEGALWORK_PASTE_SCREENSHOTS;
const text = "Dictation insertion test.";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath("userData", directory);
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  let window;
  let service;
  const original = clipboard.availableFormats().map(format => ({ format, data: clipboard.readBuffer(format) }));
  try {
    assert.equal(process.platform, "darwin", "this native regression requires macOS");
    assert.equal(systemPreferences.isTrustedAccessibilityClient(false), true, "Electron must already have Accessibility permission");
    const source = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");
    const context = { spawn, setTimeout, clearTimeout };
    runInNewContext(source.slice(source.indexOf("const WINDOWS_PASTE_SCRIPT ="), source.indexOf("async function showSupportLogsProgressWindow")) + "\nthis.runPaste = runSystemPasteCommand;", context);
    service = new SystemDictationService({
      userDataDir: directory, platform: "darwin", clipboard, systemPreferences,
      globalShortcut: { register: () => false, unregister: () => {} }, shell: { openExternal: async () => {} },
      runPasteCommand: context.runPaste, onToggle: () => {}, onCancel: () => {},
    });
    window = new BrowserWindow({ title: "Dictation paste verification", width: 680, height: 520, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await window.loadURL("data:text/html," + encodeURIComponent(`<!doctype html><html><style>body{font:16px system-ui;padding:24px}input,textarea,[contenteditable]{display:block;width:95%;min-height:40px;border:1px solid gray;padding:8px;margin:8px 0 16px}</style><h2>Dictation insertion verification</h2><label>Plain input<input id="input"></label><label>Rich editor<div id="rich" contenteditable="true" role="textbox" aria-multiline="true"><p><br></p></div></label><button id="button">Non-editable button</button><label>Read only<textarea id="readonly" readonly>Read-only content</textarea></label></html>`));
    app.focus({ steal: true });
    window.focus();
    await delay(500);
    // Do not inspect the native accessibility tree before the first paste:
    // that would enable it and hide the regression this test must catch.
    assert.equal(app.isAccessibilitySupportEnabled(), false);
    if (output) await mkdir(output, { recursive: true });
    for (const id of ["input", "rich", "button", "readonly"]) {
      await window.webContents.executeJavaScript(`document.getElementById('${id}').focus()`);
      await delay(100);
      assert.equal(window.isFocused(), true, "leave the test window focused while this regression runs");
      const result = await service.pasteText(text);
      assert.equal(window.isFocused(), true, "focus changed during native paste; leave this test window focused and rerun");
      const editable = id === "input" || id === "rich";
      assert.deepEqual(result, { pasted: editable, copied: true, error: null }, id);
      if (editable) {
        const value = await window.webContents.executeJavaScript(`(() => { const el=document.getElementById('${id}'); return el.isContentEditable ? el.innerText : el.value; })()`);
        assert.equal(value.trim(), text, `${id} receives the exact dictated text`);
      } else {
        assert.equal(clipboard.readText(), text, `${id} leaves the dictation on the clipboard`);
        assert.equal(await window.webContents.executeJavaScript("document.getElementById('readonly').value"), "Read-only content");
      }
      if (output) await writeFile(path.join(output, `native-${id}.png`), (await window.webContents.capturePage()).toPNG());
      console.log(`PASS: ${id} ${editable ? "receives dictation" : "retains clipboard fallback"}`);
    }
    console.log("PASS: native dictation paste initializes a missing accessibility tree and preserves clipboard fallback");
  } finally {
    service?.dispose();
    window?.destroy();
    if (clipboard.readText() === text) {
      clipboard.clear();
      for (const item of original) clipboard.writeBuffer(item.format, item.data);
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 3 })
      .catch(error => console.warn("Temporary paste test cleanup:", error.message));
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });

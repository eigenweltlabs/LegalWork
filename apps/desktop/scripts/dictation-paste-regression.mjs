import assert from "node:assert/strict";
import { app, BrowserWindow, clipboard, nativeImage, systemPreferences } from "electron";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { resolveKeyMonitorPath } from "../electron/audio/system-key-monitor.mjs";
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
  const original = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
  try {
    assert.equal(process.platform, "darwin", "this native regression requires macOS");
    assert.equal(systemPreferences.isTrustedAccessibilityClient(false), true, "Electron must already have Accessibility permission");
    const source = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");
    const commands = [];
    const context = { spawn: (executable, args, options) => { commands.push({ executable, args }); return spawn(executable, args, options); }, setTimeout, clearTimeout, app, existsSync, resolveKeyMonitorPath };
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
    // No field eligibility query is allowed to prevent sending the paste.
    assert.equal(app.isAccessibilitySupportEnabled(), false);
    if (output) await mkdir(output, { recursive: true });
    for (const id of ["rich", "input"]) {
      app.focus({ steal: true });
      window.focus();
      window.webContents.focus();
      await delay(500);
      await window.webContents.executeJavaScript(`document.getElementById('${id}').focus()`);
      await delay(100);
      assert.equal(window.isFocused(), true, "leave the test window focused while this regression runs");
      clipboard.write({ text: "Previous clipboard", html: "<b>Previous clipboard</b>", rtf: String.raw`{\rtf1\ansi Previous clipboard}`, image: nativeImage.createFromBitmap(Buffer.from([255, 0, 0, 255]), { width: 1, height: 1 }) });
      commands.length = 0;
      const result = await service.pasteText(text);
      assert.equal(window.isFocused(), true, "focus changed during native paste; leave this test window focused and rerun");
      assert.equal(result.pasted, true);
      assert.equal(commands.length, 1, "the native helper succeeds without the Apple Events fallback");
      assert.equal(commands[0].args[0], "--paste");
      assert.equal(result.error, null);
      const value = await window.webContents.executeJavaScript(`(() => { const el=document.getElementById('${id}'); return el.isContentEditable ? el.innerText : el.value; })()`);
      if (output) await writeFile(path.join(output, `native-${id}.png`), (await window.webContents.capturePage()).toPNG());
      assert.equal(value.trim(), text, `${id} receives the exact dictated text`);
      assert.equal(clipboard.readText(), "Previous clipboard");
      assert.match(clipboard.readHTML(), /<b>Previous clipboard<\/b>/);
      assert.match(clipboard.readRTF(), /Previous clipboard/);
      assert.deepEqual(clipboard.readImage().getSize(), { width: 1, height: 1 });
      console.log(`PASS: ${id} receives dictation and restores the rich clipboard`);
    }
    console.log("PASS: native dictation inserts without accessibility field inspection and restores the clipboard");
  } finally {
    service?.dispose();
    window?.destroy();
    if ([text, "Previous clipboard", ""].includes(clipboard.readText())) {
      clipboard.write(original);
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 3 })
      .catch(error => console.warn("Temporary paste test cleanup:", error.message));
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });

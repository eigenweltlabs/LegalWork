import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, screen } from "electron";
import { placePanel } from "./launcher-placement.mjs";

const PANEL_WIDTH = 680;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 720;
const DEFAULT_HEIGHT = 420;
const EVENT = "legalwork:launcher:event";

/**
 * The focusable quick panel. A separate window from the non-focusable
 * companion: it takes typing focus, grows with its content, can be pinned,
 * and hides on blur unless a preview, menu or dialog of its own is open.
 */
export class LauncherWindow {
  /**
   * @param {{ appRoot: string, startUrl?: string, preloadPath: string, icon?: import("electron").NativeImage | null, userDataDir: string, focusedDisplay: () => number | null,
   *   onVisibility: (state: { visible: boolean, pinned: boolean }) => void, onExpand: (route: string) => void }} options
   */
  constructor(options) {
    this.options = options;
    /** @type {BrowserWindow | null} */
    this.window = null;
    this.loading = null;
    this.pinned = false;
    this.height = DEFAULT_HEIGHT;
    this.rememberPosition = true;
    this.positionPath = path.join(options.userDataDir, "launcher-position.json");
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.blurTimer = null;
    this.childDialogs = 0;
    /** @type {number | null} */
    this.displayId = null;
    /** @type {{ x: number, y: number, displayId: number | null } | null} */
    this.remembered = null;
  }
  isVisible() { return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible()); }
  isFocused() { return Boolean(this.window && !this.window.isDestroyed() && this.window.isFocused()); }
  state() { return { visible: this.isVisible(), pinned: this.pinned, focused: this.isFocused(), displayId: this.displayId }; }
  webContents() { return this.window && !this.window.isDestroyed() ? this.window.webContents : null; }
  send(event) { this.webContents()?.send(EVENT, event); }
  async loadPosition() {
    try { const saved = JSON.parse(await readFile(this.positionPath, "utf8")); if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) this.remembered = { x: saved.x, y: saved.y, displayId: saved.displayId ?? null }; } catch { /* no saved position */ }
  }
  savePosition() {
    if (!this.rememberPosition || !this.window || this.window.isDestroyed()) return;
    const [x, y] = this.window.getPosition();
    this.remembered = { x, y, displayId: this.displayId };
    void writeFile(this.positionPath, JSON.stringify(this.remembered)).catch(() => {});
  }
  display() {
    const focused = this.options.focusedDisplay();
    return screen.getAllDisplays().find(display => display.id === focused) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }
  /** Keep the renderer warm only when asked (background presence); otherwise it is created on first use. */
  async ensure() {
    if (this.window && !this.window.isDestroyed()) { if (this.loading) await this.loading; return this.window; }
    if (!this.remembered) await this.loadPosition();
    const window = new BrowserWindow({
      ...placePanel(this.display().workArea, { width: PANEL_WIDTH, height: this.height }, this.remembered),
      ...(process.platform === "darwin" ? { type: "panel", vibrancy: "under-window", visualEffectState: "active" } : {}),
      frame: false, transparent: process.platform !== "linux", resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false,
      hasShadow: false, alwaysOnTop: true, title: "LegalWork Assistant",
      ...(this.options.icon && !this.options.icon.isEmpty() ? { icon: this.options.icon } : {}),
      webPreferences: { preload: this.options.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    this.window = window;
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.on("blur", () => {
      // Menus, previews and file choosers must not dismiss the panel; a pinned panel never auto-hides.
      if (this.pinned || this.childDialogs > 0) return;
      if (this.blurTimer) clearTimeout(this.blurTimer);
      this.blurTimer = setTimeout(() => { if (!this.pinned && this.childDialogs === 0 && this.isVisible() && !this.isFocused()) this.hide(); }, 120);
    });
    window.on("focus", () => { if (this.blurTimer) clearTimeout(this.blurTimer); });
    window.on("moved", () => this.savePosition());
    window.on("closed", () => { if (this.window === window) this.window = null; });
    const route = "/launcher";
    this.loading = (this.options.startUrl ? window.loadURL(`${this.options.startUrl}#${route}`) : window.loadFile(path.join(this.options.appRoot, "index.html"), { hash: route })).finally(() => { this.loading = null; });
    await this.loading;
    return window;
  }
  async show() {
    const window = await this.ensure();
    const display = this.display();
    this.displayId = display.id;
    const bounds = placePanel(display.workArea, { width: PANEL_WIDTH, height: this.height }, this.remembered?.displayId === display.id || !this.remembered?.displayId ? this.remembered : null);
    window.setBounds(bounds);
    window.show();
    window.focus();
    this.options.onVisibility({ visible: true, pinned: this.pinned });
    this.send({ type: "visibility", visible: true, pinned: this.pinned });
    return this.state();
  }
  hide() {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide();
      this.options.onVisibility({ visible: false, pinned: this.pinned });
      this.send({ type: "visibility", visible: false, pinned: this.pinned });
    }
    return this.state();
  }
  async toggle() { return this.isVisible() && this.isFocused() ? this.hide() : this.show(); }
  setPinned(pinned) {
    this.pinned = Boolean(pinned);
    this.send({ type: "visibility", visible: this.isVisible(), pinned: this.pinned });
    return this.state();
  }
  resize(height) {
    const next = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Number(height) || DEFAULT_HEIGHT)));
    this.height = next;
    if (this.window && !this.window.isDestroyed()) {
      const bounds = this.window.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      this.window.setBounds({ ...bounds, height: Math.min(next, area.y + area.height - bounds.y) });
    }
    return this.state();
  }
  /** Temporarily leave the screen for a capture, then come back. */
  async hiddenWhile(work) {
    const wasVisible = this.isVisible();
    if (wasVisible) { this.childDialogs++; this.window?.hide(); }
    try { return await work(); }
    finally { if (wasVisible) { this.childDialogs--; await this.show(); } }
  }
  beginDialog() { this.childDialogs++; }
  endDialog() { this.childDialogs = Math.max(0, this.childDialogs - 1); if (this.isVisible() && !this.pinned && !this.isFocused()) this.window?.focus(); }
  expand(route) { this.hide(); this.options.onExpand(route); }
  destroy() {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}

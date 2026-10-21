import { LauncherSettingsStore } from "./launcher-settings.mjs";
import { LauncherShortcutRegistry } from "./launcher-shortcuts.mjs";
import { parseAssistantLink } from "./launcher-links.mjs";

/** App actions a direct shortcut can jump into, and the invocation each one opens with. */
const ACTION_INVOCATIONS = {
  "app.search-files": "files", "app.search-projects": "projects", "app.search-chats": "chats", "app.search-tasks": "tasks", "app.search-recordings": "recordings",
  "app.ask": "ask", "app.speak": "speak", "app.capture-region": "capture-region", "app.capture-window": "capture-window", "app.add-selection": "ask", "app.show-work": "work", "app.new-conversation": "new-conversation",
};
const INVOCATION_MEMORY = 200;

/**
 * Orchestrates the launcher on the desktop: settings, one shortcut registry,
 * the panel window, the origin captured before it, deep links, the companion
 * badge and the Raycast pairing. Everything reaches the same invocation path.
 */
export class LauncherService {
  /**
   * @param {{ app: import("electron").App, globalShortcut: import("electron").GlobalShortcut, userDataDir: string, platform?: string,
   *   window: import("./launcher-window.mjs").LauncherWindow, origin: import("./origin-service.mjs").OriginService, capture: import("./screen-capture.mjs").ScreenCapture,
   *   pairing: import("./raycast-pairing.mjs").RaycastPairing, dictation: () => { enabled: boolean, accelerator: string, runtimeState: string }, meeting: () => { state: string },
   *   companion: (state: { enabled: boolean, badge: boolean, attention: number, recording: boolean }) => void, onPresenceChanged: () => void, settings?: LauncherSettingsStore, registry?: LauncherShortcutRegistry }} options
   */
  constructor(options) {
    this.options = options;
    /** @type {"darwin" | "windows" | "linux"} */
    this.platform = options.platform === "darwin" || options.platform === "windows" || options.platform === "linux" ? options.platform : process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
    this.settings = options.settings ?? new LauncherSettingsStore(options.userDataDir);
    this.registry = options.registry ?? new LauncherShortcutRegistry({ globalShortcut: options.globalShortcut, platform: process.platform, reserved: () => { const dictation = options.dictation(); return dictation.enabled && dictation.accelerator ? [dictation.accelerator] : []; } });
    /** @type {import("@legalwork/types/launcher").LauncherInvocation[]} */
    this.pending = [];
    /** @type {string[]} */
    this.seen = [];
    this.attention = 0;
    this.recording = false;
    this.drafts = { drafts: {}, leases: {} };
  }
  async initialize() {
    await this.settings.load();
    await this.options.pairing.load();
    this.applyShortcuts();
    this.syncCompanion();
    this.options.window.rememberPosition = this.settings.get().rememberPosition;
    if (this.settings.get().pinned) this.options.window.setPinned(true);
  }
  bindings() {
    const settings = this.settings.get();
    const bindings = [{ id: "launcher.open", accelerator: settings.shortcut, handler: () => { void this.toggle("shortcut"); } }];
    for (const [id, accelerator] of Object.entries(settings.actionShortcuts)) {
      const action = ACTION_INVOCATIONS[id] ?? (id.startsWith("quick-action:") ? "quick-action" : null);
      if (!action) continue;
      bindings.push({ id, accelerator, handler: () => { void this.invoke({ id: `shortcut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, action: /** @type {import("@legalwork/types/launcher").LauncherInvocationAction} */ (action), actionId: id.startsWith("quick-action:") ? id : undefined, source: "shortcut", selection: id === "app.add-selection" }); } });
    }
    return bindings;
  }
  applyShortcuts() { return this.registry.apply(this.bindings()); }
  refreshAfterResume() { this.options.origin.invalidate(); return this.registry.refresh(this.bindings()); }
  /** @returns {Promise<import("@legalwork/types/launcher").LauncherDesktopStatus>} */
  async status() {
    const settings = this.settings.get();
    const dictation = this.options.dictation();
    const meeting = this.options.meeting();
    let autostartRequiresApproval = false, autostart = settings.autostart;
    try { const login = this.options.app.getLoginItemSettings(); autostart = login.openAtLogin === true; autostartRequiresApproval = login.status === "requires-approval"; } catch { /* unsupported */ }
    const capabilities = this.options.origin.capabilities();
    return { ...settings, autostart, shortcutRegistered: this.registry.isRegistered("launcher.open"), conflicts: this.registry.conflicts, autostartRequiresApproval, raycastPairing: this.options.pairing.status(), platform: this.platform,
      capabilities: { selection: capabilities.selection, insert: capabilities.insert, windowCapture: capabilities.windowCapture, regionCapture: capabilities.regionCapture, origin: capabilities.origin },
      voice: { externalDictation: ["starting", "listening", "transcribing", "inserting"].includes(dictation.runtimeState), meeting: meeting.state !== "idle" } };
  }
  async updateSettings(patch) {
    const before = this.settings.get();
    const next = await this.settings.update(patch);
    if (patch && typeof patch.autostart === "boolean") {
      try { this.options.app.setLoginItemSettings({ openAtLogin: patch.autostart, ...(process.platform === "win32" ? { args: patch.autostart ? ["--hidden"] : [] } : {}) }); } catch { /* reported through status */ }
    }
    if (next.shortcut !== before.shortcut || JSON.stringify(next.actionShortcuts) !== JSON.stringify(before.actionShortcuts)) this.applyShortcuts();
    this.options.window.rememberPosition = next.rememberPosition;
    if (next.pinned !== before.pinned) this.options.window.setPinned(next.pinned);
    this.syncCompanion();
    this.options.onPresenceChanged();
    return this.status();
  }
  syncCompanion() {
    const settings = this.settings.get();
    this.options.companion({ enabled: settings.companion, badge: settings.companionBadge, attention: this.attention, recording: this.recording });
  }
  setAttention(input) {
    this.attention = Math.max(0, Number(input?.count) || 0);
    this.recording = Boolean(input?.recording);
    this.syncCompanion();
    this.options.window.send({ type: "attention", count: this.attention });
  }
  backgroundPresence() { return this.settings.get().backgroundPresence; }
  approvalWindow() { return this.options.window.isVisible() ? this.options.window.window : null; }
  remember(id) {
    if (this.seen.includes(id)) return false;
    this.seen.push(id);
    if (this.seen.length > INVOCATION_MEMORY) this.seen.shift();
    return true;
  }
  /**
   * Every entry point ends here. Repeated delivery of the same invocation does nothing twice.
   * @param {import("@legalwork/types/launcher").LauncherInvocation & { selection?: boolean }} invocation
   */
  async invoke(invocation) {
    if (!invocation?.id || !this.remember(invocation.id)) return this.options.window.state();
    const { selection, ...payload } = invocation;
    // Capture the external origin before the panel takes focus; an ordinary invocation records identity only.
    if (!this.options.window.isVisible()) await this.options.origin.capture();
    if (selection) await this.options.origin.prefetchSelection();
    await this.options.window.show();
    this.options.window.send({ type: "origin", origin: this.options.origin.current() });
    this.deliver(payload);
    return this.options.window.state();
  }
  deliver(invocation) {
    const contents = this.options.window.webContents();
    if (!contents || contents.isLoading()) { this.pending.push(invocation); return; }
    this.options.window.send({ type: "invocation", invocation });
  }
  /** The cold-start queue: the panel drains what arrived before its renderer was ready. */
  drain() { const pending = this.pending.splice(0, this.pending.length); return pending; }
  /** @param {import("@legalwork/types/launcher").LauncherInvocation["source"]} source */
  async toggle(source) {
    if (this.options.window.isVisible() && this.options.window.isFocused()) return this.options.window.hide();
    return this.invoke({ id: `toggle_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, action: "open", source });
  }
  /**
   * Assistant links go to the panel, not indiscriminately to the main window. Returns the links that are not ours.
   * @param {string[]} urls
   */
  async handleDeepLinks(urls) {
    const remaining = [];
    for (const url of urls) {
      const invocation = parseAssistantLink(url);
      if (invocation) await this.invoke(invocation); else remaining.push(url);
    }
    return remaining;
  }
  async windowControl(command, payload) {
    const window = this.options.window;
    switch (command) {
      case "show": return window.show();
      case "hide": return window.hide();
      case "pin": await this.settings.update({ pinned: true }); return window.setPinned(true);
      case "unpin": await this.settings.update({ pinned: false }); return window.setPinned(false);
      case "resize": return window.resize(payload?.height);
      case "expand": window.expand(typeof payload?.route === "string" && payload.route.startsWith("/") ? payload.route : "/home"); return window.state();
      default: return window.state();
    }
  }
  dispose() { this.registry.dispose(); this.options.window.destroy(); this.options.capture.destroy(); }
}

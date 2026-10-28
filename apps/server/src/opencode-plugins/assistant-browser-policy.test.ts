import { expect, test } from "bun:test";
import { ASSISTANT_BROWSER_AGENT, assistantBrowserModel } from "../assistant-browser.js";
import { registerAssistantBrowserPolicy } from "./assistant-browser-policy.js";
import { nativePluginTestRuntime, nativeTestInvocation } from "./native-plugin-test-support.js";

const terra = { providerID: "fixture", id: "gpt-6.1-terra", capabilities: { input: ["text"] } };
const cheap = { ...terra, id: "cheap" };
const settings = { systemPromptAddition: "", resourceIds: [], projectAccess: { mode: "all", projectIds: [] } };

test("browser default resolves Terra 6.1 only and explicit selections never fall back", () => {
  expect(assistantBrowserModel([cheap, terra], undefined)).toBe(terra);
  expect(assistantBrowserModel([{ ...terra, id: "alias", name: "GPT-6.1 Terra" }], null).id).toBe("alias");
  expect(() => assistantBrowserModel([cheap], null)).toThrow("requires GPT-6.1 Terra");
  expect(() => assistantBrowserModel([terra], { providerID: "missing", modelID: terra.id })).toThrow("selected browser model is unavailable");
  expect(assistantBrowserModel([cheap, terra], { providerID: terra.providerID, modelID: terra.id })).toBe(terra);
});

test("browser default recognizes the connected EU catalogue without selecting older Terra models", () => {
  const eu = { providerID: "eigenwelt", id: "Eigenwelt Europe GPT Terra", modelID: "Eigenwelt Europe GPT Terra", name: "GPT-6.1 Terra (EU)" };
  const older = ["gpt-5.6-terra", "gpt-5.6-terra-fast"].map(id => ({ providerID: "openai", id }));
  expect(assistantBrowserModel([...older, cheap, eu], null)).toBe(eu);
  expect(() => assistantBrowserModel(older, null)).toThrow("requires GPT-6.1 Terra");
});

test("browser default accepts Terra service labels but not another model or version", () => {
  for (const name of ["GPT-6.1 Terra Fast", "GPT-6.1 Terra Fast (EU)", " GPT-6.1 Terra (EU) "]) {
    const model = { providerID: "fixture", id: "alias", name };
    expect(assistantBrowserModel([model], null)).toBe(model);
  }
  for (const name of ["GPT-5.6 Terra (EU)", "GPT-6.1 Sol (EU)", "GPT-6.10 Terra", "GPT-6.1 Terra Mini", "GPT-6.1 Terra-like"]) {
    expect(() => assistantBrowserModel([{ providerID: "fixture", id: "alias", name }], null)).toThrow("requires GPT-6.1 Terra");
  }
});

test("Assistant browser work is isolated, model-pinned and cannot bring tabs to the foreground", async () => {
  const runtime = nativePluginTestRuntime("/Assistant");
  runtime.models([cheap, terra]);
  runtime.sessions.set("coordinator", { agent: "legalwork", model: cheap });
  runtime.sessions.set("worker", { agent: ASSISTANT_BROWSER_AGENT, parentID: "coordinator", model: terra });
  runtime.sessions.set("research", { agent: "general", parentID: "coordinator", model: cheap });
  await registerAssistantBrowserPolicy(runtime.ctx, async directory => directory === "/Assistant", async () => ({ settings }));
  const before = async (session: string, tool: string, input: Record<string, unknown> = {}) => {
    const event = { ...nativeTestInvocation(session), tool, input };
    await runtime.hook("tool", "execute.before", event);
    return event.input;
  };
  for (const tool of ["browser.tabs.open", "browser_tabs_open", "browser.snapshot", "legalwork_browser_open_url", "mcp_browser_click", "legalwork_webfetch", "legalwork_websearch", "webfetch", "websearch"])
    await expect(before("coordinator", tool)).rejects.toThrow("Delegate browser work");
  await expect(before("research", "browser.navigate")).rejects.toThrow("Delegate browser work");
  await expect(before("coordinator", "legalwork_ui_execute_action", { actionId: "browser.open_url" })).rejects.toThrow("Delegate browser work");
  expect(await before("coordinator", "subagent", { agent: ASSISTANT_BROWSER_AGENT, model: "fixture/cheap", prompt: "Read the page", background: false }))
    .toMatchObject({ model: "fixture/gpt-6.1-terra", prompt: "Read the page", background: true });
  expect(await before("worker", "browser.tabs.open", { url: "https://example.org", focus: true })).toMatchObject({ focus: false });
  expect(await before("worker", "browser_tabs_open", { focus: true })).toEqual({ focus: false });
  await expect(before("worker", "browser_tabs_focus")).rejects.toThrow("background");
  await expect(before("worker", "browser_preview")).rejects.toThrow("background");
  expect(await before("worker", "legalwork_browser_open_url", { url: "https://example.org", show: true })).toMatchObject({ show: false });
  expect(await before("worker", "legalwork_ui_execute_action", { actionId: "browser.open_url", args: { show: true, url: "https://example.org" } }))
    .toMatchObject({ args: { show: false, url: "https://example.org" } });
  await expect(before("worker", "browser.tabs.select")).rejects.toThrow("background");
  await expect(before("worker", "browser.preview", { path: "report.pdf" })).rejects.toThrow("background");
  expect(await before("coordinator", "read", { path: "notes.md" })).toEqual({ path: "notes.md" });
  expect(await before("coordinator", "subagent", { agent: "general" })).toEqual({ agent: "general" });
  runtime.models([cheap]);
  await expect(before("coordinator", "subagent", { agent: ASSISTANT_BROWSER_AGENT })).rejects.toThrow("requires GPT-6.1 Terra");
  runtime.move("/Other project");
  expect(await before("coordinator", "browser.tabs.open", { focus: true })).toEqual({ focus: true });
});

test("a worker started on the wrong model is refused before generation or browser execution", async () => {
  const runtime = nativePluginTestRuntime("/Assistant");
  runtime.models([cheap, terra]);
  runtime.sessions.set("worker", { agent: ASSISTANT_BROWSER_AGENT, parentID: "coordinator", model: cheap });
  await registerAssistantBrowserPolicy(runtime.ctx, async () => true, async () => ({ settings }));
  await expect(runtime.hook("session", "context", { sessionID: "worker", agent: ASSISTANT_BROWSER_AGENT, model: cheap })).rejects.toThrow("configured Browser model");
  await expect(runtime.hook("tool", "execute.before", { ...nativeTestInvocation("worker"), tool: "browser.snapshot", input: {} })).rejects.toThrow("not using the selected browser model");
});

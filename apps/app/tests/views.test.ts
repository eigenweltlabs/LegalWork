import { describe, expect, test } from "bun:test";
import { parsePartialJson } from "ai";
import { parseViewReference, viewLink, viewPanelTab } from "../src/react-app/domains/views/view-reference";
import { createPanelTabStore } from "../src/react-app/domains/session/panel/panel-tab-store";
import { parseDynamicToolUIPart } from "../src/react-app/domains/session/sync/parse-tool-parts";
import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import { isLocalOpenUIProgram } from "@legalwork/openui/catalog";
import { viewSourceTab } from "../src/react-app/domains/views/view-source";

const viewId = "11111111-1111-4111-8111-111111111111";
describe("saved view references", () => {
  test("a bare ID needs an owner, explicit references survive links and tab restoration", () => {
    const owner = { kind: "wiki", id: "firm wiki" } satisfies NonNullable<ReturnType<typeof parseViewReference>>["owner"];
    expect(parseViewReference(viewId)).toBeNull();
    const reference = parseViewReference(viewId, owner)!;
    expect(parseViewReference(viewLink(reference))).toEqual(reference);
    expect(parseViewReference(`wiki:firm/${viewId}`)).toEqual({ owner: { kind: "wiki", id: "firm" }, viewId });
    const store = createPanelTabStore();
    const tab = viewPanelTab("http://localhost:4242", reference, "Client stages");
    store.getState().openTab("workspace:test", tab);
    store.getState().openTab("workspace:test", tab);
    store.getState().openTab("workspace:test", viewPanelTab("http://localhost:4242", reference));
    const layout = store.getState().sessions["workspace:test"];
    expect(layout.tabs).toHaveLength(1);
    expect(layout.tabs[0].label).toBe("Client stages");
    expect(store.getState().readLayout(JSON.parse(JSON.stringify(layout)))?.tabs).toEqual([tab]);
    expect(viewPanelTab("other-server", reference).id).not.toBe(tab.id);
  });
  test("rejects malformed IDs, external URLs and extra path components", () => {
    for (const value of ["https://example.com/view", "not-an-id", `wiki:x/${viewId}/extra`, `wiki:%ZZ/${viewId}`, `wiki:x/../../${viewId}`]) expect(parseViewReference(value)).toBeNull();
  });
});
test("only view tools preserve pending raw args, including incomplete program text", async () => {
  const raw = '{"input":{"title":"Test","program":"root = Text(\\"Hello';
  const part: ToolPart = { id: "part", messageID: "message", sessionID: "session", type: "tool", callID: "call", tool: "view_create", state: { status: "pending", input: {}, raw } };
  const ui = parseDynamicToolUIPart(part);
  expect(ui?.state).toBe("input-streaming");
  expect(ui?.callProviderMetadata?.opencode).toMatchObject({ rawInput: raw });
  expect((await parsePartialJson(raw)).value).toMatchObject({ input: { program: 'root = Text("Hello' } });
  expect(parseDynamicToolUIPart({ ...part, tool: "write" })).toBeNull();
});
test("cloud bundles, script declarations and mutation capabilities are not accepted", () => {
  expect(isLocalOpenUIProgram('root = Text("Hello")')).toBe(true);
  expect(isLocalOpenUIProgram('root = Text("Hel')).toBe(true);
  for (const program of ['{"program":"root = Text(1)","scripts":{}}', "<script>alert(1)</script>", 'root = Mutation("delete", {})', 'x = Script("foo")', "```openui\nroot = Text(1)"]) expect(isLocalOpenUIProgram(program)).toBe(false);
});
test("a project report's wiki dataset opens its original wiki source, never the report project", () => {
  const source = viewSourceTab("local", { kind: "wiki", id: "firm-knowledge" }, "Clients/Aster.md");
  expect(source).toMatchObject({ type: "wiki", wikiId: "firm-knowledge", location: { kind: "page", path: "Clients/Aster.md" } });
  const projectSource = viewSourceTab("local", { kind: "workspace", id: "project-aster" }, "Diligence.md");
  expect(projectSource).toMatchObject({ type: "artifact", sourceProject: { workspaceId: "project-aster", path: "Diligence.md" } });
  for (const path of ["../secret.md", "/etc/passwd", "https://example.com/x", "file:secret.md", "a\\b", "a/../b", "a\u0000.md"]) expect(viewSourceTab("local", { kind: "wiki", id: "firm" }, path)).toBeNull();
});

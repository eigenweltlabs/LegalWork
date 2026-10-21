import { expect, test } from "bun:test";
import type { LauncherSearchResponse, LauncherSearchResult } from "@legalwork/types/launcher";
import { LauncherSearchSession } from "../src/react-app/launcher/launcher-search-session";

const item = (id: string, score: number): LauncherSearchResult => ({ id, kind: "files", workspaceId: "w", sourceId: "local:w", title: id, updatedAt: 0, match: "prefix", score, actions: ["open"] });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test("stale queries are cancelled, the fast pass renders first, and the content pass appends without reordering", async () => {
  const calls: string[] = [];
  const session = new LauncherSearchSession(async (input, signal) => {
    calls.push(`${input.query}:${input.content ? "content" : "fast"}`);
    const response: LauncherSearchResponse = { items: input.content ? [item("b", 900), item("a", 500), item("c", 300)] : [item("a", 500), item("b", 400)], sources: [{ id: "files:w", kind: "files", workspaceId: "w", label: "W", coverage: input.content ? "complete" : "filename-only", count: 2 }], unavailable: [] };
    if (input.query === "slow") await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    return response;
  }, { debounceMs: 5 });
  const seen: string[] = [];
  session.subscribe(snapshot => seen.push(`${snapshot.query}|${snapshot.items.map(item => item.id).join(",")}|${snapshot.pending ? "pending" : "settled"}`));
  session.search({ query: "slow", kinds: ["files"], projectId: null });
  await wait(10);
  session.search({ query: "mietvertrag", kinds: ["files"], projectId: null });
  await wait(40);
  expect(calls).toEqual(["slow:fast", "mietvertrag:fast", "mietvertrag:content"]);
  expect(seen.at(-2)).toBe("mietvertrag|a,b|pending");
  expect(seen.at(-1)).toBe("mietvertrag|a,b,c|settled");
  expect(session.current().sources[0]?.coverage).toBe("complete");
  session.search({ query: "", kinds: ["files"], projectId: null });
  expect(session.current().items).toEqual([]);
});

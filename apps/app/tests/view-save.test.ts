import { expect, test } from "bun:test";
import { ViewPreviewSchema, type ViewInput, type ViewOwner } from "@legalwork/types/views";
import { viewInputForDestination } from "../src/react-app/domains/views/view-save";
import { viewToolOutcome } from "../src/react-app/domains/views/view-generation";
const owner: ViewOwner = { kind: "wiki", id: "source" };
const input: ViewInput = { version: 1, title: "Cases", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Cases")', queries: { cases: { fields: ["title"] } }, datasets: { cases: { rows: [{ title: "A" }], total: 1, revision: "r1", asOf: 1, truncated: false } } };
test("a completed preview is recognized without a saved identity or location", () => {
  const preview = ViewPreviewSchema.parse({ status: "preview", owner, input });
  expect(viewToolOutcome(JSON.stringify(preview))).toEqual({ preview });
  expect(viewToolOutcome({ status: "preview", owner, input: { ...input, program: "" } })).toHaveProperty("error");
});
test("same-wiki saves retain live queries; project and foreign-wiki copies retain attributed snapshots", () => {
  expect(viewInputForDestination(input, owner, owner)).toBe(input);
  for (const destination of [{ kind: "workspace", id: "project" }, { kind: "wiki", id: "other" }] satisfies ViewOwner[]) {
    const copy = viewInputForDestination(input, owner, destination);
    expect(copy.queries).toEqual({});
    expect(copy.datasets?.cases.sourceOwner).toEqual(owner);
    expect(copy.datasets?.cases.rows).toEqual(input.datasets?.cases.rows);
  }
  expect(input.datasets?.cases.sourceOwner).toBeUndefined();
});
test("missing data cannot silently create a misleading cross-wiki copy", () => {
  expect(() => viewInputForDestination({ ...input, datasets: {} }, owner, { kind: "wiki", id: "other" })).toThrow("Refresh the preview");
});

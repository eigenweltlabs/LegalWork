import { expect, test } from "bun:test";
import { enterTarget, escapeAction, footerVerb, isComposingKeyEvent, moveSelection, reconcileSelection } from "../src/react-app/launcher/launcher-keyboard";

const items = [{ id: "a", primaryAction: "open" as const }, { id: "b", primaryAction: "attach" as const }, { id: "c", primaryAction: "run" as const }];
test("streaming results cannot move a user selection or change the action under Enter", () => {
  expect(reconcileSelection({ id: null, source: "auto" }, items)).toEqual({ id: "a", source: "auto" });
  const user = moveSelection({ id: "a", source: "auto" }, items, 1);
  expect(user).toEqual({ id: "b", source: "user" });
  expect(reconcileSelection(user, [{ id: "z" }, ...items])).toEqual(user);
  expect(reconcileSelection(user, [{ id: "a" }, { id: "c" }])).toEqual({ id: null, source: "user" });
  expect(enterTarget({ id: null, source: "user" }, items)).toBeNull();
  expect(enterTarget(user, items)?.id).toBe("b");
  expect(moveSelection({ id: "c", source: "user" }, items, 1).id).toBe("c");
  expect(moveSelection({ id: null, source: "user" }, items, -1).id).toBe("c");
  expect(moveSelection({ id: "a", source: "user" }, [], 1)).toEqual({ id: null, source: "user" });
});

test("escape peels one layer at a time and a pinned panel never dismisses", () => {
  expect(escapeAction({ overlayOpen: true, category: true, pinned: false })).toBe("overlay");
  expect(escapeAction({ overlayOpen: false, category: true, pinned: false })).toBe("filter");
  expect(escapeAction({ overlayOpen: false, category: false, pinned: false })).toBe("panel");
  expect(escapeAction({ overlayOpen: false, category: false, pinned: true })).toBeNull();
  expect(isComposingKeyEvent({ isComposing: true })).toBe(true);
  expect(isComposingKeyEvent({ keyCode: 229 })).toBe(true);
  expect(isComposingKeyEvent({ nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false);
  expect(footerVerb(items[1], "search")).toBe("attach");
  expect(footerVerb(items[2], "command")).toBe("run");
  expect(footerVerb(null, "search")).toBe("none");
  expect(footerVerb(null, "ask")).toBe("ask");
});

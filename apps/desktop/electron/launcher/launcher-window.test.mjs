import assert from "node:assert/strict";
import { test } from "node:test";
import { panelWasMoved, placePanel } from "./launcher-placement.mjs";

test("the panel centres on the active display and keeps a remembered position only inside that display", () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  assert.deepEqual(placePanel(area, { width: 680, height: 420 }, null), { x: 380, y: 183, width: 680, height: 420 });
  assert.deepEqual(placePanel(area, { width: 680, height: 420 }, { x: 100, y: 200 }), { x: 100, y: 200, width: 680, height: 420 });
  // Off-screen memory (an unplugged display) is repaired instead of trusted.
  assert.deepEqual(placePanel(area, { width: 680, height: 420 }, { x: 3000, y: 200 }), { x: 380, y: 183, width: 680, height: 420 });
  // A display smaller than the panel clamps the size.
  assert.deepEqual(placePanel({ x: 0, y: 0, width: 600, height: 300 }, { width: 680, height: 420 }, null), { x: 0, y: 0, width: 600, height: 300 });
  // Negative-origin displays keep the panel inside their own bounds.
  assert.deepEqual(placePanel({ x: -1920, y: -200, width: 1920, height: 1080 }, { width: 680, height: 420 }, { x: -1500, y: 0 }), { x: -1500, y: 0, width: 680, height: 420 });
});

test("the reset control appears only after the panel leaves its default position", () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const compact = placePanel(area, { width: 560, height: 346 }, null);
  assert.deepEqual(compact, { x: 440, y: 183, width: 560, height: 346 });
  assert.equal(panelWasMoved(area, compact), false);
  assert.equal(panelWasMoved(area, { ...compact, height: 520 }), false);
  assert.equal(panelWasMoved(area, { ...compact, x: compact.x + 20 }), true);
  assert.equal(panelWasMoved(area, { ...compact, y: compact.y - 20 }), true);
});

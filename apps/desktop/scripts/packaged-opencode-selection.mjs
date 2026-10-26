import assert from "node:assert/strict";

/** Version equality cannot distinguish two distributions of the same engine.
 * @param {unknown} packaged
 * @param {unknown} reviewed
 */
export function assertPackagedOpencodeSelection(packaged, reviewed) {
  assert.deepEqual(packaged, reviewed, "Packaged OpenCode selection must exactly match its reviewed build input");
}

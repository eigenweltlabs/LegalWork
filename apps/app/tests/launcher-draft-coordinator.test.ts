import { expect, test } from "bun:test";
import { DraftCoordinator, EMPTY_DRAFT_FILE, type DraftFile, type DraftMessage } from "../src/react-app/launcher/draft-coordinator";

function memoryStorage() {
  let file: DraftFile = EMPTY_DRAFT_FILE;
  return { storage: { read: async () => structuredClone(file), write: async (next: DraftFile) => { file = structuredClone(next); } }, current: () => file };
}
function bus() {
  const listeners = new Set<(message: DraftMessage) => void>();
  return { post: (message: DraftMessage) => { for (const listener of listeners) listener(message); }, subscribe: (listener: (message: DraftMessage) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

test("one editor at a time: expanding to Home transfers the whole draft and the stale editor is refused", async () => {
  const { storage, current } = memoryStorage();
  const channel = bus();
  let clock = 1000;
  const panel = new DraftCoordinator(storage, channel, () => clock);
  const home = new DraftCoordinator(storage, channel, () => clock);
  const panelLease = await panel.claim("conv_1", "panel");
  expect(panelLease.draft.revision).toBe(0);
  await panel.update("conv_1", "panel", { text: "Vergleiche die Fassungen", context: [{ id: "f1", type: "file", workspaceId: "mueller", path: "Mietvertrag.docx", name: "Mietvertrag.docx", revision: "1:2", sourceLabel: "Müller" }], pendingTranscription: "und prüfe Fristen" });
  expect(home.get("conv_1")).toMatchObject({ text: "Vergleiche die Fassungen", revision: 1, pendingTranscription: "und prüfe Fristen" });
  expect(home.get("conv_1").context).toHaveLength(1);
  const homeLease = await home.claim("conv_1", "home");
  expect(homeLease.draft.text).toBe("Vergleiche die Fassungen");
  expect(panel.owns("conv_1", "panel")).toBe(false);
  await expect(panel.update("conv_1", "panel", { text: "stale" })).rejects.toThrow("draft_lease_lost");
  await home.update("conv_1", "home", { text: "Vergleiche die Fassungen und prüfe Fristen", pendingTranscription: null });
  expect(panel.get("conv_1").text).toBe("Vergleiche die Fassungen und prüfe Fristen");
  expect(current().drafts.conv_1.revision).toBe(2);
  // Conversations are edited independently.
  await panel.claim("conv_2", "panel");
  await panel.update("conv_2", "panel", { text: "Other matter" });
  expect(home.get("conv_1").text).toBe("Vergleiche die Fassungen und prüfe Fristen");
  expect(home.get("conv_2").text).toBe("Other matter");
});

test("a crashed renderer never overwrites a newer draft, and its lease becomes reclaimable", async () => {
  const { storage, current } = memoryStorage();
  let clock = 0;
  const first = new DraftCoordinator(storage, undefined, () => clock);
  await first.claim("conv_1", "window-a");
  await first.update("conv_1", "window-a", { text: "v1" });
  // Window A dies without releasing. Window B reconciles from disk and takes over after the lease went stale.
  clock = 16 * 60_000;
  const second = new DraftCoordinator(storage, undefined, () => clock);
  await second.reconcile();
  expect(second.isLeaseStale("conv_1")).toBe(true);
  await second.claim("conv_1", "window-b");
  await second.update("conv_1", "window-b", { text: "v2" });
  // Window A comes back with an older in-memory draft; reconcile keeps the newer revision.
  await first.reconcile();
  expect(first.get("conv_1").text).toBe("v2");
  expect(first.get("conv_1").revision).toBe(2);
  await expect(first.update("conv_1", "window-a", { text: "ghost" })).rejects.toThrow("draft_lease_lost");
  expect(current().drafts.conv_1.text).toBe("v2");
  expect(await second.release("conv_1", "window-b")).toBe(true);
  expect(second.lease("conv_1")).toBeNull();
});

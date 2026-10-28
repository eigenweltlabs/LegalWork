import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantProactivityStore } from "./assistant-proactivity-store.js";
import { processAssistantEvents } from "./assistant-proactivity.js";
import { collectMail, collectCalendar } from "./assistant-event-sources.js";
import type { ConnectorRequest } from "./connectors/request.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "assistant-proactivity-"));
  const path = join(root, "runtime.sqlite"), store = await AssistantProactivityStore.open(path);
  const event = { id: "email-1", source: "gmail", projectId: null, at: 100, text: "Alex sent the signed counterpart for Project Aster." };
  store.ingest("gmail", "100", [event]);
  return { store, path, event, close: async () => { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test("scratchpad starts empty, survives restart, requires revisions and is never populated by collected events", async () => {
  const f = await fixture();
  try {
    expect(f.store.scratchpad()).toEqual({ text: "", revision: 0, updatedAt: 0 });
    f.store.updateScratchpad({ text: "Notify when Alex sends the Aster signature page. Remove after delivery.", revision: 0 }, 100);
    expect(() => f.store.updateScratchpad({ text: "stale", revision: 0 })).toThrow("Read the current scratchpad");
    const other = await AssistantProactivityStore.open(f.path);
    try {
      expect(other.scratchpad()).toEqual(f.store.scratchpad());
      expect(other.markBriefingOffer("offered")).toBe(true);
      expect(f.store.markBriefingOffer("offered")).toBe(false);
      other.markBriefingOffer("declined");
      expect(f.store.briefingOffer().state).toBe("declined");
      expect(f.store.markBriefingOffer("offered")).toBe(false);
      expect(f.store.lease("one", 100)).toBe(true);
      expect(other.lease("two", 101)).toBe(false);
      f.store.release("one");
      expect(other.lease("two", 102)).toBe(true);
      other.updateScratchpad({ text: "", revision: 1 });
      expect(f.store.scratchpad().text).toBe("");
    } finally { other.close(); }
  } finally { await f.close(); }
});

test("empty scratchpad never calls a model; strict gate rejection never wakes the Assistant", async () => {
  const f = await fixture(); let classifications = 0, decisions = 0, deliveries = 0;
  const operations = { allowed: async () => true, classify: async () => { classifications++; return { [f.event.id]: 0 }; },
    decide: async () => { decisions++; return { notify: true, message: "Signature arrived" }; }, deliver: async () => { deliveries++; return true; } };
  try {
    await processAssistantEvents(f.store, operations);
    expect([classifications, decisions, deliveries]).toEqual([0, 0, 0]);
    f.store.updateScratchpad({ text: "Only tell me about Lisa's task assignments", revision: 0 });
    await processAssistantEvents(f.store, operations);
    expect([classifications, decisions, deliveries]).toEqual([1, 0, 0]);
    expect(f.store.pending()).toEqual([]);
    expect(f.store.scratchpad().text).toBe("Only tell me about Lisa's task assignments");
  } finally { await f.close(); }
});

test("the Assistant can remain silent after a match, or deliver exactly once", async () => {
  for (const notify of [false, true]) {
    const f = await fixture(); let deliveries = 0;
    try {
      f.store.updateScratchpad({ text: "Alex's Aster signature page", revision: 0 });
      const operations = { allowed: async () => true, classify: async () => ({ [f.event.id]: 0.95 }), decide: async () => ({ notify, message: "Alex's signature page arrived." }), deliver: async () => { deliveries++; return true; } };
      await processAssistantEvents(f.store, operations);
      f.store.ingest("gmail", "200", [f.event]);
      await processAssistantEvents(f.store, operations);
      expect(deliveries).toBe(notify ? 1 : 0);
      expect(f.store.pending()).toEqual([]);
    } finally { await f.close(); }
  }
});

test("every event is classified before one combined Assistant decision, including matches past the first batch", async () => {
  for (const notify of [true, false]) {
    const f = await fixture();
    const events = Array.from({ length: 45 }, (_, index) => ({ ...f.event, id: `event-${index}` }));
    const relevant = [events[0], events[21], events[44]];
    const classified: string[] = [], batches: number[] = [];
    let decisions = 0, deliveries = 0;
    try {
      f.store.updateScratchpad({ text: "Alex's signature", revision: 0 });
      f.store.ingest("gmail", "200", events);
      await processAssistantEvents(f.store, {
        allowed: async () => true,
        classify: async (_, batch) => {
          batches.push(batch.length);
          classified.push(...batch.map(event => event.id));
          return Object.fromEntries(batch.map(event => [event.id, relevant.some(match => match.id === event.id) ? 0.95 : 0.1]));
        },
        decide: async (_, matches) => {
          decisions++;
          expect(classified).toEqual([f.event.id, ...events.map(event => event.id)]);
          expect(matches).toEqual(relevant.map(event => ({ ...event, relevanceProbability: 0.95 })));
          return { notify, message: "The signature and two related updates arrived." };
        },
        deliver: async (matches, message, revision) => {
          deliveries++;
          expect(matches).toEqual(relevant.map(event => ({ ...event, relevanceProbability: 0.95 })));
          f.store.prepareDelivery(matches.map(event => event.id), "combined", "today", message, revision);
          return true;
        },
      });
      expect(batches).toEqual([20, 20, 6]);
      expect(decisions).toBe(1);
      expect(deliveries).toBe(notify ? 1 : 0);
      expect(f.store.pending()).toEqual([]);
      expect(f.store.recent()).toHaveLength(notify ? relevant.length : 0);
      expect(f.store.deliveryContent("combined")).toBeUndefined();
    } finally { await f.close(); }
  }
});

test("a later classification failure sends no partial result and retains the complete interval for retry", async () => {
  const f = await fixture();
  let batches = 0, decisions = 0;
  try {
    f.store.updateScratchpad({ text: "Alex's signature", revision: 0 });
    f.store.ingest("gmail", "200", Array.from({ length: 25 }, (_, index) => ({ ...f.event, id: `event-${index}` })));
    await expect(processAssistantEvents(f.store, {
      allowed: async () => true,
      classify: async (_, events) => { if (++batches === 2) throw new Error("Jev unavailable"); return Object.fromEntries(events.map(event => [event.id, 0.95])); },
      decide: async () => { decisions++; return null; }, deliver: async () => true,
    })).rejects.toThrow("Jev unavailable");
    expect(batches).toBe(2);
    expect(decisions).toBe(0);
    expect(f.store.pending()).toHaveLength(26);
    expect(f.store.assessment(f.event.id)).toBeNull();
  } finally { await f.close(); }
});

test("missing, unknown or invalid probability scores never become a partial Assistant update", async () => {
  const f = await fixture();
  const invalid: Record<string, number>[] = [{}, { "email-1": 0.9, unknown: 0.8 }, { "email-1": 1.1 }, { "email-1": Number.NaN }];
  let decisions = 0;
  try {
    f.store.updateScratchpad({ text: "Alex's signature", revision: 0 });
    for (const scores of invalid) {
      await expect(processAssistantEvents(f.store, {
        allowed: async () => true, classify: async () => scores,
        decide: async () => { decisions++; return null; },
        deliver: async () => { throw new Error("Nothing to deliver"); },
      })).rejects.toThrow();
      expect(f.store.pending()).toEqual([f.event]);
      expect(f.store.assessment(f.event.id)).toBeNull();
      expect(decisions).toBe(0);
    }
  } finally { await f.close(); }
});

test("only probabilities of at least 80 percent reach the Assistant", async () => {
  const f = await fixture();
  try {
    f.store.updateScratchpad({ text: "Alex's signature", revision: 0 });
    const boundary = { ...f.event, id: "boundary" }, above = { ...f.event, id: "above" };
    f.store.ingest("gmail", "200", [boundary, above]);
    let decisions = 0;
    await processAssistantEvents(f.store, {
      allowed: async () => true, classify: async () => ({ [f.event.id]: 0.79, [boundary.id]: 0.8, [above.id]: 0.81 }),
      decide: async (_, events) => {
        decisions++;
        expect(events).toEqual([{ ...boundary, relevanceProbability: 0.8 }, { ...above, relevanceProbability: 0.81 }]);
        return { notify: false, message: "" };
      },
      deliver: async () => { throw new Error("Nothing to deliver"); },
    });
    expect(decisions).toBe(1);
    expect(f.store.pending()).toEqual([]);
    const reopened = await AssistantProactivityStore.open(f.path);
    try {
      expect(reopened.assessment(f.event.id)).toEqual({ revision: 1, probability: 0.79, reason: "below_threshold" });
      expect(reopened.assessment(boundary.id)).toEqual({ revision: 1, probability: 0.8, reason: "assistant_silent" });
      expect(reopened.assessment(above.id)).toEqual({ revision: 1, probability: 0.81, reason: "assistant_silent" });
      reopened.prune(Date.now() + 31 * 86400_000);
      expect(reopened.assessment(f.event.id)).toBeNull();
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test("access denial is distinguishable from a model rejecting an event", async () => {
  const f = await fixture();
  try {
    f.store.updateScratchpad({ text: "Alex's signature", revision: 0 });
    await processAssistantEvents(f.store, {
      allowed: async () => false,
      classify: async () => { throw new Error("Must not send inaccessible data to a model"); },
      decide: async () => { throw new Error("No decision allowed"); },
      deliver: async () => { throw new Error("No delivery allowed"); },
    });
    expect(f.store.assessment(f.event.id)).toEqual({ revision: 1, probability: null, reason: "access_denied" });
    expect(f.store.pending()).toEqual([]);
  } finally { await f.close(); }
});

test("combined delivery retries preserve the exact message and receipt across restart without absorbing new events", async () => {
  const f = await fixture();
  const second = { ...f.event, id: "email-2" }, third = { ...f.event, id: "email-3" };
  try {
    f.store.updateScratchpad({ text: "Alex's signature", revision: 0 });
    f.store.ingest("gmail", "200", [second]);
    await expect(processAssistantEvents(f.store, {
      allowed: async () => true, classify: async (_, events) => Object.fromEntries(events.map(event => [event.id, 0.95])),
      decide: async () => ({ notify: true, message: "Two signatures arrived." }),
      deliver: async (events, message, revision) => {
        f.store.prepareDelivery(events.map(event => event.id), "combined", "yesterday", message, revision);
        throw new Error("Disconnected");
      },
    })).rejects.toThrow("Disconnected");
    const reopened = await AssistantProactivityStore.open(f.path);
    try {
      reopened.ingest("gmail", "300", [third]);
      expect(() => reopened.prepareDelivery([f.event.id, third.id], "mixed", "today", "Mixed", 1)).toThrow("Cannot combine");
      let retries = 0, decisions = 0;
      await processAssistantEvents(reopened, {
        allowed: async () => true, reconcile: async () => false,
        classify: async (_, events) => { expect(events).toEqual([third]); return { [third.id]: 0.95 }; },
        decide: async (_, events) => { decisions++; expect(events).toEqual([{ ...third, relevanceProbability: 0.95 }]); return { notify: false, message: "" }; },
        deliver: async (events, message, revision) => {
          retries++;
          expect(events).toEqual([f.event, second]);
          expect(message).toBe("Two signatures arrived.");
          expect(reopened.prepareDelivery(events.map(event => event.id), "duplicate", "today", message, revision)).toEqual({ id: "combined", sessionId: "yesterday" });
          return true;
        },
      });
      expect([retries, decisions]).toEqual([1, 1]);
      expect(reopened.pending()).toEqual([]);
      expect(reopened.recent()).toHaveLength(2);
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test("one native receipt reconciles the entire combined update without reclassifying or delivering it again", async () => {
  const f = await fixture();
  try {
    const second = { ...f.event, id: "email-2" };
    f.store.ingest("gmail", "200", [second]);
    f.store.prepareDelivery([f.event.id, second.id], "combined", "yesterday", "Two updates", 0);
    let reconciliations = 0;
    await processAssistantEvents(f.store, {
      allowed: async () => true,
      classify: async () => { throw new Error("Already sent"); },
      decide: async () => { throw new Error("Already sent"); },
      deliver: async () => { throw new Error("Already sent"); },
      reconcile: async receipt => { reconciliations++; return receipt.id === "combined"; },
    });
    expect(reconciliations).toBe(1);
    expect(f.store.pending()).toEqual([]);
    expect(f.store.recent()).toHaveLength(2);
  } finally { await f.close(); }
});

test("edits during classification, revoked access and a busy user turn prevent delivery", async () => {
  for (const change of ["scratchpad", "access", "busy"]) {
    const f = await fixture(); let allowed = true, deliveries = 0;
    try {
      f.store.updateScratchpad({ text: "Alex's signature", revision: 0 });
      await processAssistantEvents(f.store, {
        allowed: async () => allowed,
        classify: async () => { if (change === "scratchpad") f.store.updateScratchpad({ text: "Only Lisa now", revision: 1 }); return { [f.event.id]: 0.95 }; },
        decide: async () => { if (change === "access") allowed = false; return change === "busy" ? null : { notify: true, message: "Arrived" }; },
        deliver: async () => { deliveries++; return true; },
      });
      expect(deliveries).toBe(0);
      expect(f.store.pending()).toHaveLength(1);
    } finally { await f.close(); }
  }
});

test("failed classification or publication retains the event for receipt reconciliation", async () => {
  const f = await fixture();
  try {
    f.store.updateScratchpad({ text: "Alex's signature", revision: 0 });
    const operations = { allowed: async () => true, classify: async () => ({ [f.event.id]: 0.95 }), decide: async () => ({ notify: true, message: "Arrived" }),
      deliver: async () => { f.store.prepareDelivery([f.event.id], "receipt", "today", "Arrived", 1); throw new Error("Disconnected"); } };
    await expect(processAssistantEvents(f.store, operations)).rejects.toThrow("Disconnected");
    expect(f.store.pending()).toHaveLength(1);
    expect(f.store.delivery(f.event.id)).toEqual({ id: "receipt", sessionId: "today" });
    expect(f.store.prepareDelivery([f.event.id], "duplicate", "today", "Arrived", 1)).toEqual({ id: "receipt", sessionId: "today" });
  } finally { await f.close(); }
});

test("Gmail collection follows empty pages and only emits newly received messages in the interval", async () => {
  const calls: string[] = [];
  const request: ConnectorRequest = async path => {
    calls.push(path);
    if (path.includes("/messages?")) return path.includes("pageToken=next") ? { messages: [{ id: "new" }, { id: "old" }, { id: "sent" }] } : { messages: [], nextPageToken: "next" };
    const id = path.includes("/new?") ? "new" : path.includes("/old?") ? "old" : "sent";
    return { id, internalDate: id === "old" ? "9000" : "12000", snippet: "signed", labelIds: id === "sent" ? ["SENT"] : ["INBOX"] };
  };
  const events = await collectMail(request, "gmail", "account", 10000, 20000);
  expect(events).toHaveLength(1);
  expect(events[0].text).toContain('"id":"new"');
  expect(calls[0]).toContain("after%3A10");
  expect(calls).toHaveLength(5);
});

test("Outlook collection validates continuation origins and propagates failures without a checkpoint", async () => {
  const request: ConnectorRequest = async path => path.includes("/mailFolders/") ? { id: "sent" } : ({ value: [], "@odata.nextLink": "https://untrusted.example/v1.0/me/messages?skip=1" });
  await expect(collectMail(request, "outlook", "account", 10000, 20000)).rejects.toThrow();
  await expect(collectMail(async () => { throw new Error("Reconnect"); }, "outlook", "account", 10000, 20000)).rejects.toThrow("Reconnect");
});

test("an admitted notification is reconciled before a changed or cleared scratchpad can reclassify it", async () => {
  const f = await fixture();
  try {
    f.store.prepareDelivery([f.event.id], "receipt", "yesterday", "Arrived", 0);
    let decisions = 0;
    await processAssistantEvents(f.store, {
      allowed: async () => true, classify: async () => ({}),
      decide: async () => { decisions++; return null; }, deliver: async () => false,
      reconcile: async receipt => receipt.id === "receipt" && receipt.sessionId === "yesterday",
    });
    expect(decisions).toBe(0);
    expect(f.store.pending()).toEqual([]);
    expect(f.store.recent()).toHaveLength(1);
  } finally { await f.close(); }
});

test("Outlook skips sent mail and deduplicates stable received IDs", async () => {
  const request: ConnectorRequest = async path => path.includes("/mailFolders/") ? { id: "sent" } : ({ value: [
    { id: "outgoing", receivedDateTime: "2026-10-28T10:01:00Z", parentFolderId: "sent" },
    { id: "incoming", receivedDateTime: "2026-10-28T10:01:00Z", parentFolderId: "inbox" },
  ] });
  const since = Date.parse("2026-10-28T10:00:00Z"), until = since + 180000;
  expect(await collectMail(request, "outlook", "account", since, until)).toEqual(await collectMail(request, "outlook", "account", since, until));
  expect(await collectMail(request, "outlook", "account", since, until)).toHaveLength(1);
});

test("calendar collection ignores old records, preserves cancellations and distinguishes calendars", async () => {
  const request: ConnectorRequest = async () => ({ items: [
    { id: "new", updated: "2026-10-28T10:01:00Z", status: "cancelled" },
    { id: "old", updated: "2026-10-27T10:01:00Z" },
  ] });
  const since = Date.parse("2026-10-28T10:00:00Z"), until = since + 180000;
  const first = await collectCalendar(request, "google-calendar", "one", "account", since, until);
  const second = await collectCalendar(request, "google-calendar", "two", "account", since, until);
  expect(first).toHaveLength(1);
  expect(first[0].text).toContain("cancelled");
  expect(first[0].id).not.toBe(second[0].id);
});

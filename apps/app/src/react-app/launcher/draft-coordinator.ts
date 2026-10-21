import type { AssistantContextItem, AssistantExecutionTarget } from "@legalwork/types/launcher";
import type { ModelRef } from "@/app/types";

/** The complete draft: everything a surface needs to continue exactly where the other left off. */
export type LauncherDraft = {
  conversationId: string;
  revision: number;
  text: string;
  context: AssistantContextItem[];
  target: AssistantExecutionTarget;
  searchScope: string | null;
  pendingTranscription: string | null;
  model: ModelRef | null;
  variant: string | null;
  submission: { requestId: string; messageId: string; state: string } | null;
  updatedAt: number;
};
export type DraftLease = { conversationId: string; owner: string; revision: number; since: number };
export type DraftFile = { drafts: Record<string, LauncherDraft>; leases: Record<string, DraftLease> };
export type DraftStorage = { read: () => Promise<DraftFile>; write: (file: DraftFile) => Promise<void> };
export type DraftMessage = { type: "draft"; draft: LauncherDraft; owner: string } | { type: "lease"; lease: DraftLease | null; conversationId: string };
export const EMPTY_DRAFT_FILE: DraftFile = { drafts: {}, leases: {} };
const LEASE_STALE_MS = 15 * 60_000;

export function emptyLauncherDraft(conversationId: string, now = Date.now()): LauncherDraft {
  return { conversationId, revision: 0, text: "", context: [], target: { kind: "assistant" }, searchScope: null, pendingTranscription: null, model: null, variant: null, submission: null, updatedAt: now };
}
export function isDraftEmpty(draft: LauncherDraft) {
  return !draft.text.trim() && !draft.context.length && !draft.pendingTranscription && !draft.submission;
}

/**
 * One authoritative, revisioned draft per conversation with a single editor
 * at a time. Focusing a composer or expanding to Home transfers the lease and
 * the whole draft together; notifications only say that something changed.
 */
export class DraftCoordinator {
  private file: DraftFile = { drafts: {}, leases: {} };
  private loaded: Promise<void> | null = null;
  private listeners = new Set<(conversationId: string) => void>();
  private writes = Promise.resolve();
  constructor(private storage: DraftStorage, private channel?: { post: (message: DraftMessage) => void; subscribe: (listener: (message: DraftMessage) => void) => () => void }, private now: () => number = Date.now) {
    channel?.subscribe(message => this.receive(message));
  }
  private load() {
    if (!this.loaded) this.loaded = this.storage.read().then(file => { this.file = { drafts: { ...file.drafts, ...this.file.drafts }, leases: { ...file.leases, ...this.file.leases } }; }).catch(() => {});
    return this.loaded;
  }
  private persist() {
    const snapshot: DraftFile = { drafts: { ...this.file.drafts }, leases: { ...this.file.leases } };
    this.writes = this.writes.catch(() => {}).then(() => this.storage.write(snapshot));
    return this.writes;
  }
  private emit(conversationId: string) { for (const listener of this.listeners) listener(conversationId); }
  subscribe(listener: (conversationId: string) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async ready() { await this.load(); }
  get(conversationId: string): LauncherDraft { return this.file.drafts[conversationId] ?? emptyLauncherDraft(conversationId, this.now()); }
  lease(conversationId: string): DraftLease | null { return this.file.leases[conversationId] ?? null; }
  owns(conversationId: string, owner: string) { return this.file.leases[conversationId]?.owner === owner; }
  /** Take over editing. The previous editor keeps displaying but can no longer submit or mutate. */
  async claim(conversationId: string, owner: string): Promise<{ draft: LauncherDraft; lease: DraftLease }> {
    await this.load();
    const lease: DraftLease = { conversationId, owner, revision: this.get(conversationId).revision, since: this.now() };
    this.file.leases[conversationId] = lease;
    this.channel?.post({ type: "lease", lease, conversationId });
    await this.persist();
    this.emit(conversationId);
    return { draft: this.get(conversationId), lease };
  }
  /** Mutations require the lease and bump the revision; a stale editor is refused instead of overwriting. */
  async update(conversationId: string, owner: string, patch: Partial<Omit<LauncherDraft, "conversationId" | "revision" | "updatedAt">>): Promise<LauncherDraft> {
    await this.load();
    const lease = this.file.leases[conversationId];
    if (!lease || lease.owner !== owner) throw new Error("draft_lease_lost");
    const current = this.get(conversationId);
    const next: LauncherDraft = { ...current, ...patch, conversationId, revision: current.revision + 1, updatedAt: this.now() };
    this.file.drafts[conversationId] = next;
    lease.revision = next.revision;
    this.channel?.post({ type: "draft", draft: next, owner });
    await this.persist();
    this.emit(conversationId);
    return next;
  }
  async clear(conversationId: string, owner: string) {
    return this.update(conversationId, owner, { ...emptyLauncherDraft(conversationId, this.now()), model: this.get(conversationId).model, variant: this.get(conversationId).variant });
  }
  async release(conversationId: string, owner: string) {
    await this.load();
    if (this.file.leases[conversationId]?.owner !== owner) return false;
    delete this.file.leases[conversationId];
    this.channel?.post({ type: "lease", lease: null, conversationId });
    await this.persist();
    this.emit(conversationId);
    return true;
  }
  /** A crashed or stale editor's lease is reclaimable; its last persisted draft wins over anything older. */
  isLeaseStale(conversationId: string) {
    const lease = this.file.leases[conversationId];
    return Boolean(lease && this.now() - lease.since > LEASE_STALE_MS);
  }
  private receive(message: DraftMessage) {
    if (message.type === "lease") {
      if (message.lease) this.file.leases[message.conversationId] = message.lease;
      else delete this.file.leases[message.conversationId];
      this.emit(message.conversationId);
      return;
    }
    const current = this.file.drafts[message.draft.conversationId];
    if (current && current.revision >= message.draft.revision) return;
    this.file.drafts[message.draft.conversationId] = message.draft;
    this.emit(message.draft.conversationId);
  }
  /** Reconcile with the persisted file after a crash or reconnect: never overwrite a newer revision. */
  async reconcile() {
    const file = await this.storage.read().catch(() => EMPTY_DRAFT_FILE);
    for (const [id, draft] of Object.entries(file.drafts)) {
      const current = this.file.drafts[id];
      if (!current || current.revision < draft.revision) { this.file.drafts[id] = draft; this.emit(id); }
    }
    for (const [id, lease] of Object.entries(file.leases)) {
      const current = this.file.leases[id];
      if (!current || current.since < lease.since) this.file.leases[id] = lease;
    }
    for (const id of Object.keys(this.file.leases)) if (!file.leases[id] && this.file.leases[id]) delete this.file.leases[id];
  }
}

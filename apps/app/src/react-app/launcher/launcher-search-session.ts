import type { LauncherSearchKind, LauncherSearchResponse, LauncherSearchResult, LauncherSourceState } from "@legalwork/types/launcher";

export type SearchRun = (input: { query: string; kinds: LauncherSearchKind[]; projectId: string | null; content: boolean }, signal: AbortSignal) => Promise<LauncherSearchResponse>;
export type SearchSnapshot = { items: LauncherSearchResult[]; sources: LauncherSourceState[]; pending: boolean; query: string; error: string | null };
export const resultKey = (item: Pick<LauncherSearchResult, "kind" | "sourceId" | "id">) => `${item.kind}\u0000${item.sourceId}\u0000${item.id}`;

/**
 * Two-phase search per keystroke: a fast filename/metadata pass renders
 * first, then a content pass enriches without reordering what the user is
 * looking at. Obsolete queries are cancelled, and results merge by stable ID.
 */
export class LauncherSearchSession {
  private controller: AbortController | null = null;
  private generation = 0;
  private snapshot: SearchSnapshot = { items: [], sources: [], pending: false, query: "", error: null };
  private listeners = new Set<(snapshot: SearchSnapshot) => void>();
  constructor(private run: SearchRun, private options: { debounceMs?: number; contentPass?: boolean } = {}) {}
  private timer: ReturnType<typeof setTimeout> | null = null;
  current() { return this.snapshot; }
  subscribe(listener: (snapshot: SearchSnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(next: Partial<SearchSnapshot>) { this.snapshot = { ...this.snapshot, ...next }; for (const listener of this.listeners) listener(this.snapshot); }
  cancel() { this.controller?.abort(); this.controller = null; if (this.timer) clearTimeout(this.timer); this.timer = null; this.publish({ pending: false }); }
  search(input: { query: string; kinds: LauncherSearchKind[]; projectId: string | null }) {
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    const generation = ++this.generation;
    const query = input.query.trim();
    if (!query && !input.kinds.includes("tasks") && !input.projectId) { this.controller = null; this.publish({ items: [], sources: [], pending: false, query, error: null }); return; }
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ pending: true, query, error: null });
    this.timer = setTimeout(() => { this.timer = null; void this.execute(generation, controller, { ...input, query }); }, this.options.debounceMs ?? 120);
  }
  private merge(previous: LauncherSearchResult[], incoming: LauncherSearchResult[]) {
    // Keep the order of rows already on screen; append newcomers after them.
    const seen = new Map(incoming.map(item => [resultKey(item), item]));
    const kept = previous.flatMap(item => { const next = seen.get(resultKey(item)); if (!next) return []; seen.delete(resultKey(item)); return [next]; });
    return [...kept, ...seen.values()];
  }
  private async execute(generation: number, controller: AbortController, input: { query: string; kinds: LauncherSearchKind[]; projectId: string | null }) {
    try {
      const fast = await this.run({ ...input, content: false }, controller.signal);
      if (controller.signal.aborted || generation !== this.generation) return;
      const wantsContent = this.options.contentPass !== false && input.kinds.includes("files") && input.query.length >= 2;
      this.publish({ items: this.merge(this.snapshot.query === input.query ? this.snapshot.items : [], fast.items), sources: fast.sources, pending: wantsContent });
      if (!wantsContent) return;
      const full = await this.run({ ...input, content: true }, controller.signal);
      if (controller.signal.aborted || generation !== this.generation) return;
      this.publish({ items: this.merge(this.snapshot.items, full.items), sources: full.sources, pending: false });
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return;
      this.publish({ pending: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

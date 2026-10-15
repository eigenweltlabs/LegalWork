type Statuses = Record<string, { status: string }>;
type Connector = { name: string; config: Record<string, unknown>; disabledByTools?: boolean };
type Attempt = { retryAt: number; pending?: Promise<void> };

/** Reconnect transports without editing configuration, removing tokens, or replaying tools. */
export class McpRecovery {
  private attempts = new Map<string, Attempt>();
  private queues = new Map<string, Promise<void>>();

  constructor(private now = Date.now, private retryDelayMs = 30_000) {}

  async recover(input: {
    engine: string;
    directory: string;
    statuses: Statuses;
    connectors: () => Promise<Connector[]>;
    readStatuses: () => Promise<Statuses>;
    connect: (name: string) => Promise<unknown>;
  }): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const [name, status] of Object.entries(input.statuses)) {
      const key = JSON.stringify([input.engine, input.directory, name]);
      const previous = this.attempts.get(key);
      if (status.status !== "failed") {
        if (!previous?.pending) this.attempts.delete(key);
        continue;
      }
      if (previous?.pending) {
        pending.push(previous.pending);
        continue;
      }
      if (previous && previous.retryAt > this.now()) continue;
      const attempt: Attempt = { retryAt: this.now() + this.retryDelayMs };
      this.attempts.set(key, attempt);
      // Workspaces share OAuth credentials. Serialize reconnects for the same
      // engine/connector so a rotating refresh token is never used concurrently.
      const queueKey = JSON.stringify([input.engine, name]);
      const queued = this.queues.get(queueKey) ?? Promise.resolve();
      const operation = queued.then(async () => {
        const connector = (await input.connectors()).find(item => item.name === name);
        if (!connector || connector.config.type !== "remote" || connector.config.enabled === false || connector.disabledByTools) return;
        // A manual disconnect or sign-in may have happened while queued.
        if ((await input.readStatuses())[name]?.status !== "failed") return;
        await input.connect(name);
      }).catch(() => {
        // The engine retains its per-connector error. A later refresh retries.
      }).finally(() => {
        attempt.pending = undefined;
        attempt.retryAt = this.now() + this.retryDelayMs;
        if (this.queues.get(queueKey) === operation) this.queues.delete(queueKey);
      });
      attempt.pending = operation;
      this.queues.set(queueKey, operation);
      pending.push(operation);
    }
    await Promise.all(pending);
  }
}

/** Keep a successful deletion across retries of desktop/local cleanup. */
export function createProjectRemoval() {
  let result: { sessionIds: string[] } | null = null;
  return {
    get deleted() { return result !== null; },
    async run(remove: () => Promise<{ sessionIds: string[] }>, finish: (sessionIds: string[]) => Promise<void>) {
      result ??= await remove();
      await finish(result.sessionIds);
    },
  };
}

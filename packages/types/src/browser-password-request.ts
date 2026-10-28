import { z } from "zod";

/** Native form metadata and answers contain references only, never a password. */
export const browserPasswordRequestSchema = z.object({
  website: z.string().url().refine(value => {
    try {
      const url = new URL(value);
      return url.origin === value && (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    } catch { return false; }
  }),
  label: z.string().min(1).max(200),
  username: z.string().max(500),
}).strict();

export type BrowserPasswordRequest = z.infer<typeof browserPasswordRequestSchema>;

export function browserPasswordRequest(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const parsed = browserPasswordRequestSchema.safeParse(Reflect.get(metadata, "legalworkBrowserPassword"));
  return parsed.success ? parsed.data : null;
}

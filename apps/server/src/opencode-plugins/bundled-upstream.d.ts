// These pinned packages ship JavaScript without TypeScript declarations.
declare module "opencode-chrome-devtools" {
  const plugin: () => Promise<{ tool: Record<string, unknown> }>;
  export default plugin;
}
declare module "opencode-anthropic-auth" {
  export const AnthropicAuthPlugin: (input: { client: unknown }) => Promise<Record<string, unknown>>;
}

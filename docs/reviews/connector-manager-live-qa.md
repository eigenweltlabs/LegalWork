# Connector manager: Electron and live-provider QA

Tested on 19 October 2026, macOS arm64, Electron 43.7.5, stock OpenCode 1.18.29. The native engine SHA-256 was `9c46fd8b183c575453ce1b57a4d6500e34f5d19825e8f2653356415355992188`.

The Electron profile, server configuration, data and XDG directories were isolated. Two disposable projects shared one LegalWork server and connector vault. The installed LegalWork profile and its rotating grants were not reused.

## Real providers and execution

- [Cloudflare Documentation MCP](https://github.com/cloudflare/mcp-server-cloudflare): `https://docs.mcp.cloudflare.com/mcp`, two public tools.
- [Linear read-only MCP](https://linear.app/docs/mcp): `https://mcp.linear.app/mcp/readonly`, 38 read tools, genuine browser OAuth and provider refresh tokens.
- A deterministic local OpenAI-compatible model selected tools. The engine, gateway, provider discovery, OAuth exchanges, refreshes and tool results were real. No paid model or external write operation was needed.

Twenty-five actual agent tool invocations completed: one task entered in the native Electron UI and six rounds of four concurrent tasks across two projects and both services. The gateway was also exercised directly using SDK clients; these calls are separate from the agent invocation count.

![Electron task with a completed real Cloudflare search](assets/connector-manager-real-mcp.png)

![Successful real Linear OAuth reconnection](assets/connector-manager-linear-oauth.png)

## Live checks

| Scenario | Observed result |
| --- | --- |
| Add an anonymous remote connector in Electron | Probe and save work; real Cloudflare search returns documentation |
| Add OAuth connector and authorize in browser | Linear connects, with no engine-owned OAuth grant |
| Discovery and read calls in both projects | Both discover 2 Cloudflare tools and 38 Linear tools; documentation search and `list_teams` succeed |
| Four simultaneous clients after expiry | Exactly one genuine Linear refresh; access and refresh tokens both rotate |
| Upstream 401 | One genuine refresh and a successful authenticated retry |
| Temporary token endpoint network failure | Request fails; grant stays saved; later genuine refresh succeeds |
| Temporary upstream connection failure | Request fails; later call reconnects without another browser sign-in |
| Cancel a Cloudflare request | Other project's request completes; original project remains usable |
| Disable shared connector | Both existing gateway sessions lose access |
| Enable it again | Fresh session works using the retained grant |
| Rebuild both engine instances | Both keep working with correctly scoped gateway URLs; no new OAuth code exchange |
| Use a gateway bearer in another workspace | HTTP 401 |
| Use a gateway bearer for account management | HTTP 401 |
| Force-kill Electron after token rotation, then restart | Store ownership recovers; encrypted rotated grant opens and real reads work without sign-in |
| Log out while a successful provider refresh response is delayed | Late tokens are discarded; both projects require sign-in; no token resurrection |
| Sign in again through Electron | Browser OAuth completes and both services pass another twelve agent calls |
| Inspect persisted credential locations | 16,331 test-profile files scanned for the current provider access/refresh/client secrets; zero plaintext matches; vault and OS-protected key file both mode 0600 |

Fault injection and inspection ran in an unshipped Electron entry wrapper, confined to the disposable profile. Expiry was advanced by changing the vault record's expiry metadata. The 401 and network failures were injected at the manager's fetch boundary; token exchanges and successful tool calls still went to the real providers. The logout race delayed delivery of a genuinely successful refresh response, after Linear had already issued the new token.

## Bugs found and fixed

1. The renderer saved a connector through LegalWork, then tried to send its provider configuration directly to OpenCode. The sandbox ownership guard rejected the second write with HTTP 403, so the UI falsely reported failure. The renderer now only observes engine status after the server registers the connector. The UI regression fixture rejects all direct engine MCP writes.
2. Startup unnecessarily probed engines when no connectors existed, racing workspace activation and adding requests. Empty registries now skip that probe. Firm-only connections still rebind, covered by a regression test. Startup readiness probes also stop when the manager shuts down.
3. Three older integration fixtures assumed plaintext engine configuration or omitted the now-required vault key. They now verify the vault-backed descriptor, hydrated management view and derived gateway configuration.

## Automated checks

- Focused server regression: **160 passed, 5 skipped**, 772 assertions, 16 files. The skipped tests are older optional native recovery tests; the new native engine test ran separately.
- Stock-engine integration: **1 passed**, 26 assertions, two real unmodified engine processes.
- App connector regression: **81 passed**, 276 assertions; changed connection-store suite also rerun with all direct engine writes rejected.
- App TypeScript check, server build and desktop vault-key tests passed.
- Full server suite: **2,341 passed, 68 skipped, 2 failed**. The same two failures reproduced on an archive of base `e3900fa44b0215167da1845637ccc3c9f26a601e`, using the same Bun 1.3.14 and installed dependencies: `serve-node.test.ts` streaming-error handling and `wiki/store.test.ts` graph-poll invalidation. Neither implementation nor test file differs from the base. The full local suite is therefore not green.

Re-run the core automated checks from the repository root:

```sh
pnpm --filter @legalwork/app typecheck
pnpm --filter legalwork-server build
node --test apps/desktop/electron/mcp-vault-key.test.mjs
OPENCODE_TEST_BINARY=/absolute/path/to/stock/opencode \
  bun test --preload ./apps/server/test-preload.ts apps/server/src/mcp-manager.engine.e2e.test.ts
bun test apps/app/tests/mcp-oauth-flow.test.ts apps/app/tests/mcp-auth-identity.test.ts \
  apps/app/tests/mcp-connect-state.test.ts apps/app/tests/mcp-configuration.test.tsx \
  apps/app/tests/connections-remove-mcp.test.ts apps/app/tests/mcp-logout-truthfulness.test.ts
pnpm --filter legalwork-server test
```

To reproduce the manual flow, launch `pnpm dev:electron` with a new `LEGALWORK_ELECTRON_USERDATA`, `LEGALWORK_SERVER_CONFIG`, `LEGALWORK_DATA_DIR` and XDG directories. Create two projects; add the two provider URLs under Settings → Integrations → Connectors. Complete Linear OAuth, issue read-only tasks from both projects, restart the app, disable/enable, log out and sign in again. Test-specific harness scripts and redacted result records remain in the ignored local `artifacts/connector-manager-live-qa` directory; they are not part of the shipped app.

## Limits

Real-provider coverage is macOS with Linear and Cloudflare. Firm Hub behavior, terminal OAuth errors, opaque provider URLs, legacy SSE and the remaining protocol cases use the controlled integration fixtures. Windows/Linux secure-storage behavior and real firm deployments were not exercised interactively in this run. Built-in Google/Microsoft adapters are outside this custom remote MCP manager path.

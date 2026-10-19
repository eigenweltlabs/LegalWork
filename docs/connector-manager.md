# Server-owned MCP connections

LegalWork owns custom remote MCP connections and remote Firm Hub connectors.
Workspace engines consume an authenticated loopback MCP gateway. OpenCode itself
is unchanged; no engine fork or SDK patch is required.

## Ownership and data flow

```text
LegalWork app -- connect / callback / logout --> connector manager
                                                     |
workspace engine -- scoped gateway --> MCP client ---+--> provider
                                                     |
                                             encrypted credential vault
```

- The existing shared connector registry remains authoritative. A connection
  normally serves every workspace; an explicit workspace override has its own
  connection and grant. Connections are never merged just because URLs match.
- The manager owns OAuth discovery, client registration, PKCE, state validation,
  code exchange, refresh, upstream transports, and connection health.
- Engine MCP entries contain only a gateway URL, a workspace/connection bearer,
  and `oauth: false`. Provider headers, client secrets, access tokens, and refresh
  tokens stay in the server. The server's vault encryption key is removed from
  managed engine environments.
- The bundled `legalwork-mcp-gateway` plugin obtains each folder's effective
  entries at instance creation through a separate runtime capability. This keeps
  the correct workspace binding after rebuilds despite the shared bootstrap file.
  Its internal configuration endpoint cannot connect, log out, or edit accounts.
- Local command MCPs keep their execution path. Built-in Google/Microsoft
  integrations retain their existing server-owned provider adapters.

## Persistence and lifecycle

MCP configuration and credentials use the existing `OAuthVault` and its
`storage-oauth.vault` file, alongside built-in connector capabilities and
file-storage OAuth grants. A separate `managed-mcp` entry owns the MCP schema;
the shared vault serializes and merges writes without replacing other entries.
Registry rows hold public descriptors referencing stable connection IDs.

Encryption and key handling follow the existing vault policy: AES-256-GCM with
`LEGALWORK_ENCRYPTION_KEY`, or its existing adjacent `storage-oauth.vault.key`
file (mode 0600). No MCP-specific encryption code, key provider or key file is
created. `LEGALWORK_STORAGE_STORE` overrides the shared storage location for MCP
as well as the existing consumers.

A dedicated SQLite transaction in `storage-oauth.vault.mcp-owner.sqlite` admits
one MCP manager per shared credential store, across processes. Its lifetime lock
does not block built-in connectors writing through the shared vault. The OS
releases ownership on process exit; the application's main database is not held
locked.

Within that owner, each connection has a separate queue. Refresh rereads current
credentials inside the queue, performs the provider exchange, and saves the
rotated tokens before releasing it. Waiting requests reuse the replacement.
Unrelated connections and ordinary tool calls can run concurrently.

Disconnect first retires the connection generation and cancels its upstream
work. It then clears credentials through the same queue, before acknowledging
success. Late callbacks and refreshes cannot restore a disconnected connection.
Provider authorization-server identity is retained with a grant. Configuration
changes that change that identity invalidate the previous connection capability.
Changing enabled state or operation timeout preserves the grant.

Gateway bearers are process-local and rotate after server restart. Startup
configuration, live engine synchronization, and the folder plugin obtain current
bearers. An unreadable vault preserves its original contents and disables
remote engine entries until unlocked; it never falls back to engine-owned OAuth.

Firm Hub connection namespaces include platform, organization, and member.
Firm-provided headers/client secrets remain source-owned and memory-only; only
the member's OAuth grant and public configuration are persisted. Firm revocation
or sign-out retires the matching connection and clears its source configuration.

## Protocol and recovery

The gateway forwards tools, resource listing/reading, resource templates, prompts,
progress, cancellation, and catalog-change notifications. Both Streamable HTTP and
legacy SSE providers are supported. It does not advertise resource subscriptions,
sampling, roots, or elicitation support.

Only an explicit HTTP 401 can trigger refresh and one authenticated retry. An
ambiguous network failure or MCP tool failure is never automatically replayed.
Temporary refresh failures preserve credentials and apply a shared cooldown.
Rejected refresh credentials produce a shared reconnect-required status. Broken
provider transports are replaced on a subsequent request; existing recovery polls
consume the manager's status as well as the engine's transport status.

The existing sign-in dialog continues to bind the desktop callback before opening
the browser. Its completion request now carries the authorization state to the
server in `X-LegalWork-OAuth-State`. Server callbacks validate state, expiry,
connection generation, and PKCE. A pending sign-in survives engine rebuilds.

## Upgrade behavior

Remote connector settings migrate into the encrypted store. Existing custom
OAuth MCP connections require one fresh sign-in. The manager deliberately does
not copy rotating tokens from OpenCode's global `mcp-auth.json`: another older
OpenCode process could still own and refresh that grant. The new server grant is
independent. Existing global engine credentials are not modified.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm --filter legalwork-server build
pnpm --filter @legalwork/app typecheck
bun test --preload ./apps/server/test-preload.ts apps/server/src/mcp-manager.test.ts \
  apps/server/src/file-storage/oauth/session.test.ts apps/server/src/connectors/connectors.test.ts \
  apps/server/src/connectors/local-oauth.test.ts
OPENCODE_TEST_BINARY=/path/to/released/opencode bun test --preload ./apps/server/test-preload.ts apps/server/src/mcp-manager.engine.e2e.test.ts
```

The native-engine test runs two separate engine processes against one manager.
It verifies folder-specific runtime bindings after rebuilds, login across an
engine rebuild, agent tool execution, simultaneous token expiry, disconnect
during refresh, shared reconnect status, fresh login, and an empty engine MCP
credential store. Runtime gateway credentials are also rejected by management
and internal configuration endpoints. CI runs this test with the shipped engine.

Local validation used released OpenCode 1.18.29 on macOS arm64, SHA-256
`9c46fd8b183c575453ce1b57a4d6500e34f5d19825e8f2653356415355992188`.
Linux/macOS CI verification is configured; those remote runs have not been
executed during local development.

Validation passed: 124 focused server tests, 81 app tests, two desktop key-storage
tests, and the separate native-engine test. Five older engine-specific checks
were skipped in the focused server invocation; the new two-process manager test
was executed separately with the released binary. The server build, app
typecheck, packaged dependency check, built Node import, and a Node encrypted-vault
round trip also passed. Store ownership is checked with a separate child process.

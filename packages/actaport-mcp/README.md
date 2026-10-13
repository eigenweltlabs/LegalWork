# Actaport MCP

LegalWork's first-party Actaport MCP server speaks MCP over stdio and calls the official Actaport REST API directly. It includes 92 tools from the pinned OpenAPI 3.1 specification: 54 read operations and 38 writes. Authentication is internal, never an agent tool.

## Connect in LegalWork

Open **Extensions → Actaport**, enter the Kanzlei-Alias (realm), Client ID, Client Secret, API username and API password, then select **Save and connect**. Actaport must have enabled the API add-on. LegalWork verifies the API user through `/v1/info/me` before saving the credentials.

Credentials are encrypted with Electron safeStorage on the user's device. Linux's `basic_text` fallback is rejected. The desktop exposes a capability-protected loopback token service; MCP configuration contains its private discovery-file path and a write-mode flag, never API credentials. The MCP process receives short-lived access tokens. Disconnect removes saved credentials and revokes token access. One Actaport connection belongs to each desktop profile and is shared across its local workspaces.

Read-only is the default. **Allow changes in Actaport** adds the write tools and reconnects MCP. Revoking write access also blocks writes in an already-running process. MCP annotations describe each action; the client's normal approval rules govern individual calls. Enabling writes permits creation, updates and deletion, including deadlines, fees and TUS uploads.

The bundled desktop connection targets the local worker. Remote/headless workers can run the standalone server with their own private credentials; desktop keychain credentials are not transferred to a remote worker.

## Standalone / headless

Build with `pnpm --filter @legalwork/actaport-mcp build`. Use Node 22 or newer to run `packages/actaport-mcp/dist/index.mjs`. The bundle includes its dependencies and specification; it needs no runtime package download.

Set `ACTAPORT_CREDENTIALS_FILE` to a private JSON file outside the workspace:

```json
{
  "realm": "your-firm-alias",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "username": "your-api-user",
  "password": "your-api-password"
}
```

On Unix, the file must be private (`chmod 600`). On Windows, restrict its ACL to the worker owner. The MCP server rejects credential files larger than 16 KB. Optional environment variables:

| Variable | Behavior |
| --- | --- |
| `ACTAPORT_ALLOW_WRITES=1` | Enable mutating tools; default is read-only. |
| `ACTAPORT_FILE_ROOT` | Allowed file root for document uploads/downloads; default is the process working directory. |
| `ACTAPORT_CONNECTION_FILE` | LegalWork desktop's private token-service descriptor, supplied automatically by the app. Takes precedence over a credentials file. |

Tokens normally expire after five minutes. The server uses the documented `password` grant, caches tokens, coalesces concurrent authentication and reauthenticates before expiry. There is no refresh-token flow. Rejected authentication is retried once; failed/uncertain writes and rate-limited requests are not automatically repeated. Rate-limit errors include `Retry-After` when supplied.

## Tools and files

Tool names are `actaport_` plus the specification's operation ID in snake case, for example `actaport_get_akten`, `actaport_get_akte`, `actaport_get_fristen`, `actaport_get_kollisionspruefung`, and `actaport_upload_document`. Parameters retain the API's names and types. `bezugsJahr` uses Actaport's reference year, such as `26` for `42/26`. JSON request bodies are passed as `body`; filter/sort arrays become repeated query parameters. Only declared parameters and bodies are accepted. Schema defaults are descriptive; the adapter does not silently apply them.

- **Multipart uploads:** `body.file` is an existing file path within the file root, `body.ordner` is optional. The filename is preserved. Direct uploads are limited to 60 MB.
- **Downloads:** `actaport_download_document` requires `id` and `saveTo`, a new file path inside the file root whose parent directory already exists. It never overwrites files. Downloaded files can be opened in LegalWork's document viewer.
- **Large downloads:** Actaport returns `201` with a download-status resource instead of file bytes. Call `actaport_get_document_download_status` to inspect its state and obtain the documented temporary external-storage link. This server returns that link; it does not fetch external storage or forward bearer tokens to it.
- **TUS:** tools cover OPTIONS, POST, GET, HEAD, PATCH, DELETE, assembly status and linking. PATCH takes a base64 `body` (at most 10 MB per chunk). Protocol headers retain their API names, such as `Tus-Resumable` and `Upload-Offset`. Returned protocol headers include upload offsets and location. Use the declared tool schema for required headers.
- **Responses:** JSON is returned as structured data and text; HEAD and empty responses return status and relevant headers. JSON/text responses are capped at 10 MB and direct file downloads at 60 MB. Provider error bodies are not returned to the agent. HTTP redirects are rejected.

The API user determines accessible records. The adapter exposes fixed specification endpoints; tools cannot provide an arbitrary URL or authorization header.

## Specification and maintenance

`openapi.json` (SHA-256: `2d485ea84af6cbe526fa3b98f3cd097db63566a6c5ce4be0e2baa367e59e59aa`) was retrieved on 2026-10-13 from [Actaport's official OpenAPI document](https://api.actaport.de/api-docs/public-api.json). Its source documentation is [the API reference](https://api.actaport.de/api-docs/rest-api/reference/public) and [authentication guide](https://api.actaport.de/api-docs/rest-api/introduction/authentication).

Tools are built from the snapshot, never from a network fetch at startup. Updating the snapshot requires reviewing and retesting changes. The adapter handles these quirks of the published document:

- Some JAX-RS path templates have regexes and missing parameter declarations. Their required path IDs are recovered from the template, with numeric/UUID validation where specified.
- Polymorphic request schemas inherit a base containing a union back to its subtypes. The adapter inherits base fields without that recursive union and applies the declared discriminator mappings as subtype tags.
- Path-level parameters are inherited by their operations.

Some write operations, such as `createKostenstelle`, declare no body. This implementation follows the published schema and does not invent undocumented fields. Live testing may reveal vendor specification omissions requiring confirmation from Actaport.

## Verification

```sh
pnpm --filter @legalwork/actaport-mcp typecheck
pnpm --filter @legalwork/actaport-mcp test
node apps/desktop/scripts/prepare-actaport-mcp.mjs
node --test apps/desktop/electron/actaport.test.mjs
pnpm --filter @legalwork/app typecheck
pnpm --filter @legalwork/desktop typecheck:electron
pnpm --filter @legalwork/app test:i18n
```

The tests use fixtures and include an actual Node subprocess MCP handshake. They do not access a live Actaport account. For live acceptance, connect an API-enabled test account, find a matter, download/open a document, repeat after token expiry, and test approved writes in a disposable matter. The desktop build scripts compile and include both MCP and authentication bundles on all desktop platforms. At startup, they are copied into the desktop profile at stable paths so AppImage mounts and Windows updates do not invalidate saved MCP commands. The worker's Node search path includes LegalWork's bundled runtime, so a separate Node installation is not required.

### Validation in this worktree

- MCP contract/client tests and the bundled Node stdio smoke test passed (14 tests).
- Desktop credential, private-discovery and runtime-update tests passed (5 tests).
- The desktop regression suite passed; the relevant MCP/app regression tests also passed.
- MCP, app and Electron typechecks, the IPC bridge check, translations and the production app build passed.
- The connection UI was exercised with simulated credentials, including save, test, write access and disconnect.
- No live Actaport account or signed installer was tested.

The MCP package installs with a filtered frozen-lockfile pnpm install. A full fresh workspace install currently encounters the repository's existing missing integrity checksum for the SheetJS CDN tarball; the application checks above used the already-installed dependency cache.

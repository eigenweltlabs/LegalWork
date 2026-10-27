# Browser passwords: first version

LegalWork stores website passwords in its existing encrypted vault and fills them in the agent's existing native v2 browser tab. There is no private login session, new browser partition or cookie transfer. Users can continue using the same tab. Turn completion retains undismissed background tabs and their project/chat ownership; an explicit user dismissal still closes them when active work ends.

This is a fill-by-reference feature, not a confidentiality boundary against the agent. Unrestricted host commands retain their existing access to the vault and key. Browser evaluation and page scripts can still read a filled field. Network diagnostics and host execution permissions are unchanged. The narrower guarantee is that the password does not enter the fill tool's model-facing arguments or results.

## Storage and settings

`BrowserPasswordStore` uses a namespaced entry in `OAuthVault`, alongside OAuth/connector credentials. The existing vault format, AES-GCM encryption, key source, permissions and module write lock remain unchanged. An outer namespace lock serializes read-modify-write operations without replacing other vault consumers' entries. No browser password becomes an environment variable.

The record contains an opaque UUID, label, exact origin, optional username, password and update timestamp. Management routes require the existing host token:

| Method | Path | Result |
| --- | --- | --- |
| GET | `/browser-passwords` | Metadata only |
| PUT | `/browser-passwords` | Create/update; metadata only |
| DELETE | `/browser-passwords/:id` | Remove saved entry |

There is no API operation to return a password. Settings submits a value only when creating/replacing it. An empty password on edit retains the existing value; changing to a different website requires re-entering it. The user may save HTTPS origins; localhost HTTP supports development fixtures. URL paths are discarded. Matching uses the registrable domain from `tldts` with private public-suffix rules: the main domain and its subdomains share entries, while independently owned tenants such as `a.github.io` and `b.github.io` remain separate. Schemes and ports must match; IP addresses and hosts without a registrable domain match exactly. Existing saved records use this matching immediately without a vault migration. This first version is local desktop only.

## Agent and desktop flow

```mermaid
sequenceDiagram
    participant Agent
    participant Tools as LegalWork tools
    participant Desktop
    participant Vault as Existing vault
    participant Tab as Existing native tab
    Agent->>Tools: connect(tab_id)
    Tools->>Desktop: existing project/chat attachment
    Desktop-->>Agent: tab capability URL and native observation with usable refs
    Agent->>Desktop: passwords(capability, calling chat)
    Desktop->>Vault: list metadata for current origin
    Desktop-->>Agent: IDs, labels, usernames
    Agent->>Desktop: fill-password(capability, password_id, ref)
    Desktop->>Vault: resolve password locally
    Desktop->>Tab: inspect native target and validate origin/type
    Desktop->>Tab: native fill with generation and target checks
    Desktop-->>Agent: filled confirmation only
```

`legalwork_browser_passwords` and `legalwork_browser_fill_password` use the existing tab capability broker. Both pass through the existing effective browser network policy. The broker requires the exact owning chat's session header and a live grant. A remote attachment does not receive password actions, and the tools refuse to forward these operations through the manual-server extension gateway.

The desktop resolves the vault value only after admission. It checks the current top-level website and every native target resource website using the same store matcher, then verifies that the referenced element is an enabled password input. Native generation and target checks reject a document/frame change between inspection and execution. A second current-origin check precedes dispatch. The existing native fill implementation performs the insertion without sending the value through the OpenCode Tool RPC. It does not submit the form, take a screenshot, or return a page observation. Native errors are replaced with a fixed message so a page exception cannot echo the password into the result. Website mismatches get a distinct fixed diagnostic, preserved by the agent tool instead of a generic HTTP 400. Listing returns the website actually checked after redirects alongside matching metadata. Cancellation is propagated and uncertain actions are never replayed automatically.

These checks prevent accidental filling into an unrelated site, frame or stale target. They do not protect against a malicious script on an authorized website or an agent intentionally retrieving the value through unrestricted tools. A stronger isolation design would require a separately agreed scope.

## Validation

Store/route tests cover encryption, metadata-only results, concurrent edits, coexistence with other vault consumers, exact origins, replacement/deletion, host-token route declarations and write gates. Broker/tool tests cover exact chat identity, local-only admission and ID/ref-only requests. Desktop tests cover origin/frame/type rejection, cancellation and error sanitization.

`pnpm --filter @legalwork/desktop test:browser-passwords` uses synthetic credentials and an isolated vault/profile in a hidden Electron window. It exercises the real native controller and capability broker, checks the actual field value, confirms normal snapshots do not echo it, verifies explicit browser readback remains available, and rejects a stale ref after navigation. It makes no model calls and proves the insertion path, not real-model login quality. Build the server first with `pnpm --filter legalwork-server build`; standalone TypeScript emission does not produce all required runtime bundles.

`LEGALWORK_TEST_OPENCODE_BIN=/absolute/path/to/opencode pnpm --filter @legalwork/desktop test:browser-opening` starts a separate released v2 engine and actual panel IPC in hidden Electron. It proves opening refs work directly through native tools, reconnecting refreshes refs, another chat cannot connect, and username/vault-password/submission compose without an intermediate snapshot. This fixture uses native evaluation on the observed submit button because fully hidden macOS mouse capture requires a compositor surface. It uses synthetic credentials and zero inference calls.

The [native workflow acceptance record](pr-evidence/browser-passwords/native-workflow-verification.json) contains three actual agent runs through the development app, normal dispatch, saved test credentials and local synthetic websites: a single-page login, a two-step login and a company search. All produced the server-verified result with no argument-schema errors. The single-page password fill completed in three tool rounds and 13.9 seconds, using opening refs without another snapshot. Complete login still required 15 rounds and 132–133 seconds because background native click errors and keyboard replacement during recovery caused additional work; the search took six rounds and 26 seconds. This is not a matched before/after DeepL benchmark or proof of a three/four-round complete login. The record includes native input/output/cache/reasoning token counts. Actual gateway billing was unavailable; zero engine-reported cost is not treated as free inference. The temporary saved entry was deleted, real credentials were not used, and the controller did not switch the foreground chat or desktop focus.

## Reproducing the redirect regression

After compiling the server, run `pnpm --filter @legalwork/desktop test:browser-passwords:website https://www.deepl.com/login auth.deepl.com`. This optional live-site smoke uses only a synthetic password in an isolated temporary encrypted vault/profile. It waits for the real login redirect, checks the reported website and matching saved entry, fills a fresh native ref, verifies masking/no submission, and leaves every window hidden. It makes zero model calls and never uses a saved real account. The deterministic `test:browser-passwords` fixture remains the offline regression.

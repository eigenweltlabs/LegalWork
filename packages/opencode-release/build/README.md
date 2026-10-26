# Temporary source-build candidate

The current source recipe is **`2.1.4-legalwork.http-policy.3`**. It combines
our existing MCP readiness correction with the user-approved Code Mode HTTP
permission boundary and preserves Bun's lazily inferred form headers. The [combined source receipt](../../../docs/patches/opencode-2.1.4-mcp-http-policy-v3.receipt.json)
pins all nine changed files, the original frozen dependency graph, compiler,
commands and results: 6,766 Core passes, 43 inherited skips and seven failures
reproduced against original source; 1,416 Code Mode library passes; 90 randomized
HTTP executions. Parent review independently verified 53 input/evidence hashes
and the byte-identical earlier MCP subset. All twelve target artifacts and
deterministic private archives are built and independently checked. Offline
installation passes for Mac ARM64, Linux baseline and Windows baseline. Mac
actual production HTTP acceptance passes 112 assertions, with native/MCP/prefix
checks also green. Actual Linux x64 and Windows x64 engine/Electron execution now pass, including
normal packaged startup, native plugin/tool calls and retained history. The
latest common final7 normal build/package/security passes on all three tested
platforms. Its Windows unsigned installer and actual installed upgrade/history
checks also pass. Remaining real-agent regression acceptance is still running;
see [current capability status](../../../docs/opencode-v2-capability-status.md).

`selection.json` still selects official **2.1.4**. Normal desktop/server/CLI
code can consume a build-owned derivative selection containing an independent
manifest pin; each process reconstructs trust and verifies actual installed
files before startup. The SDK/client/plugin ABI stays at base 2.1.4. This wiring
has unit, compiled-selection fixture and TypeScript checks; actual native/runtime checks have now executed on Mac ARM64, Linux x64 and
Windows x64. Functional regression completion and distribution adoption are
still separate gates. Test-only preloads
are not part of production selection.

Archive retrieval supports verified local files, an offline cache, and streamed
HTTPS retrieval when a reviewed build supplies an actual published download
base. No download base is currently selected or fabricated. Invalid downloads
and corrupt existing caches fail without publishing or replacing executables.
The complete private twelve-target distribution is prepared; public availability
and final release metadata remain separate release gates.

Final Mac engine signing must happen **before** binary/provenance/archive pins
and the host build. The app signer preserves the pinned engine bytes and
rejects an ad-hoc engine under a production signing identity. Windows installer
signing remains subject to the existing policy: bundled engine bytes are not
silently re-signed. No artifacts have been published and no release is authorized
by this preparation.

## Opt-in production Mac engine signing

`buildCandidate({macSigning})` and the candidate CLI's
`--mac-signing-config /path/to/public-certificate-policy.json` now provide a
build-only signing path. Omitting the option preserves the existing two ad-hoc
sign/verify commands. The production policy is public metadata only:

```json
{
  "mode": "developer-id",
  "identitySha1": "<exact 40-hex leaf certificate fingerprint>",
  "certificateSha256": "<independently approved 64-hex leaf certificate fingerprint>",
  "teamId": "<expected 10-character Apple Team ID>",
  "keychainPath": "/path/to/existing-CI-only.keychain-db"
}
```

The optional keychain path refers to an already imported identity. Existing CI
Apple certificate infrastructure owns its import, unlock and disposal. This
helper never imports, reads or exports a private key, accepts a certificate name
substring, or changes an application runtime setting. Root-owned CI wiring must
pass this policy explicitly; no workflow, selector or URL is changed here.

Signing happens after the untouched upstream compilation and before version
probing, provenance, checksums or distribution archives. The helper requests
hardened runtime and a secure timestamp. Native `codesign` must verify all
architectures, an Apple generic anchor, Developer ID Application certificate
extensions and the expected certificate OU/team. Extracted public leaf
certificate bytes must match both SHA1 and SHA256 pins; displayed authority,
team, hardened-runtime flag and timestamp must also match. The complete signed
entitlements must equal the reviewed five-key profile. Any failure retains
evidence and aborts without final provenance or accepted signature metadata.
Signing helper/profile bytes, native outputs, public certificates and
before/after executable hashes are retained under `build-evidence`; their
identities enter provenance. A later version probe or packaging step cannot
replace signed bytes without failing their existing pins.

The 571-byte `macos-entitlements.plist` is byte-identical to
[the pinned upstream OpenCode profile](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/cli/script/entitlements.plist),
SHA256 `55031b092985f55d4aa22ce1ee3aec1650cf160d46c15b7334476e9f2961074a`.
It also matches [Bun's documented standalone signing profile](https://bun.sh/docs/bundler/executables#code-signing-on-macos):
JIT, unsigned executable memory, disabled executable-page protection, DYLD
environment variables and disabled library validation. These are permissive
exceptions. They are preserved explicitly for Bun and third-party native plugin
compatibility; this preparation does not invent a narrower, untested profile.
[Apple documents runtime exceptions](https://developer.apple.com/documentation/security/hardened-runtime)
and [the distinction between signature validity, requirements and Gatekeeper](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).
Only the engine executable receives this profile, not Electron or unrelated
helpers. Actual Developer ID engine startup/JIT/native-plugin/tool acceptance,
the existing enclosing-app signing/notarization gate and independent review of
the new final distribution pin remain required. Unit command-contract tests do
not establish Apple trust or production signed-engine functionality.

Focused validation:
`node --test packages/opencode-release/build/mac-signing.test.mjs packages/opencode-release/build/candidate.test.mjs packages/opencode-release/candidate.test.mjs`.
It includes actual native ad-hoc signing/execution and Apple requirement parsing
on Mac, plus fail-closed public identity/team/timestamp/runtime/entitlement and
post-sign tamper controls using a synthetic native-command boundary. No private
signing key is accessed by these tests.

The original ad-hoc `f754…` producer, all prior candidate archives and selections
remain immutable. Production signing creates a new distribution identity/hash;
it must never re-sign files after their manifest has been approved.

### Candidate versus adoption metadata proposal (not implemented)

Keep artifact facts separate from host adoption. A distribution manifest should
describe a `reviewed-build` and its source, signing evidence and immutable bytes;
`selection.json` should be the explicit host adoption decision, independently
pinning that manifest and a real download location. Publishing engine assets
and releasing a LegalWork app remain separate approvals. Historical
`local-candidate-not-adopted` manifests must retain their original bytes/digests.
Changing the new manifest vocabulary requires the distribution producer and
validator to change together; neither that change nor default adoption is made
by this signing preparation.

The complete previous `.1` release package, recipe and distribution metadata
were preserved before updating the recipe. Its artifacts and receipts remain
historical evidence; current `.3` validators deliberately do not authorize `.1`.
The `.2` recipe/source/build evidence and its failed form-header cases are also
retained separately and are not relabeled as `.3` acceptance.
The detailed `.1` results below describe that earlier candidate only.

## Historical MCP-only candidate: `.1`

This directory prepares a separately identified LegalWork patch candidate. It
does not change `../release.json`, the official npm archive pins, production
downloads, tracked sidecars or application auto-update behavior. No candidate
may be adopted merely because its base is OpenCode 2.1.4.

The source gate now has a hash-pinned official frozen-install test receipt. The
initial pnpm conversion exposed different version identities and was discarded.
The user approved a narrow exception for one isolated upstream Bun 1.4.4 frozen
install; LegalWork's package manager remains pnpm. Original `bun.lock` and root
manifest bytes are pinned. The receipt records 151 focused passes, 70 randomized
readiness executions, 6,757 full-Core passes, 43 inherited skips and seven
Mac/Bash failures reproduced on the unmodified source. The canonical root check
passed all 34 tasks. Compilation refuses to run if that receipt fails to match
the exact lock, patch and runtime. The wrapper copies the tested
installation into a separate checkout without another install or shared writable
inodes. Absolute workspace links are localized; escaping links are rejected.

## Pinned boundary

- Source: upstream tag `v2.1.4`, commit
  `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`.
- Patch: the reviewed source/test diff in
  `docs/patches/opencode-2.1.4-mcp-tool-readiness.patch`, verified by SHA256.
- Candidate identity: `2.1.4-legalwork.mcp-ready.1`, channel `legalwork`. Both the
  CLI and native server must report it; version/protocol checks must accept the
  reviewed identity rather than disguising it as the official release.
- Toolchain: upstream Bun 1.4.4. The macOS ARM64 compiler's official npm archive
  SRI and extracted executable SHA256 are pinned. Other native builder hosts
  need equivalent reviewed compiler pins before use.
- All twelve official target names are retained, including x64 baseline and
  Linux musl variants. The wrapper builds one explicitly selected target.

The source build runs the pinned upstream CLI build script, including native
plugin runtime modules, PTY/watcher assets, artifact/architecture checks and the
complete native web UI. It disables that script's implicit dependency install.
It does not substitute a reduced headless build. Host build secrets and native
engine credentials are not added to provenance.

The output directory is new and private to the build; an existing directory is
never recursively replaced. Its `artifact` directory contains the binary,
original MIT `LICENSE`, a notice identifying the derivative, `provenance.json`
and SHA256 sums. Provenance records the source/patch/dependency/compiler hashes,
wrapper hash, official base archive identity, full target matrix, patched
version, source epoch and before/after-signing binary hashes. macOS ad-hoc
signing enables local execution; it does not replace application signing or
notarization. Existing third-party notices still apply.

Each build also archives the exact executing wrapper and recipe bytes under
`build-evidence`. The wrapper captures those bytes before starting, so a later
source edit cannot silently change the script hash recorded by a running build.
Additional targets may reuse that private staging tree serially by supplying
`--reuse-artifact` and `--reuse-provenance-sha256` from a previously reviewed
candidate. Reuse verifies the previous artifact, rejects a redirected staging
symlink, and compares the original commit, applied patch and lock bytes against
a fresh checkout. An exclusive staging lock prevents concurrent native asset
writes. No further dependency install or copy occurs. New provenance explicitly
records the reused candidate receipt; the original artifact stays unchanged.

## Validation and distribution gates

`node --test packages/opencode-release/candidate.test.mjs packages/opencode-release/build/candidate.test.mjs` checks distinct
identity, complete targets, exact input hashes, compiler tamper rejection,
matching source-test evidence, preservation of official provenance pins, exact
canonical startup paths, frozen host capabilities, receipt/binary tamper rejection
and explicit process-local validation registration.
Those checks do not establish that a patched native binary works.

Before adoption, the actual macOS candidate must pass the same released-engine
MCP lifecycle/first-turn tool and CodeMode fixtures, public protocol/client
contracts, native process/service identity, history preparation and packaged
application startup. It must retain the one-server/client architecture and
LegalWork's disabled native auto-updater. Parent review controls adoption; this
tool never publishes a package, PR, release or replacement sidecar.

Build from the receipt-matching prepared checkout into a new private directory:

```sh
node packages/opencode-release/build/candidate.mjs \
  --prepared-source /path/to/tested-official-checkout \
  --bun /path/to/verified/bun \
  --target darwin-arm64 \
  --output /path/to/new-private-candidate
```

The wrapper returns both binary and provenance SHA256 values. A host can call
`verifyOpencodeCandidate({directory, provenanceSha256})` using the independently
reviewed provenance digest, then pass the returned frozen capability through
`startEmbeddedServer({opencodeCandidateBuild, opencodeBin})` or the desktop
runtime constructor. Startup rechecks the canonical binary path and bytes
immediately before spawn, and requires the actual child's PID and exact distinct
version. `baseVersion` remains 2.1.4 for the existing client/plugin protocol and
host-module declaration; a separate candidate SDK is not invented.

Existing source fixtures may explicitly preload `validation-preload.mjs` with
`LEGALWORK_TEST_CANDIDATE_DIRECTORY` and the independently reviewed
`LEGALWORK_TEST_CANDIDATE_PROVENANCE_SHA256`. Ordinary application startup never
imports that preload or reads those variables. A compiled standalone CLI cannot
inherit a capability from its parent process and remains exact by default.
HTTP, IPC and configuration input cannot create a candidate capability.

The separately identified `legalwork` channel follows upstream's supported
`service-legalwork.json` password/config and registration filenames. Official
startup retains `service.json`. Host lifecycle code verifies registrations from
both known channels before replacing a private predecessor, maintaining one
engine and database owner with exact authenticated PID/version checks.

Current private builds: macOS ARM64 has CLI, authenticated plain/service startup,
native inbox/turn restart recovery and same-origin native HTML/JS serving proof.
The actual Electron runtime manager also passed the frozen-capability boundary
through the normal compiled embedded server, native project approval and plugin
activation, repeated Start PID reuse, explicit Restart PID replacement, preserved
binary/access settings and complete owned-child reaping. This is a local Electron
acceptance run, not a signed/notarized application distribution.
All twelve declared targets now have successful source builds and upstream
static architecture checks. Their actual execution remains a platform gate;
only macOS ARM64 has native acceptance in this lane. Several normal/baseline x64
variants produced identical bytes under the unchanged upstream Bun 1.4.4 target
mapping. Their target identities and provenance remain distinct; this does not
establish minimum CPU compatibility. None changes official download pins or
adopts patched bytes for production.

## Local derivative archive preparation

`distribution.mjs` accepts a complete, explicitly reviewed list of twelve build
directories and their provenance digests. It verifies each candidate and writes
deterministic streaming USTAR/gzip archives containing only its binary, original
MIT license, derivative notice, provenance and checksum list. Source epoch,
ordering, modes and owner IDs are stable; user files and build dependencies are
excluded. It writes a separate `derivative-release.json` identifying actual
version, base ABI, channel, source/test evidence and every archive/file hash.
Archive locations are local filenames, with no fabricated download URL.

```sh
node packages/opencode-release/build/distribution.mjs \
  --builds /path/to/reviewed-build-receipts.json \
  --output /path/to/new-local-archive-directory \
  --manifest /path/to/new-derivative-release.json
```

The explicit host-only `@legalwork/opencode-release/derivative` entrypoint loads
that manifest only with its independently reviewed SHA256. Its opaque frozen
capability authorizes `installLocalDerivativeEngine` from a reviewed local
archive directory or reverified cache into a separate destination directory.
It has no network fallback, production environment override or default selector.
It verifies archive bytes before extraction, permits only the five expected
members, rejects links and changed files, preserves mismatching existing
destinations/caches, and atomically installs the complete artifact. The result
includes the existing verified candidate capability for local packaged tests.
Actual version/base ABI/service-channel checks remain exact.

The twelve real archives have also passed local extraction and a second
cache-only installation. This establishes archive/cache integrity, not native
execution on twelve platforms. The independent distribution-manifest digest is
required even when all input files are local.

`scripts/benchmarks/packaged-candidate.mjs` is a separate, explicit test entry
helper. A private package imports it before unchanged `electron/main.mjs`. It
verifies the reviewed manifest digest and all five files beside the bundled
engine, rejects higher-priority engine aliases, then registers the capability
through the package's own physical `@legalwork/opencode-release/candidate`
module. It accepts no environment version switch. Its source and the temporary
entry wrapper must be hashed into the package receipt. This test hook is absent
from normal production startup and is not the final production selector.

The actual macOS ARM64 ASAR package passed this path with normal renderer IPC:
Start reused its healthy PID, Restart replaced it, exact native identity and
Bearer authorization held, and Stop reaped both children. A separately altered
bundled engine was rejected before normal main loaded. The disposable package
needed ad-hoc signing of the fuse-modified Electron Framework executable and
enclosing app; the candidate engine was never resigned and retained its reviewed
hash. No developer certificate, notarization or publication was used. This
current-host test does not establish older macOS or other-platform execution.

These preparation exports and the local-candidate manifest do not select a
production engine. A parent-reviewed adoption and distribution step is still
required, including final signing hashes and native platform execution.

Linux glibc/musl, Windows, and other macOS architecture execution remain native
execution gates. Cross-compilation and a static architecture check alone cannot
prove their runtime, native modules, browser integration or signing behavior.
Built candidate artifacts are self-contained for offline packaging. Rebuilding
offline additionally requires the complete pinned source, dependency and
cross-compiler caches. Pinned-input replay is recorded; byte-for-byte rebuild
identity is not claimed without a separate comparison.

## Proposed production handoff (not adopted)

1. Execute the supported target artifacts. The official twelve-target matrix is
   built and stays intact. Only macOS ARM64 has executed in this work lane.
   Native Linux VM validation is handed to the benchmark lane; the remaining
   targets need their platform validation gates.
2. Preserve `release.json` as the immutable official 2.1.4 source. Add a separate
   selected-engine manifest for the LegalWork derivative with exact actual
   version, base client/plugin version, channel, source/patch/test receipt and
   per-target archive, binary and provenance hashes. Keep its origin explicit.
   Preparing those manifests locally does not authorize publishing artifacts.
3. Have desktop sidecar preparation and standalone managed-engine download use
   that selected manifest with verified cache/offline behavior. Replace the
   official default only after parent adoption. The production host should pin
   the selected identity directly, rather than depend on a validation preload.
4. Carry the same selected-engine metadata into compiled server/orchestrator
   binaries. Their default managed launch currently pins official 2.1.4; a
   parent-process capability cannot authorize a separate compiled CLI. Retain
   exact actual PID/version checks and supported channel-specific service paths.
   Keep the SDK, client, native plugin modules and browser protocol at base 2.1.4.
5. Update sidecar `versions.json`, packaging assertions and license attribution
   to identify patched bytes accurately. Final Mac code signing can change binary
   bytes: complete it before generating the immutable engine pins and compiling
   the host. Windows installer signing must preserve the bundled engine bytes
   under the existing code-signing policy. Preserve both
   pre-sign source-build hashes and final signed hashes, then validate the
   actual packaged executable. Current ad-hoc signing is not this release gate.

LegalWork's application updater policy and the disabled native engine updater
stay unchanged. Returning to an official release requires the same regression
gates after an equivalent upstream correction is available.

Primary build sources: [upstream CLI build](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/cli/script/build.ts),
[full web UI archive](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/cli/script/app-assets.ts),
[version/channel selection](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/script/src/index.ts).

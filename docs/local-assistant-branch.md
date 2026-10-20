# Local Assistant branch

`codex/johannes-assistant` is the desktop Assistant integration branch. On
2026-10-20 it was updated from `ffceada9` by merging `dev` at `14975365`,
preserving the existing branch history. Local improvements were selected from
`codex/legalwork-cloud-sync` at `aee752e8`.

## Included

- Existing local Assistant onboarding, daily conversations and history, reactions,
  project delegation, file handoffs, scheduled tasks, recorder controls and desktop
  notifications.
- Assistant appearance and notification preferences in normal Settings, with
  Account, AI Providers and Assistant first, and the neutral circle settings icon.
- Assistant identity and approval controls outside the movable document pane.
- Project-field defaults passed when creating the Assistant workspace.
- Bundled runtime schemas and owner-only runtime configuration files.
- Current `dev` connector, browser, document, billing and workspace behavior.
  Browser network policy is checked before Assistant UI navigation permission;
  both restrictions remain enforced.

## Kept on the cloud branch

Cloud Assistant activation, account provisioning, VM and image lifecycle,
execution leases, personal cloud replication, mobile/WhatsApp/email channel
execution and transcript forwarding, cloud BrowserUse and the cloud connector
registry remain on `codex/legalwork-cloud-sync`. The local server has regression
coverage asserting that cloud activation and channel-history routes return 404.

Normal project/team sharing and local connectors from `dev` remain available.
The optional Apple Push transport already present in the original local branch
is retained; no VM or mobile channel runtime is added by this split.

## Validation and manual review

Run from the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir apps/app typecheck
pnpm --dir apps/server typecheck
pnpm --dir apps/app test:i18n
pnpm --dir apps/app build
pnpm --dir apps/server build
pnpm --dir apps/app test
pnpm --dir apps/server test
```

Branch preparation uses CLI tests/builds. A rendered Electron walkthrough is still
required before release:

1. Open the Assistant, complete naming/appearance onboarding and send a local message.
2. Confirm reactions, history, project delegation and returned file cards.
3. Open Settings: AI Providers is second and Assistant third. Save appearance and
   notification preferences; verify there is no Cloud Assistant activation control.
4. Open a document beside the chat; verify the Assistant header and approvals remain
   usable. Check scheduled tasks still execute locally.
5. Exercise a connected Google/Microsoft account through the local tools using the
   normal connector setup from `dev`.

The full app suite has three Lexical initialization errors in
`markdown-block-editor`, `wiki-editor-outline` and `wiki-title-editor`; the same
three files fail on an untouched `dev` checkout with the same dependencies.
The server streaming-error test in `serve-node.test.ts` also fails on untouched
`dev`. The wiki graph polling test failed once during the first combined run and
passed on its isolated retry. These are recorded separately from the passing
Assistant tests and build checks; this branch split is not a release sign-off.

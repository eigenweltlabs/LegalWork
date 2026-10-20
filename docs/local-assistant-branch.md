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
- Scheduled Assistant work in fresh child sessions, with only a bounded final
  result returned to the daily conversation. Multi-step interactive research is
  routed to the native general subagent by the coordinator instructions.
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
`dev`. The wiki graph polling test fails in combined runs and passes in isolation;
its implementation and test are unchanged from `dev`.

Final results: app 1,653 passed / 3 initialization errors; server 2,437 passed /
71 skipped / 2 failed as described above. Both production builds, both typechecks,
i18n completeness, 8 desktop notification/recorder tests, and the focused Assistant
and browser-policy checks pass. The built server CLI also starts under Node.
These are recorded separately; this branch split is not a release sign-off.

## Keeping the coordinator context small

Assistant schedules, including the morning briefing, run in a fresh worker each
time. The worker is linked to the daily chat through its parent ID, without
copying that chat's messages. Work can start while the main chat is busy; an
unfinished worker prevents overlapping repeats of the same schedule. Scheduled
permissions, wiki authority and an explicitly selected model remain enforced.

The existing durable delegation queue returns only the worker's final response,
capped at 2,400 characters, plus routing references. It waits until the daily
chat is idle, survives restarts and avoids replaying results. Detailed records
and saved reports remain accessible from the worker and project files.

Validation includes 52 focused scheduling/Assistant tests, 5 existing HTTP/result
and queue tests, a live scheduler test with a busy main chat, and a fixture-model
test against the actual pinned engine. The latter verifies empty child history
and native general-subagent execution without forwarding parent context or raw
child tool results into the coordinator. No live model/account is used by these
tests. The subsequent full server run has 2,455 passes, 50 skips and the same two
unrelated failures recorded above.

Existing daily history is retained. This prevents future briefing-history
buildup; it does not retroactively compact today's old transcript or reduce the
separate baseline of system instructions and advertised tool schemas.

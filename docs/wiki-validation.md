# Wiki implementation validation

Implemented on `codex/markdown-wiki`, starting from `dev` at `19c40010`.

## Rebase verification (2026-10-07)

Rebased onto current `origin/dev` at `d4fd2ffd`. A second fetch confirmed this remained the current dev head. The pre-rebase branch is retained as `codex/markdown-wiki-before-rebase-8babd32b`.

- Audited every changed existing file against dev: no upstream files, dependencies, exports, runtime plugins, or build inputs were removed. The lockfile matches dev exactly. All 111 server routes, 10 workspace routes, and existing route registrations remain.
- Home, calendars, schedules, recorder, MainActionRail, detached windows, theme, project-sync modules, and native reasoning settings retain their upstream implementations. Wiki navigation uses dev's configurable rail and preserves saved visibility/order.
- `pnpm --filter @legalwork/app test`: 925 passed, 0 failed. App typecheck and i18n checks passed (5693 keys in each language).
- Server typecheck and both production builds passed; runtime/plugin/auth regression tests passed (31 tests).
- `pnpm --filter legalwork-server test`: 1604 passed, 16 skipped, 4 failed. An isolated pristine snapshot of dev reproduced the same four failures with identical warning counts: the child processes exit successfully, but warnings from the existing personal `_gstack-command` skill violate the tests' empty-stderr assertions. No personal skills or home-directory environment variables were changed.
- Added HTTP regressions verify private wiki schedule/inbox filtering with ordinary-project controls, individual schedule access, independent sharing versus project sync, programmatic folder overlap protection, and scheduled session grant downgrade. The combined wiki HTTP, project-sync, and scheduling regressions passed 36 tests (227 assertions).
- Electron restarted with the existing wiki development profile; the dev URL on port 5176 returned HTTP 200.

## Verified behavior

- Personal folders, independently shared firm wikis with their own members, discovery/joining, editable Markdown structure, instructions, templates, skills, and views.
- Full-text search, frontmatter properties, page links/backlinks, bounded graph, tables, and Kanban changes saved to Markdown.
- Lossless source editing, automatic saves, draft retention, conflict protection, attachment previews/downloads, local history, deleted-page recovery.
- Global and selected-project wiki access; authenticated wiki-root sessions; API-backed agent read/search/write/delete tools.
- Desktop host authentication, remote credential separation, session-origin grants and collaborator downgrade; wiki/project folder overlap rejection.
- Two-folder automatic sync through the wiki registry and signed chunk transfers with per-file SHA revision checks; independent edits merge, overlapping edits preserve conflict copies, interrupted/offline transfers retain changes, revoked access prevents publication, downloads cannot overwrite newer local saves.
- Sharing retries retain a pending identity and audience, remote deletion retries remain idempotent, and sharing again uses a fresh identity. Legacy connector registrations keep local content and require explicit migration.
- Two actual desktop API hosts without projects create, discover, join and edit a shared wiki; owner-only audience changes, revocation and sign-out prevent further publication/access.
- Preview sanitation: no scripts, embedded frames, event handlers, unsafe links, or automatic remote-image requests in the tested Markdown.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm --filter legalwork-server exec bun test src/` | 953 passed, 11 skipped, 0 failed (964 total); final sharing-route retry change additionally passed the 21-test sharing suite |
| `pnpm --filter @legalwork/app test` | 650 passed, 0 failed |
| `pnpm --filter legalwork-server typecheck` | Passed |
| `pnpm --filter @legalwork/app typecheck` | Passed |
| `pnpm --filter legalwork-server build` | Passed, including the bundled wiki plugin |
| `pnpm --filter @legalwork/app build` | Passed; existing large-chunk notices remain |
| `pnpm --filter @legalwork/app test:i18n` | Passed for both shipped languages |
| `git diff --check` | Passed |

The skipped tests require external engine/provider services. Shared sync was exercised with two real local wiki folders and an HTTP fixture implementing the wiki registry and signed chunk contract. A live firm account and a real model extraction were not used. Source capture integration verifies the actual tool → HTTP API → Markdown/index path.

The companion model-api change is on `codex/wiki-sharing`, based on `main` at `b2f7ef7`. Its full platform integration suite passed 193 tests with 2 skipped against a fresh isolated PostgreSQL database and the existing object store test service. The focused wiki/project integration suite passed 30 tests, including a queued-write/revocation race; platform unit tests passed 347 with 2 skipped. Platform typecheck, changed-file ESLint, and the Next production build passed. A first broad run timed out in existing budget reconciliation tests because the shared test database contained 6,505 accumulated organization fixtures; the fresh-database run passed without changing those services.

The model-api implementation and migration `0031_wiki_sharing.sql` are prepared locally, not deployed. Replace older platform instances before enabling wiki creation; older project APIs cannot distinguish the new wiki rows. LegalWork checks the independent-sharing capability and reports an upgrade requirement on an older platform. The companion repository documents the API and rollout in `docs/wiki-sharing.md`.

## Performance sample

For 10,000 representative Markdown pages (1.82 MB), measured locally: initial index 12.24 seconds; unchanged refresh 210 ms; one-page external update 209 ms; indexed search including freshness scan 234 ms. UI page lists and views offer incremental “Show more”; the graph is bounded.

## Browser evidence

The screenshots use synthetic knowledge and a temporary workspace.

- [Markdown reading and links](wiki-evidence/preview.png)
- [Wiki graph](wiki-evidence/graph.png)
- [Markdown-defined process board](wiki-evidence/board.png)
- [Create a wiki with its own members](wiki-evidence/shared-create.png)
- [Wiki audience settings](wiki-evidence/shared-settings.png)
- [Discover and join shared wikis](wiki-evidence/shared-join.png)
- [Preview safety fixture](wiki-evidence/safe-preview.png)

Focused sharing browser checks covered selected-member creation, audience updates, stopping sharing while retaining pages, joining with member permissions, and an interrupted sharing request retried after a browser reload with its original audience and no duplicate cloud wiki.

See [Wiki usage and bounds](wiki.md) for setup and the folder conventions. The content folder can be used independently of LegalWork. Registration and local history require the server state directory too. Wiki API permissions do not create an OS sandbox for existing local filesystem tools. Shared wikis use the firm's account and object store directly; source connectors remain available for importing knowledge.

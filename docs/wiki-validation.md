# Wiki implementation validation

Implemented on `codex/markdown-wiki`, starting from `dev` at `19c40010`.

## Wiki settings in the selector (2026-10-08)

- Moved Wiki settings beside the current wiki's topbar dropdown. The button appears on selector hover or keyboard focus; touch devices keep it available. Removed duplicate settings buttons from the navigation footer and page toolbar.
- Native Electron verified the hidden default appearance, dropdown operation, and opening/closing General settings for Firm Knowledge. App typecheck, production build, and `git diff --check` passed.

## Shared folder panel design (2026-10-08)

- Extracted the existing Project Files row into `FileBrowserRow`, shared by Project Files and the Wiki file tree and views. Wiki uses the existing blue `FolderIcon`, file-type `ArtifactIcon`, row sizing, typography, hover/focus states, and selection treatment. Toolbar height and panel spacing follow the other right-side browsers.
- Native Electron checks compared both panels, expanded a Wiki folder, verified its context menu, opened Wiki and Views in standard WYSIWYG tabs, checked nested YAML in Source, and navigated a Project Files folder and back. No page contents were edited. [Screenshot](wiki-evidence/shared-folder-design.png).
- App typecheck, the 12-test Wiki tree/tab/syntax suite, production build, and `git diff --check` passed. Electron remains available on port 5176.

## Shared Markdown editor (2026-10-08)

- Writable Wiki pages and new pages use `ArtifactMarkdownEditor` directly through a small Wiki syntax plugin. Removed the duplicate Read/Edit/Markdown controls, custom source editor, and syntax restrictions that hid WYSIWYG for wiki links and nested YAML. Source and Diff remain the shared editor's own controls; explicit source requests do not remount the editor.
- Wiki links import as ordinary editor links and serialize back to `[[target|label]]`. The standard Create Link dialog offers page destinations; destination actions open standard Wiki tabs. Full frontmatter goes through the existing frontmatter plugin. Unsupported syntax switches to the shared Source view, and Wiki raw HTML processing is disabled.
- Parser regressions cover paths, aliases, Unicode, heading destinations, nested/multiline YAML, code, escaped bracket literals, ordinary links, and link creation. The app suite passed 939 tests; the focused Wiki suite passed 20. App typecheck, production build, i18n (5763 keys per language), and `git diff --check` passed.
- Live Electron verification subsequently confirmed default WYSIWYG rendering of Wiki links and a page with nested YAML, as well as Source → Rich text switching. [Screenshot](wiki-evidence/shared-folder-design.png). The dev server remains available on port 5176.

## Wiki file explorer (2026-10-08)

- Fixed the sidebar's 85% width cap. The wiki selector now occupies the topbar, and the toolbar exposes new page, new folder, search, whole-wiki graph, and collapse-all icons.
- Replaced the Pages/setup/attachment groups with one nested file tree, including empty directories and binary attachments. Files and folders have context menus for creation, rename, move, duplicate, paths, local Finder/Explorer reveal, and recoverable deletion; pages also offer source editing, links, history, and download.
- New wiki-scoped APIs enforce existing access, approvals, read-only restrictions, safe paths, and revision checks. Occupied destinations return a conflict without replacing content. Hidden local trash preserves complete files/folders and offers restoration. Shared sync still transfers files; empty folders and trash copies remain local.
- Native Electron checks verified the topbar menu, folder creation, a page created inside a folder, source-mode standard tabs, rename and move with tab updates, duplication, filename search, the whole-wiki graph tab, page trash/restore, and folder trash. Temporary test content was moved to recoverable trash after verification. [Sidebar](wiki-evidence/explorer-sidebar.png) · [Context menu](wiki-evidence/explorer-context-menu.png).
- `pnpm --filter @legalwork/app test`: 933 passed, 0 failed. The wiki store/HTTP/sync/access/sharing/agent suites passed 66 tests across 11 files; the final conflict-response assertions also passed the 13-test store suite. Both typechecks, both production builds, i18n (5763 keys per language), and `git diff --check` passed. Existing large-chunk build notices remain.
- The dev app remains on port 5176 with the existing wiki profile. The Office add-in watcher exhausted the Vite heap during an initial reload; this instance was restarted with that optional watcher disabled and an 8 GB Node heap. Other Electron instances were left running. `d4fd2ffd` remains an ancestor; no upstream files or dependencies were removed.

## Right sidebar and standard tabs (2026-10-08)

- Wiki opens the folder browser in the right sidebar without opening the viewer or changing the main page. The folder browser and viewer close independently.
- Pages, table/board views, the graph, and linked setup files use the existing tab store and tab strip. Links reuse page tabs; switching tabs retains Markdown mode and the mounted editor.
- Native Electron checks verified page rendering, board and table tabs, the graph, page-tab reuse from a board, Markdown mode retention, and independent panel closing. [Screenshot](wiki-evidence/sidebar-tabs.png).
- `pnpm --filter @legalwork/app test`: 930 passed, 0 failed. Typecheck, production build, i18n checks (5738 keys in each language), and `git diff --check` passed. Existing build chunk warnings remain.
- The Electron dev server runs on port 5176 with the wiki development profile. An initial workspace request stalled during startup; the connection recovered before the native UI checks.
- `d4fd2ffd` remains an ancestor of this branch. This change leaves server APIs, dependencies, and upstream routes intact.

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

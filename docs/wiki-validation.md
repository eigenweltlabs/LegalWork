# Wiki implementation validation

Implemented on `codex/markdown-wiki`, starting from `dev` at `19c40010`.

## Native law firm setup and prepared Harvey import (2026-10-12)

- New Wiki → Law firm now creates the agreed folder structure and four editable native skills in `Skills/`: setup, capture, use and maintain. The 22 starter pages contain guidance and templates, without fabricated client or matter records. Root instructions and two regional instruction files keep the defaults replaceable by the firm.
- Created **Firm setup verification** through the running Electron UI. The existing configured Eigenwelt Europe Mistral model automatically loaded `wiki-setup` through the native skill tool, accepted a normal structure-only setup prompt for the fictional Linden Example Law, and adapted the files while the tree refreshed. The resulting wiki has 27 pages, no client or matter records, no import checkpoint and no unresolved internal links. A review exposed inferred conventions; the skill was tightened and the agent corrected these to explicit proposals while preserving the fictional status. [Agent result](wiki-evidence/firm-setup-agent-result.png).
- The live run exposed three faults, now fixed: string-encoded null page revisions prevented creation; private-wiki storage and shell requests omitted authenticated session origin; queued prompts did not restore origin after app restart. Native continuation after restart now reads and edits the wiki successfully. Regression tests preserve create-only conflict checks, closest-workspace scoping, session matching, collaborator downgrade, project write approval and rejection of management endpoints.
- Visible skill discovery, reads, edits, deletion and runtime reload resolve the actual wiki-local package. Sibling workspaces do not inherit these skills. Shared-sync integration verifies that the four packages arrive and load for a member. New firm dashboards use `Dashboards/`; old view locations remain supported.
- Refreshed the prepared **Harvey · Firm knowledge** starter, retaining its source connection, original chat and a compatibility link for its old setup prompt. The original starter is backed up outside the repository and retired files are recoverable. The read-only S3 connection lists 266 matter folders across three pages. The wiki still has no imported client or matter records and no import checkpoint; its chat is idle. Electron is left on the wiki with the source folders visible. [Ready state](wiki-evidence/firm-setup-harvey-ready.png). The import was not started.

Validation: the command below passed 157 tests with 902 assertions across 13 files. One real-VM test was skipped because `LEGALWORK_WIKI_VM_RESOURCES` was not configured; native model verification used the existing unsandboxed wiki session. `pnpm --filter legalwork-server build` passed, including typechecking. `git diff --check` passed. A complete Harvey import and live VM execution remain unverified.

```sh
pnpm exec bun test \
  apps/server/src/wiki/templates.test.ts \
  apps/server/src/skills.test.ts \
  apps/server/src/legalwork-runtime-config.test.ts \
  apps/server/src/wiki/store.test.ts \
  apps/server/src/views/repository.test.ts \
  apps/server/src/wiki/agent-access.test.ts \
  apps/server/src/wiki/team-agent-access.e2e.test.ts \
  apps/server/src/skill-resources.test.ts \
  apps/server/src/global-skills.test.ts \
  apps/server/src/opencode-plugins/legalwork-wiki-tools.test.ts \
  apps/server/src/opencode-plugins/legalwork-wiki-tools.e2e.test.ts \
  apps/server/src/opencode-plugins/legalwork-storage-tools.test.ts \
  apps/server/src/session-message-queue.test.ts
```

## Compact properties below the page title (2026-10-11)

- The editable page title appears first, followed by four property rows and an expandable list of the remaining fields. Identifiers and fixture metadata are tucked into the expanded list; title metadata is represented by the title itself. Properties have no separate container or scrollbar. Read-only pages use the same compact layout. [Native Electron screenshot](wiki-evidence/compact-properties-below-title.jpg).
- Native checks expanded/collapsed 17 client properties, edited the title, verified that the body was byte-identical, restored the complete original file, and switched Source/Rich text. Title edits preserve unrelated YAML and Markdown; Source retains the complete authored H1 and metadata.
- `pnpm exec bun test tests/wiki-page-heading.test.ts tests/wiki-properties.test.ts tests/wiki-properties-editor.test.tsx tests/markdown-block-editor.test.ts tests/markdown-draft.test.ts tests/wiki-markdown-syntax.test.ts` (from `apps/app`): 42 passed, 162 assertions. App typecheck, production build and i18n validation passed (6,232 keys in each shipped language).

## Live dashboard generation and wiki workspace fixes (2026-10-11)

- Actual model verification in the running Electron app now confirms progressive rendering. The existing configured model generated a new view over Northstar's 50 synthetic clients and 150 matters. The dashboard opened in the panel beside its chat, received 85 preview updates, with the first preview arriving 11.8 seconds before the file was saved. [During generation](wiki-evidence/live-dashboard-streaming.jpg) and [saved dashboard after restart](wiki-evidence/live-dashboard-saved.jpg).
- The earlier assumption that the bundled engine forwarded partial tool arguments was incorrect: OpenCode 1.18.29 discards `tool-input-delta`. A compatibility bridge in the existing wiki plugin now forwards genuine provider argument chunks to an authenticated, bounded, ephemeral SSE channel. OpenAI Responses, Chat Completions-compatible and Anthropic formats are covered. The correlation header never reaches the provider, and preview delivery failure does not interrupt the model response. No second model or service is used.
- Generation observation now runs independently of collapsed tool groups. It opens a new draft tab beside chat at the start, incrementally renders its program, and resolves that tab to the saved view. Completed history does not reopen old dashboards; closing a preview does not cause repeated reopening. Live query results populate once the saved definition has passed validation. Existing write approvals and revision checks still govern saving.
- Each wiki has its own panel layout and fresh initial tabs. Regression and native checks cover independent wiki switching, layout restoration and closing tabs without altering another wiki.
- Properties are always visible as typed icon/name/value rows with inline scalar, date, checkbox, list and linked-page editing. Properties and body use one scroll area. Source mode still exposes the complete Markdown file, and unknown nested metadata stays preserved. [Properties](wiki-evidence/inline-properties.jpg).
- `pnpm exec bun test tests/view-generation-sync.test.ts tests/wiki-properties.test.ts tests/wiki-properties-editor.test.tsx tests/panel-side-pane.test.ts tests/wiki-tabs.test.ts tests/views.test.ts` (from `apps/app`): 116 passed.
- `pnpm exec bun test apps/server/src/opencode-plugins/view-stream-parser.test.ts apps/server/src/opencode-plugins/view-stream-bridge.test.ts apps/server/src/opencode-plugins/legalwork-wiki-tools.e2e.test.ts`: 7 passed, including authenticated preview routing, mismatched session rejection and both declared and missing SSE Content-Type headers.
- App/server typechecks and production builds passed. Existing app bundle-size notices remain. The Harvey import was not resumed and remains ready for the user.

## Firm workflows and local Harvey S3 demonstration (2026-10-11)

- Added the firm starter's folder procedures, source coverage/checkpoint workflow, client/matter page templates, relation-field conventions and indexed GenUI guidance. A bundled Build firm knowledge workflow is discoverable across workspaces and preserves subsequent firm edits.
- Mirrored all 9,538 files from the pinned Harvey firm-knowledge subtree into a dedicated local MinIO bucket. Verified Git blob hashes, uploaded object checksums and complete listings. The app connection exposes its 9,288 DMS records across 266 matter folders, excluding benchmark questions/rubrics. Setup, provenance and prompts: [Harvey demo](wiki-harvey-demo.md).
- Native Electron verified S3 browsing, source Word document rendering, automatic appearance of a file written outside the UI, and wiki state restoration after restart. Fixed stale workspace selection during a new wiki switch. Tree revision polling now also refreshes saved-view data/lists.
- New reports save under Reports/; dashboards use Views/. Renamed and legacy view files remain supported.
- `pnpm --filter @legalwork/app test`: 1,276 passed across 199 files. App typecheck and production build passed.
- `pnpm exec bun test apps/server/src/wiki apps/server/src/views apps/server/src/global-skills.test.ts apps/server/src/opencode-plugins/legalwork-storage-tools.test.ts apps/server/src/wikis.e2e.test.ts apps/server/src/opencode-plugins/legalwork-wiki-tools.test.ts apps/server/src/opencode-plugins/legalwork-wiki-tools.e2e.test.ts`: 158 passed across 20 files. Server build/typecheck passed.
- Actual agent import attempted at 19:44 UTC with the existing OpenAI provider. It failed before any tools with the provider's no-credits error and zero input/output tokens. The new wiki has its template and setup verification note, not an agent-produced import. The live extraction and model-generated views remain blocked on that connection's credits.

## Demo, page UI, view files and agent write boundaries (2026-10-11)

- Seeded **Northstar Law Demo** with 50 clients, 150 matters, 12 processes and four template pages with adjacent DOCX documents. Three live dashboards and wiki/project frozen reports use the real typed query implementation. Exact totals and four copyable agent prompts are in [demo flows](wiki-demo-flows.md).
- Removed the persistent Markdown toolbar, replaced the vendor image dialog with the app dialog, and aligned page content and properties. Native Electron verified image insertion, dashboard source navigation, the editable Word template tab, and searchable multi-page metadata selection/removal. Metadata link values contribute graph edges; ordinary stage strings do not.
- Dashboard/report `.view.json` files now open their dedicated viewer from wiki and project file trees. Generation previews have their own temporary tab and resolve to the saved file in place. Unit tests cover incomplete input, successful save, failure, duplicate saved tabs and persistence. Native Electron verified full-tab/embedded data and wiki tab restoration after restarting.
- Project-agent wiki writes always request a fresh approval in the originating chat, including when ordinary approvals are automatic. Tests cover page/property/view writes, deletes, refusal, disconnect/timeout, incorrect session/workspace, actor downgrade and revoked wiki access. Reads use authorized wiki tools without approval. Delegated agents inherit live scope through engine-verified ancestry, never caller-supplied parent claims.
- Bundled file tools block direct cross-wiki reads/writes and runtime/configuration bypasses. Unsandboxed host shell execution is blocked when external wikis require protection; sandbox mounts keep those wikis read-only. These guards do not turn arbitrary host-loaded third-party plugins, formatters or language servers into an OS sandbox.
- Real HTTP regressions exposed and fixed Bun cancellation behavior, long approval waits and transport limits for supported wiki uploads. The Electron Node adapter remains in use on desktop.
- A real model test was attempted at 19:25 UTC. The configured OpenAI API returned **“You have no credits remaining. Add credits to continue using the API”**, with zero input/output tokens and no tool calls. Model-generated streaming cadence, model-triggered native approvals and the four prompts' model execution remain unverified. The seeded programs, production query/renderer path and authenticated tool/HTTP approval behavior are tested; no provider was changed and no billing action was taken.

| Command | Result |
| --- | --- |
| `pnpm --filter @legalwork/app test` | 1,276 passed, 0 failed, 199 files |
| `pnpm exec bun test apps/server/src/wiki apps/server/src/views apps/server/src/opencode-plugins/legalwork-wiki-tools.e2e.test.ts apps/server/src/agent-sandbox/files.test.ts apps/server/src/agent-sandbox/service.test.ts apps/server/src/agent-sandbox/network.test.ts apps/server/src/serve-node.test.ts apps/server/scripts/fixtures/law-firm-wiki.test.ts packages/openui/src/catalog.test.tsx packages/openui/src/law-firm-demo.test.tsx` | 215 passed, 0 failed, 1,667 assertions |
| App/server typechecks and production builds | Passed; existing app chunk-size notices remain |
| `pnpm --filter @legalwork/app test:i18n` | 6,227 complete keys per shipped language |
| `git diff --check` | Passed |

## OpenUI experiment and final technical checks (2026-10-11)

The OpenUI layer is a separate commit above the wiki workspace/editor/graph baseline. Reverting that layer removes its UI, typed view/query tools and bundled dependencies without reverting the baseline. Existing Markdown and saved view files are not migrated or deleted.

- Native Electron: opened a saved dashboard in a normal tab, followed a board source into its editable wiki page, changed its typed value from 12,000 to 13,000 and then 14,000, and observed the live aggregate change from 42,000 to 43,000 and then 44,000. The final save invalidated the dashboard immediately. Reload restored the active dashboard and other workspace tabs. The board fits its three columns; the stock OpenUI chart and sortable table render below it.
- Native Electron: a project report retained the original frozen value of 12,000 while its source button opened the wiki page containing the newer value. Inline widgets rendered inside editable Markdown; editing adjacent prose retained the exact UUID reference fence. **Open view in tab** reused the saved dashboard tab without replacing its title.
- Server regressions exercise typed property patches and preservation, indexed fields, filtering, aggregate-before-pagination behavior, stale cursors, invalid definitions, stable view identity across renames, revision conflicts, malformed/conflicting files, project ownership, nested-workspace isolation, two-host shared-view sync and revocation. A sync follow-up ensures explicit refresh waits for writes arriving during an existing sync pass.
- The actual OpenUI parser and component catalog render incomplete streamed content in tests. The existing agent tool transport forwards partial arguments. An actual model session's streaming cadence and latency are still unverified in the isolated signed-out profile; no speed improvement is claimed from the vendor's token benchmark alone.
- Packaging: the server schemas are bundled into a standalone runtime module. The server plugin output has no unresolved bare imports, the server distribution has no unbundled `@legalwork` runtime imports, and desktop/server dependency checks pass. The OpenUI development inspector is stubbed locally in both app builds; runtime cloud observability is off. No paid service or new model provider is introduced. Third-party notices are included under `public/third-party/openui`; regenerate them with `pnpm exec node apps/app/scripts/openui-license-notices.mjs` after dependency changes.

| Command | Result |
| --- | --- |
| `pnpm --filter @legalwork/app test` | 1,266 passed, 0 failed, 198 files |
| `pnpm --filter legalwork-server exec bun test src/wiki/properties.test.ts src/wiki/data-query.test.ts src/views/repository.test.ts src/wikis.e2e.test.ts src/wikis-team.e2e.test.ts src/opencode-plugins/legalwork-wiki-tools.test.ts src/opencode-plugins/legalwork-wiki-tools.e2e.test.ts src/wiki/agent-access.test.ts src/wiki/sync.test.ts` | 78 passed, 0 failed, 544 assertions |
| `pnpm exec bun test packages/openui/src/catalog.test.tsx apps/app/tests/views.test.ts apps/app/tests/wiki-graph-sigma-compat.test.ts apps/app/tests/wiki-graph-labels.test.ts apps/app/tests/wiki-graph-data.test.ts apps/app/tests/wiki-graph-physics.test.ts` | 16 passed, 0 failed, 77 assertions |
| App and server typechecks | Passed |
| App, Word add-in and server production builds | Passed; existing large-chunk notices remain |
| `pnpm --filter @legalwork/app test:i18n` | 6,209 keys in each of two shipped languages |
| `node apps/desktop/scripts/check-server-deps.mjs` | Passed |

Evidence uses only synthetic records: [dashboard](wiki-evidence/openui-dashboard.png), [chart and table](wiki-evidence/openui-chart-table.png), [inline widget](wiki-evidence/openui-inline-widget.png).

Current limits: page content/properties still use Markdown/frontmatter as canonical storage, while views use stable typed records over the existing file-sync adapter. A full Notion-style canonical block/record store needs its own migration and synchronization work. OpenUI boards navigate to editable records but do not yet write fields by dragging cards. The 100,000-node graph benchmark measures the production renderer with synthetic data, not complete cold disk indexing through the app. Native cross-window drag gestures and a real provider-generated streaming report remain unverified.

## Editor, files, and graph baseline (2026-10-11)

- Added hover block controls, slash insertion, selection formatting and editable tables. Source mode preserves the original Markdown. Merely opening, focusing, or switching editor modes does not save parser-normalized content. Real rich-text edits can normalize Markdown spacing. Metadata edits preserve unknown fields and comments.
- Native Electron verification imported DOCX, XLSX, PPTX, PDF, PNG and TXT through the system file picker. All six stored files were byte-identical to their sources. Word, Excel and slides opened in the existing editable tabs; PDF opened in its existing viewer. A property-only edit changed just the selected frontmatter value, preserving the body, table spacing, comments and final newline.
- System file/folder drops copy into the selected wiki folder, including empty directories. Cross-project drops resolve the source through the existing project-file provider. Occupied paths receive a new name; imports never replace an existing file. Folder recursion and the wiki drop target's precedence over the surrounding workspace target have regression coverage. Native cross-window drag gestures were not separately verified.
- Replaced the static graph with interactive pan, zoom, hover, drag and force motion; retained page navigation and automatic Canvas rendering when GPU initialization fails. The running Obsidian application was inspected to distinguish its actual Pixi/worker/WASM implementation from assumptions. Large fixtures, GPU traces and remaining layout limits are documented in [graph research](wiki-graph-research.md).
- `pnpm --filter @legalwork/app test`: **1,260 passed, 0 failed**, across 196 files. `pnpm --filter legalwork-server exec bun test src/wiki src/wikis.e2e.test.ts src/wikis-team.e2e.test.ts src/opencode-plugins/legalwork-wiki-tools.test.ts src/opencode-plugins/legalwork-wiki-tools.e2e.test.ts`: **70 passed, 0 failed**, across 12 files.
- App typecheck, app and server production builds, i18n validation (6,209 keys per language), and `git diff --check` passed. The app build retains existing large-chunk warnings.
- OpenUI remains a separate follow-on layer. The [storage comparison](wiki-openui-research.md) distinguishes the current file-backed implementation from the proposed structured record model. No wiki storage migration is part of this baseline.

## Global wiki workspace (2026-10-11)

- Wiki now opens from the left global rail. Each wiki uses its folder-backed workspace with independent tabs, split panes and chats. Project workspaces can open wiki pages from the tab `+` menu.
- Wiki page, graph and view tabs now persist through reload. The global Wiki entry restores the last selected wiki and focused pane. Folder expansion and navigation width are saved separately per wiki. Old right-sidebar routes open the global wiki page.
- A normal link click opens the destination in the originating tab group. Internal wiki links use a safe editor URL and serialize back to `[[...]]`. Alt-click remains available for link editing. Removed the redundant page header, save/options row and file-path footer around the Markdown editor.
- Native Electron checks: opened Wiki from the left rail; opened Instructions in a standard tab; followed Structure and Templates links directly; created a wiki chat; opened a page beside that chat; reloaded and verified both panes and tabs; switched to a project, opened `+ → Wiki page…`, and selected a page; returned to Wiki and verified its independent layout and selected page.
- Read-only inspection of the new session's database record confirmed its `directory` exactly matched the registered wiki workspace path. No model prompt was sent for this check.
- `pnpm --filter @legalwork/app test`: **1,230 passed, 0 failed** across 191 files. New regressions cover wiki tab persistence with chats and split panes, wiki routes, and editor-safe wiki-link round trips.
- `pnpm --filter @legalwork/app typecheck`, `pnpm --filter @legalwork/app build`, `pnpm --filter @legalwork/app test:i18n`, and `git diff --check` passed. i18n validates 6,158 keys in both shipped languages. Existing production-build chunk-size notices remain.
- This earlier workspace phase did not replace the graph renderer or add block controls. Those subsequent changes and their measured limits are recorded above, in [block editor findings](wiki-block-editor-research.md) and [graph findings](wiki-graph-research.md).

## Rebase verification (2026-10-11)

Rebased all 17 feature commits onto `origin/dev` at `69ab8f3d9305beb186cd6e4f1acf3bb070f17727`. The previous head is retained locally as `backup/wiki-246-before-rebase-20261011` (`0054465d`).

- Integrated wiki tabs with dev's unified split-pane workspace, preserving pane layout, project navigation, policy controls, file dragging, and sandbox/runtime registration. Wiki rename and trash now update pane references without discarding unrelated panes. A regression covers both operations across split panes.
- Installed the worktree's dependencies with `pnpm install --frozen-lockfile` before validation.
- `pnpm --filter @legalwork/app test`: **1,227 passed, 0 failed** across 191 files. The focused wiki/navigation checks also passed.
- `pnpm --filter legalwork-server exec bun test src/wiki src/wikis.e2e.test.ts src/wikis-team.e2e.test.ts src/opencode-plugins/legalwork-wiki-tools.test.ts src/opencode-plugins/legalwork-wiki-tools.e2e.test.ts src/legalwork-runtime-config.test.ts`: **80 passed, 0 failed** across 12 files.
- App and server typechecks, both production builds, and app i18n validation passed (6,156 keys in each language). The app production build used `NODE_OPTIONS=--max-old-space-size=8192`; existing large-chunk notices remain.
- The full server suite and native Electron smoke checks were not rerun for this rebase. Older native screenshots and validation results below describe their stated dates, not this rebased head. A live firm deployment and real model extraction still require verification.

Before merge, run `pnpm dev:electron`: open a wiki page in a standard tab, split it beside another document, rename/move it, then trash it and confirm the other pane remains intact. Check project navigation, file dragging, and sidebar width after opening/closing pages. With the reconciled companion API deployed, repeat the two-host sharing, revocation, and overlapping/offline-edit flows below.

## Stable sidebar width (2026-10-08)

- Opening or closing the document viewer restored a different cached panel layout and changed the wiki sidebar's width. The shared file sidebar now preserves its current pixel width across viewer changes and group resizing; manual resizing remains available.
- Native Electron verified stable sidebar and header widths when opening and closing a wiki page, both at the default 300 px and after resizing to approximately 360 px. App typecheck, production build, and `git diff --check` passed.

## History and Trash tabs (2026-10-08)

- Settings sit to the right of the picker, before sync, and retain hover-only visibility. Removed the separate sidebar Trash icon and dialog. Version history now contains History and Trash tabs using the existing queries, restore callbacks, and read-only restrictions.
- Native Electron verified the footer, opening version history, switching between both tabs, and rendering saved revisions and deleted entries with restore controls. App typecheck, production build, and `git diff --check` passed.

## Wiki selector in the footer (2026-10-08)

- Moved the wiki selector to the sidebar footer with refresh/sync on its right. Removed the footer Sharing row and lock/status text. Settings still appear immediately left of the dropdown arrow only on hover; the selector menu opens upward.
- Native Electron verified the footer layout, selector menu, opening/closing settings, and refresh without errors. App typecheck, production build, and `git diff --check` passed.

## Wiki settings in the selector (2026-10-08)

- Moved Wiki settings immediately left of the current wiki's dropdown arrow. The button appears only on selector hover; focus alone does not reveal it. Removed duplicate settings buttons from the navigation footer and page toolbar.
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

## Retiring YAML view configuration (2026-10-11)

The dedicated YAML view parser, snapshot projection, renderer, sidebar entries, saved tab kind, unused styles and translations were removed. Both starter templates now point to typed view tools and `.view.json` files. Page frontmatter, indexed queries, relations and authored Markdown are retained. The two starter views in each of the local technical-review and Northstar demo wikis were converted to saved dashboards; only unchanged starter Views.md guides were replaced, through revision-checked writes.

OpenUI boards now retain empty configured stages and provide user-initiated string-property changes. The host derives the page revision and write target from query provenance, rejects report/aggregate/fabricated rows, blocks pending editor drafts, and uses the existing properties API. Server authorization and project-agent write approvals are unchanged.

Validation: `pnpm --filter @legalwork/app typecheck`, `pnpm --filter legalwork-server build`, and `pnpm --filter @legalwork/app test:i18n` passed. The focused Bun suite passed 115 tests (983 assertions) across 14 files, covering property preservation, query provenance, retired-tab restoration, starter content, saved files, source navigation, streaming, and project-agent write approvals. In the running Electron app, a stage selection moved a temporary card into an empty column, refreshed its indexed value and preserved the Markdown body and property comment. Native drag automation did not produce a drop, so mouse dragging remains unverified in this check. The temporary page and dashboard were moved to recoverable trash, and the previous split proportions restored.

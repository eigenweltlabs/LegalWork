# Wiki implementation validation

Implemented on `codex/markdown-wiki`, starting from `dev` at `19c40010`.

## Verified behavior

- Personal folders, shared-folder creation/joining, editable Markdown structure, instructions, templates, skills, and views.
- Full-text search, frontmatter properties, page links/backlinks, bounded graph, tables, and Kanban changes saved to Markdown.
- Lossless source editing, automatic saves, draft retention, conflict protection, attachment previews/downloads, local history, deleted-page recovery.
- Global and selected-project wiki access; authenticated wiki-root sessions; API-backed agent read/search/write/delete tools.
- Desktop host authentication, remote credential separation, session-origin grants and collaborator downgrade; wiki/project folder overlap rejection.
- Two-folder automatic sync with immutable revisions and conditional manifest publication; independent edits merge, overlapping edits preserve conflict copies, interrupted/offline transfers retain changes, revoked access prevents publication, downloads cannot overwrite newer local saves.
- Preview sanitation: no scripts, embedded frames, event handlers, unsafe links, or automatic remote-image requests in the tested Markdown.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm --filter legalwork-server exec bun test src/` | 935 passed, 22 skipped, 0 failed (957 total) |
| `pnpm --filter @legalwork/app test` | 646 passed, 0 failed |
| `pnpm --filter legalwork-server typecheck` | Passed |
| `pnpm --filter @legalwork/app typecheck` | Passed |
| `pnpm --filter legalwork-server build` | Passed, including the bundled wiki plugin |
| `pnpm --filter @legalwork/app build` | Passed; existing large-chunk notices remain |
| `pnpm --filter @legalwork/app test:i18n` | Passed for both shipped languages |
| `git diff --check` | Passed |

Two earlier full server runs encountered an intermittent `ECONNRESET` in the existing attachment-upload test. That test passed when run independently, and the final complete run passed. No unrelated transport change was made to conceal the failure.

The skipped tests require external engine/provider services. Shared sync was exercised with two real local wiki folders and a versioned in-memory storage adapter; a live team storage account and a real model extraction were not used. Source capture integration verifies the actual tool → HTTP API → Markdown/index path.

## Performance sample

For 10,000 representative Markdown pages (1.82 MB), measured locally: initial index 12.24 seconds; unchanged refresh 210 ms; one-page external update 209 ms; indexed search including freshness scan 234 ms. UI page lists and views offer incremental “Show more”; the graph is bounded.

## Browser evidence

The screenshots use synthetic knowledge and a temporary workspace.

- [Markdown reading and links](wiki-evidence/preview.png)
- [Wiki graph](wiki-evidence/graph.png)
- [Markdown-defined process board](wiki-evidence/board.png)
- [Project access settings](wiki-evidence/settings.png)
- [Preview safety fixture](wiki-evidence/safe-preview.png)

See [Wiki usage and bounds](wiki.md) for setup and the folder conventions. The content folder can be used independently of LegalWork. Registration and local history require the server state directory too. Wiki API permissions do not create an OS sandbox for existing local filesystem tools. Shared storage must support conditional writes; SMB, FTP, and SFTP remain source connectors.

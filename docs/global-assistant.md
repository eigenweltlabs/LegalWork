# Global Assistant: implementation notes

This documents the implementation of the complete experience specified in [`docs/proposals/global-assistant-launcher.md`](proposals/global-assistant-launcher.md). It records what exists, how the contracts from the proposal are enforced, what was verified, and what remains open.

## Surfaces and entry points

| Entry | Where | Behaviour |
| --- | --- | --- |
| Global shortcut (default `Cmd/Ctrl+Shift+Space`) | `apps/desktop/electron/launcher/launcher-service.mjs` | Captures the external origin, shows the quick panel on the keyboard-focused display, delivers an `open` invocation. Visible and focused: toggles the panel away. |
| Direct shortcuts | Settings, Assistant launcher | Files, ask, speak, region capture, add selection, and any saved quick action. The selection shortcut reads the selection as part of the invocation, before the panel takes focus. |
| Floating companion | `apps/desktop/electron/audio/dictation-hud.mjs` | The existing non-focusable HUD gains an Assistant handle with the attention count and recording state. It never takes typing focus. |
| In-app `Cmd/Ctrl+K` | `apps/app/src/react-app/launcher/launcher-dialog.tsx` | The same panel component inside the main window, replacing the previous shell-scoped palette. |
| Home | `apps/app/src/react-app/shell/session-route.tsx` | Binds to a concrete conversation; the composer claims the shared draft lease on focus. |
| Tray | `apps/desktop/electron/tray.mjs` | Open Assistant, Search files, New question, Work needing attention. |
| Deep links | `legalwork://assistant/<action>?invocation=…&q=…&context=…` | Routed to the panel by the desktop process, including cold start; repeated delivery of the same invocation ID is ignored. |
| Raycast | `apps/raycast-legalwork` | Five commands over a launch URL plus the paired loopback connection. |

The panel is a dedicated route (`#/launcher`) of the normal renderer bundle: it shares the connection, theme, i18n and the chat components, and mounts no workspace shell.

## Keyboard model

Implemented in `apps/app/src/react-app/launcher/launcher-query.ts` and `launcher-keyboard.ts`, tested in `apps/app/tests/launcher-query.test.ts` and `launcher-keyboard.test.ts`.

- `f`, `p`, `c`, `t`, `r` plus Space or Tab at the start of the query become a removable category chip. Bare letters, pasted prose and chat text stay text. Aliases are configurable; collisions are reported in settings.
- `/` opens commands and skills, `?` plus a space enters a conversation. A question-shaped search stays a search.
- Backspace at the start removes the category chip and keeps the query. The project scope chip is separate and never removed with a category.
- Up/Down keep the selected row by stable ID while results stream in; a vanished row requires a new selection. Enter runs the selected row's visible action, which the footer names. No selection means no model request.
- `Cmd/Ctrl+Enter` asks the Assistant with the typed text and staged context. `Cmd/Ctrl+K` opens the action menu. Escape closes the innermost menu or preview, then clears the filter, then dismisses an unpinned panel. IME composition never submits.

## Search

`GET /launcher/search` (`apps/server/src/launcher-search.ts`) fans out to projects, files, chats, tasks and recordings. Every source reports its own coverage (`complete`, `partial`, `filename-only`, `indexing`, `searching`, `unavailable`), so a slow or failed provider never reads as "nothing found". The incremental filename index (`launcher-file-index.ts`) walks a project once, keeps it current through the platform watcher, and ranks exact, prefix, word, substring and fuzzy matches; a keystroke never rewalks a folder. Content matches arrive in a second pass that appends without reordering what is on screen (`launcher-search-session.ts`).

Result actions are only advertised when the provider can execute them: open, reveal, open with default app, attach, ask, compare, summarize, copy path, pin, mark done, hand to Assistant, play, resume. Multi-select with `Cmd/Ctrl`+click or the row checkbox enables compare and summarize over exactly the selected files.

## Conversations, drafts and submissions

- `apps/server/src/assistant-conversations.ts`: explicit conversations in the Assistant workspace with pin, archive and search. Daily sessions from the first Assistant version stay readable as `day:YYYY-MM-DD`. `GET /assistant/conversations/current` is read-only; nothing creates a conversation except `POST /assistant/conversations`, a first Home message, or opening the Assistant from the sidebar.
- `apps/server/src/assistant-submissions.ts`: every submission carries a client request ID and message ID before dispatch. A retry after a lost acknowledgement resends only when the engine has no record of the message; status is reconciled from the engine (`sending`, `accepted`, `running`, `completed`, `failed`, `unconfirmed`).
- `apps/app/src/react-app/launcher/draft-coordinator.ts`: one authoritative, revisioned draft per conversation (text, attachments, pasted material, scope, pending transcription, model preferences, submission state). Exactly one editor holds the lease; focusing a composer or expanding to Home transfers it with the whole draft. Broadcasts notify, the persisted file decides, and a crashed renderer never overwrites a newer revision. On the desktop the file lives in the app data folder, not `localStorage`.
- Delegated results return to the conversation that started them (`destination` in `apps/server/src/server.ts`); only an archived or deleted origin falls back to the current conversation. No midnight retargeting.

## Work and attention

`GET /assistant/work` lists every delegated job with its origin conversation, exact destination, live status and pending attention; `POST /assistant/work/:workspaceId/:sessionId/{stop,reply,redirect}` affects that job only. Pending questions and approvals are read from the engine (`GET /assistant/conversations/:id/attention` plus the existing delegated attention routes), so a blocking question is visible even when the model never presents it.

## Scope and execution target

Search scope (chip), source (provenance on each staged item) and execution target (the "Work in …" chip) are three different things in the panel. The target is frozen into the submission's context envelope and enforced on the server: a request bound to a project cannot be delegated elsewhere (`delegation_target_constraint` in `routes/main-assistant.ts`), and the Assistant's project-creation tool is refused for such a request. Captured text is quoted to the model as reference material.

## Context, capture and voice

- Add selection, paste clipboard, attach file, capture window and capture region are explicit actions (`context-capture.ts`). Captures are saved into the Assistant project and previewed with source app, window and time.
- The desktop origin service (`origin-service.mjs`) records the frontmost app before the panel takes focus; the native macOS helper gained `--frontmost`, `--selected-text` and `--activate` modes (Accessibility, no continuous monitoring). Windows uses `GetForegroundWindow`, UI Automation text patterns and `SetForegroundWindow`. Insert validates the destination (process and window title) after reactivating it; a changed destination copies the result and says so.
- Voice has three destinations. The panel's Speak button uses the existing composer dictation pipeline; the desktop reports external dictation and meeting state in `launcherStatus`, and the panel refuses to start a second capture while either is active (`voice-coordinator.ts`).

## Desktop lifecycle

- `launcher.json`: shortcut, background presence (independent of dictation), autostart, companion, aliases, direct shortcuts, pinning, position memory.
- One shortcut registry (`launcher-shortcuts.mjs`) reports duplicates, collisions with the dictation chord and registrations the OS refused; wake re-applies only lost chords.
- Host approvals are presented in the quick panel while it is visible, otherwise in the main window.
- The panel hides on blur unless pinned or a capture/dialog of its own is open; it repairs off-screen remembered positions.

## Raycast

`apps/raycast-legalwork` reads `launcher-pairing.json` (written by Settings, Assistant launcher, with mode 0600 and a per-session token). Launch URLs carry identifiers only; selected text is staged over the loopback connection as a one-time context that expires after five minutes.

## Verification

Automated:

- `pnpm --filter legalwork-server typecheck`, server unit tests for conversations, submissions, file index, search, actions, staged context, work and delegation destination.
- `pnpm --filter @legalwork/app typecheck`, `pnpm --filter @legalwork/app test:i18n`, app unit tests for alias parsing, keyboard stability, draft handoff and crash reconciliation, voice ownership, deep links, search session cancellation and merging, conversation resolution.
- `pnpm --filter @legalwork/desktop typecheck:electron`, `check:electron`, desktop unit tests for settings, shortcuts, origin validation and insertion, pairing, placement and the service's invocation path.

Manual and platform tests that still need a real device run are listed in the pull request: macOS Spaces/fullscreen, Windows foreground-lock and mixed DPI, sleep/wake, Raycast cold start and the end-to-end recording.

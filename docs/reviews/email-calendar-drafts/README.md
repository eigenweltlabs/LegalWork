# Editable email and calendar drafts

The agent can present a draft directly in chat. Email shows the recipient,
subject, message and attachment chips. Event cards show the title, a date tile,
time, and any supplied location, guests and notes. Optional fields stay behind
options controls; the date block expands when the user wants to change it.
Save appears only while the draft has edits. Opening or downloading also saves
pending edits first.

On macOS, Open in Apple Mail creates and saves a visible compose window with
To, Cc, Bcc, subject, message text and attachments. Files are downloaded through
the workspace API and staged privately for Mail, so remote project paths never
become local attachment paths. The temporary copies are removed after handoff.
The helper has no send action. HTML and custom Reply-To remain in the EML
download; the card explains this when either field is populated. Other desktop
platforms use a mailto compose link. The main action and its menu form one split
button. On macOS, the menu has separate Outlook app and Outlook web actions.

The native Outlook action creates an outgoing message with its `make` command,
adds recipients and attachments, and opens its editable composer. Outlook
persists the draft itself; its scripting `save` command exports a file and is
not used. The helper checks that every attachment was imported before opening.
Outlook uses its selected sending account. Native
mail actions use plain text; advanced fields remain in the EML export.
Both native mail actions require macOS Automation consent.

The implementation imports the patch supplied in
`legalwork-email-calendar-drafts.zip` and includes review corrections:

- Preserve quoted commas and complete international display names in EML
  headers. Mailto recipients use address specs, following
  [RFC 6068](https://www.rfc-editor.org/rfc/rfc6068#section-2).
- Clear the optional HTML body when the visible message is edited, preventing
  an email app from preferring stale text over the user's correction.
- Preserve the intended day when changing an all-day event to a timed event.
  Clearing a date does not change the input mode or crash the card.
- Register each mounted card separately so a clean duplicate cannot hide
  another card's unsaved edits.
- Exercise actual HTTP authorization, workspace boundaries, read-only mode,
  optimistic revisions, file downloads and agent-tool routing.
- Bundle draft schemas into the Node server so Electron can load the routes
  without the workspace TypeScript sources. The build smoke test rejects
  unbundled workspace dependencies and runs in CI.

## Validation

Run from the repository root with Node 24, pnpm and Bun:

```sh
pnpm install --frozen-lockfile
pnpm test:drafts
pnpm --filter @legalwork/app test
pnpm --filter @legalwork/app typecheck
pnpm --filter legalwork-server typecheck
pnpm --filter legalwork-server build
pnpm test:drafts:build
pnpm --filter legalwork-server exec bun test src/email-drafts/routes.test.ts src/opencode-plugins/legalwork-draft-tools.test.ts src/opencode-plugins/legalwork-calendar-tools.test.ts src/legalwork-runtime-config.test.ts
node scripts/i18n-audit.mjs --ci
pnpm --filter @legalwork/desktop test
pnpm --filter @legalwork/desktop typecheck:electron
pnpm --filter @legalwork/desktop check:electron
```

Results: 21 draft tests, 1,210 app tests and 20 HTTP/plugin/runtime tests passed.
Both typechecks, the server build and the i18n audit passed.
The Node build smoke test also passed. Electron was launched on macOS with an
existing development profile; the app reached ready state and loaded saved
workspaces and sessions without a module-resolution error.
For the Apple Mail fix, 224 desktop tests passed (2 skipped), including four
native compose regressions; 1,210 app tests, both app/desktop typechecks and the
IPC bridge check passed. On macOS, a synthetic draft was saved and verified in
Mail's editable composer with To/Cc/Bcc, Unicode text and an intact attachment.

For the Outlook follow-up, 228 desktop tests passed (2 skipped), including eight
native mail regressions. App tests (1,210), both typechecks and the IPC bridge
check passed. Outlook 16.113.4 on this Mac opened a synthetic native draft with
To/Cc/Bcc, Unicode text and an attachment. The subject and body were edited in
Outlook, then the draft was closed and reopened from Drafts. Quick Look showed
the exact attachment text after the temporary source copy had been removed.
No email was sent, and synthetic drafts were moved to Deleted Items afterward.

The installed Outlook silently omitted attachments when importing both our
EML-based template and a template exported by Outlook itself. Template opening
is therefore not used. Initial native scripting failed until macOS Automation
consent was enabled with the user's approval. The work account also reported
that it needed sign-in again; account authentication was not changed.

## Browser verification

The screenshots use synthetic data in an isolated temporary workspace. They
render the actual React cards against the actual LegalWork server API; agent
output was seeded, rather than generated by a live model. Checked in the
browser's wide and narrow layouts:

1. Edit and save an email, then reload the card and confirm the saved text.
2. Change Bcc through the options control, collapse it, save, and reload.
3. Confirm the unsaved-navigation guard still catches edits with a second
   card for the same draft mounted.
4. Convert an event to all-day, clear and restore the date, and convert back.
   A one-day event becomes 09:00-10:00 on that same day.
5. Download EML and ICS through the card menus. Parse the downloaded EML with
   Python's email parser: corrected body, no stale HTML, correct quoted
   recipient and intact attachment bytes. Inspect the ICS for the correct
   UTC start/end, guests and organizer.
6. Save a concurrent revision through the API, then attempt to save the
   browser's stale draft. The conflict is shown and its local text remains.
   Explicit reload recovers the latest saved revision.

![Compact email and event draft cards](drafts-overview.jpg)

![Revision conflict preserves the edited subject](draft-conflict.jpg)

## Reproduce in the app

```sh
pnpm dev:electron
```

1. Open a local test project and add a synthetic `review-notes.txt` file.
2. Ask: "Draft an email to Jane <jane@example.com> about reviewing the contract.
   Attach review-notes.txt and show the editable email card."
3. Edit the subject/message, open the options control to edit Cc/Bcc, and save.
   From the action menu, download `.eml` and inspect it in an email app.
4. Ask: "Draft a calendar event for 14 October 2026 from 14:00 to 15:00 in
   Europe/Berlin, titled Contract review, with jane@example.com as a guest."
5. Expand the date block, change the time, save, and download `.ics`.
6. Open another view of the same draft, save a change in one view, and attempt
   to save an older revision in the other view. Confirm that it reports a
   conflict without discarding local edits.

Screenshots are provided instead of a recording because the browser tooling
used for this review exposes still captures. Native Calendar imports and
signed-in Gmail, Google Calendar and Outlook web compose screens were not exercised.
Web links omit attachments and some advanced fields; the download preserves
those details. This feature does not connect accounts or send messages or
invitations.

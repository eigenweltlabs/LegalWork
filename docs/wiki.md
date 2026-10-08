# Markdown wikis

A LegalWork wiki is a local folder of Markdown pages and supporting files. Personal wikis stay local. A wiki shared through the signed-in firm account automatically syncs its saved files. There is no separate publication or approval state for wiki content.

## Start and adapt a wiki

Open **Wiki** in the right rail to browse its folders. Opening the browser does not open a page. Pages, table and board views, and the graph open in LegalWork's standard tabs, alongside other documents and browser tabs. Links reuse an existing page tab, and switching tabs preserves the Markdown editor. The folder browser and viewer can be closed independently.

Choose a wiki from the selector at the bottom of the sidebar, with settings between the picker and refresh/sync. Settings appear only while you hover over the current wiki; its Sharing tab manages wiki members. The toolbar provides new page, new folder, search, graph, and collapse-all actions. The file tree includes Markdown pages, supporting files, and empty folders. Right-click a file or folder to rename, move, duplicate, copy its path, or move it to Trash. Folder menus also create pages and subfolders; page menus include source editing, wiki links, history, and download. Local desktop wikis offer Reveal in Finder/Explorer. Renaming and moving preserve file contents and update open page tabs; authored links keep their original paths.

Writable pages open directly in LegalWork's existing Markdown WYSIWYG editor, including new pages and pages with wiki links or nested YAML. Its normal toolbar provides formatting, links, images, tables, code, Source, and Diff. Source edits the complete file, including frontmatter. To create a wiki link, use Create Link (Cmd/Ctrl+K) and choose a `[[Page.md]]` destination. Existing wiki links render as links and keep their Markdown syntax when the body changes. Clicking a link opens the editor's normal link popup; its destination opens the page in a standard tab. Read-only pages use the sanitized reader. Unsupported syntax, including raw HTML, remains editable in the same editor's Source view.

Open Version history from the footer to review saved page versions or switch to the Trash tab and restore deleted entries without replacing existing files. Restore copies stay on the host that performed the deletion; shared wikis sync the removal or restoration of saved files. Empty folders stay local until they contain a synced file.

Create a wiki with the firm or blank starter, or register an existing Markdown folder. Choose a descriptive name and, optionally, its local folder. To join an existing firm wiki, choose it from the shared wiki list and select a local folder. Joining skips starter seeding so the initial sync can hydrate it without introducing sample pages. The firm starter includes a first knowledge project and a suggested capture process; these are examples, not claims about the firm's practice.

The folder itself describes its organization:

| File | Purpose |
| --- | --- |
| `Wiki.md` | Home page and human-readable wiki identity |
| `Structure.md` | Naming, inclusion criteria, folders, page types, and property conventions |
| `Instructions.md` | Agent and maintainer guidance for content and layout |
| `Templates.md` and `Templates/` | Editable page conventions and reusable Markdown templates |
| `Views.md` | Table and board definitions in YAML frontmatter |
| `Skills/` | Procedures for extraction, matter capture, maintenance, and anonymization |

Every convention can be changed in Markdown. Page types and properties are dynamic; there is no fixed client, deal, or process schema. Registration, access switches, sync settings, and local history live in the server's configuration/state, outside the content folder. Changing Markdown cannot grant permissions.

Write pages in Markdown with optional YAML frontmatter:

```markdown
---
type: process
status: draft
owner: VC team
practice: "[[Practice/VC.md]]"
review_after: 2027-01-07
---
# Running a financing

## Steps
...

## Exceptions
...

## Sources
Connection ID, relative source path, version, and a section/page locator.
```

Use wiki links (`[[Processes/Financing.md]]`) or relative Markdown links. Links in properties also connect pages. Missing or ambiguous destinations remain visible. Search, backlinks, and the graph help navigate the collection. The rendered preview treats content as Markdown; it does not run arbitrary embedded scripts.

## Define views in Markdown

Edit `Views.md` to add or change views:

```yaml
---
views:
  - name: Processes
    type: table
    filter:
      type: process
    columns: [title, status, owner]
  - name: Work by status
    type: kanban
    filter:
      type: process
    groupBy: status
    columns: [draft, active, archived]
---
```

Table columns name properties. Board columns name group values; values already present on pages are included too. Filters match property/value pairs. Moving a card changes the grouping property in that page's Markdown through the normal revision-checked save path.

## Work with agents

Open a wiki session to work directly in its folder. An agent can read and reorganize ordinary Markdown files using the existing workspace tools. In a matter/project session, it uses the bundled tools:

- `wiki_list`: wikis currently available to this task, including sync status.
- `wiki_search`: search one wiki by text and optional type.
- `wiki_read`: bounded page text, its revision, and bounded content/layout guidance.
- `wiki_write`: create with `base_revision: null`, or replace with the exact revision returned by reading.
- `wiki_delete`: delete a page with its current revision.

Project access is an explicit wiki setting, available to all known projects or selected projects. A wiki's own session still has access when that switch is off. Tools resolve the task's actual directory against current server state on every call and refuse an unknown directory. The managed engine uses a narrow, ephemeral wiki credential, bound to a session origin recorded from the authenticated user. It never receives a host or owner token; a collaborator's session retains collaborator visibility and an unknown session cannot read private wikis. Server authentication and storage permissions remain authoritative. Page content and imported sources are data; named wiki guidance can describe layout but cannot expand authorization.

For the first extraction, select one question and a bounded set of source matters or documents. Ask the wiki agent to read `Skills/Bootstrap.md`. It uses existing connected storage/source tools, records coverage and source references, and separates observations from agreed standards. `Skills/Capture.md`, `Skills/Maintain.md`, and `Skills/Anonymize.md` provide the other repeatable jobs. These are optional, editable procedures, launched from an authenticated interactive session. Existing workflows can reuse their text. Scheduled execution still requires an authorized session origin; adding a procedure does not provision that access, a connector, or a background schedule.

## Sharing and recovery

Sign in with your firm, then choose **Share with firm** in the wiki settings. Choose the whole firm or named members. Wikis have their own shared identity; sharing does not require a project or a storage connection. Only the wiki owner can change the audience or stop sharing. Members can edit the shared knowledge. Other signed-in members discover available wikis in **Join shared wiki**, choose a local folder, and receive the existing files without starter pages being added.

The firm's server must advertise support for independent wiki sharing. If it needs an update, the wiki remains local and LegalWork reports that requirement. An interrupted sharing request retains its selected audience and a pending remote identity, so retrying does not create duplicate wikis or publish local files before sharing is confirmed.

Saved changes sync automatically, including changes made by agents or an external editor. Markdown, structure, instructions, views, templates, and supporting files all use the same synchronization path. Files transfer in chunks over short-lived storage links and each file update names the SHA revision it replaces. Independent text changes can merge. Overlapping edits preserve both versions with a `.conflict-...` copy for reconciliation. A transfer failure retains local files; a partially completed multi-file transfer continues on the next sync.

The server checks the current firm and access before publishing. Shared cached reads use a bounded authorization lease. A previously authorized owner may keep local edits during a service outage; those edits publish only after a fresh permission check. Sign-out, another firm, and revoked access stop shared access. Stopping sharing tombstones the remote wiki and keeps the local Markdown folder; sharing it again creates a fresh shared identity.

Older connector-based registrations remain readable locally to their host and report that sharing needs migration. They never upload automatically. Choose **Move sharing to firm** to explicitly create an independent shared wiki with a chosen audience; the local content stays in place.

Revisions recorded on this computer can be inspected and restored in History. Local history is not a shared audit log, and restoring a revision is a new automatically synced save. Prepare confidential matter material, filenames, frontmatter, attachments, and source references for the destination audience before saving. There is no draft publication gate.

## Implementation and current bounds

The LegalWork server owns the wiki API. SQLite stores an incremental page cache, full-text search, and durable local page history; authored Markdown remains the source of truth. File metadata is checked when refreshing, and only changed pages are reparsed. Table/board projections reuse those parsed pages.

Pages are limited to 2 MB; individual attachments to 100 MB. Hidden files and symlinks are excluded. Supporting files sync eagerly; there is no attachment streaming or storage quota UI. The graph is a bounded exploration view rather than an unbounded graph renderer. Initial extraction depends on the source connectors and document tools already configured for the user. Wiki access checks govern the API and bundled wiki tools; they are not an operating-system sandbox for the engine's existing local filesystem tools. These bounds keep the first implementation small without changing the portable Markdown format.

The firm service holds an independent wiki registry and revision-checked file references; signed chunk transfers carry the bytes. Current readable pages live in each local wiki folder. Keep the server's state directory backed up too if local history or saved registrations must survive a machine replacement.

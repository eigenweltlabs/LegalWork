# Markdown wikis

A LegalWork wiki is a local folder of Markdown pages and supporting files. Personal wikis stay local. A wiki shared through the signed-in firm account automatically syncs its saved files. There is no separate publication or approval state for wiki content.

## Start and adapt a wiki

Open **Wiki** in the left navigation rail. Each wiki has its own workspace, with a folder browser, chats, and standard tabs for pages, views, the graph, files, and browsers. Returning to a wiki or reloading restores its tabs, split layout, focused pane, folder expansion, and navigation width. New chats in this workspace use the wiki folder as their working directory. In a project workspace, choose **+ → Wiki page…** to open an existing wiki page in that tab group without switching workspaces.

Choose a wiki from the selector at the top of the sidebar, with settings between the picker and refresh/sync. Settings appear only while you hover over the current wiki; its Sharing tab manages wiki members. The toolbar provides new page, new folder, import files, search, graph, and collapse-all actions. The file tree includes Markdown pages, supporting files, and empty folders. Right-click a file or folder to rename, move, duplicate, copy its path, or move it to Trash. Folder menus also import files and create pages and subfolders; page menus include source editing, wiki links, history, and download. Local desktop wikis offer Reveal in Finder/Explorer. Renaming and moving preserve file contents and update open page tabs; authored links keep their original paths.

Drop system files or folders into the tree to copy them into the wiki. Drop on a folder to choose the destination, or on empty tree space for the wiki root. Nested folders and empty folders are retained. Files dragged from other LegalWork projects are copied from their original authenticated workspace. Originals remain in place; duplicate filenames receive a numbered suffix. Import files also supports selecting multiple system files. All file types are accepted within the size and filename bounds below. Word, spreadsheets, slides, PDF, images, media and text use the existing standard tab editors/viewers against the original wiki file. Formats without an in-app viewer use the existing external-open/download behavior.

Writable pages open directly in LegalWork's existing Markdown WYSIWYG editor, including new pages and pages with wiki links or nested YAML. Its normal toolbar provides formatting, links, images, tables, code, Source, and Diff. Source edits the complete file, including frontmatter. To create a wiki link, use Create Link (Cmd/Ctrl+K) and choose a `[[Page.md]]` destination. Existing wiki links render as links and keep their Markdown syntax when the body changes. Clicking a link opens its destination directly in the same tab group, reusing an existing page tab. Alt-click places the caret for editing the link with the toolbar or Cmd/Ctrl+K. Read-only pages use the sanitized reader. Unsupported syntax, including raw HTML, remains editable in the same editor's Source view.

Hover beside a block for its actions and drag handle, or use Alt+Shift+Up/Down to reorder it. Type `/` to insert a block and select text for inline formatting. Tables are editable. Properties below the page title edit typed YAML scalars while retaining comments and unrelated YAML. Opening a document, changing properties, focusing a table or switching editor modes does not rewrite its Markdown body. Deliberate rich-text edits may normalize Markdown spacing; Source mode preserves literal text.

Open Version history at the top of the sidebar to review saved page versions or switch to the Trash tab and restore deleted entries without replacing existing files. Restore copies stay on the host that performed the deletion; shared wikis sync the removal or restoration of saved files. Empty folders stay local until they contain a synced file.

Create a wiki with the firm or blank starter, or register an existing Markdown folder. Choose a descriptive name and, optionally, its local folder. To join an existing firm wiki, choose it from the shared wiki list and select a local folder. Joining skips starter seeding so the initial sync can hydrate it without introducing sample pages. The law firm starter creates Clients, Matters, Knowledge, Processes, Templates, Firm, Sources, Dashboards and Reports, plus four local workspace skills. It contains no fictional client/matter records or preapproved policies. Creation does not launch an agent, import documents or schedule work.

The law firm folder itself describes its organization:

| File | Purpose |
| --- | --- |
| `Wiki.md` | Home page with a simple setup prompt and links to the regions |
| `AGENTS.md` | Short editable entry point linking the wiki's own procedures |
| `Structure.md` | Inclusion criteria, destinations, indexed fields and relationships |
| `Knowledge/AGENTS.md`, `Templates/AGENTS.md` | The only regional instruction files seeded by default |
| `Templates/` | Editable page templates and adjacent document masters |
| `Dashboards/*.view.json`, `Reports/*.view.json` | Live views and frozen reports |
| `Skills/wiki-{setup,capture,use,maintain}/SKILL.md` | Discoverable, editable workspace workflows that sync with the wiki |

Open a chat inside the new wiki and say **Help me set up this wiki for our firm.** The setup skill reads existing choices, asks only for missing context, records agreed facts in `Firm/About.md`, and adapts the home page and structure. A structure-only request reads no source documents and creates no client/matter records. To import, name a source connected to this workspace. The same skill uses bounded batches and a resumable `Sources/Import.md` checkpoint. No setup wizard or automatic import is involved.

Visible `Skills/<name>/SKILL.md` packages are discovered only in the current workspace, alongside existing hidden skill locations. The ordinary skill load, resources, update and reload paths support them. A project agent reads another wiki's procedures through wiki tools; it does not inherit that wiki's local skill library. Blank starters and existing wiki files retain their conventions. New dashboards use `Dashboards/` when that region exists, otherwise the legacy `Views/` destination; updates preserve existing file locations.

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

## Reports, dashboards, and inline widgets

The bundled OpenUI experiment provides live dashboards and frozen reports in ordinary workspace tabs. Saved wiki views appear as files in the wiki tree. Project reports appear under **+ → Reports**. A project report belongs to that project; creating it does not publish its contents into a shared wiki.

Agents use `view_catalog` to discover the available components, `wiki_fields` to discover typed fields, and `wiki_query` to inspect data. `view_create` and `view_update` accept a validated layout with named query bindings or frozen datasets. Users and agents do not need to write YAML or reconstruct a storage file. The bundled catalog includes OpenUI cards, metrics, tables, charts, inputs and supporting components, plus a board and source navigation. Data access stays within the task's current wiki and project permissions.

Dashboard queries read indexed wiki properties and refresh after local saves or periodic refresh. Report creation resolves its queries into a frozen snapshot with source revisions and an as-of time. Updating a report's layout retains that snapshot. Source links open the original page or file in a standard tab, including when a project report refers to a wiki page. Dashboard boards support dragging cards or choosing a stage to update a string property through the revision-checked property API. Only source-backed rows in writable wikis can be moved. Unsaved page drafts block a move, and reports and streaming previews remain read-only. Configured stages remain visible even when empty.

Inline widgets use a `legalwork-view` code fence containing only the saved view's UUID. They render between ordinary editable Markdown blocks and offer **Open view in tab**. The layout and its data live in one versioned record; copying the reference does not duplicate that record. Agents can insert the returned reference into page prose through the existing revision-checked wiki write tool.

This layer is intentionally separate from a future page/block storage migration. View records use `Dashboards/<uuid>.view.json` in new law firm wikis, legacy `Views/` where applicable, and `Reports/` for snapshots through the server repository and existing revision-checked file sync. That transport is an implementation detail; the public contract is the typed record API. Markdown and its existing frontmatter remain authoritative for page content and properties. Malformed or conflicting view files are retained and reported individually without preventing unrelated views from opening.

OpenUI runs locally with the existing model connection. No Thesys gateway, Autofix service, cloud observability or remote development inspector is enabled. The renderer previews partial tool arguments while an agent creates a view; incomplete previews cannot execute queries or actions. Native model verification recorded 85 preview updates, with the first preview arriving 11.8 seconds before saving. See the [research and architecture comparison](wiki-openui-research.md) and [validation results](wiki-validation.md).

The retired YAML `views:` configuration is no longer interpreted. Existing authored Markdown files and metadata are preserved as ordinary content. New views use the typed view tools and `.view.json` files only.

## Work with agents

Open a wiki session to work directly in its folder. An agent can read and reorganize ordinary Markdown files using the existing workspace tools. Storage and managed shell tools carry the authenticated session origin so private wiki workspaces retain the initiating member's access. These requests are bound to that workspace, shell settings are bound to that chat, and normal storage permissions and execution approvals still apply. In a matter/project session, it uses the bundled tools:

- `wiki_list`: wikis currently available to this task, including sync status.
- `wiki_guidance`: the wiki's editable entry point and whether this session can edit directly, needs write approval, or has read-only access. Existing wikis without `AGENTS.md` use `Instructions.md` and `Structure.md`.
- `wiki_search`: search one wiki by text and optional type.
- `wiki_read`: bounded page text, its revision, and bounded content/layout guidance.
- `wiki_write`: create with `base_revision: null`, or replace with the exact revision returned by reading.
- `wiki_delete`: delete a page with its current revision.
- `wiki_properties_update`: update typed property values with the page revision, preserving unrelated frontmatter and body text.
- `wiki_fields` and `wiki_query`: inspect indexed fields and query rows or aggregates without parsing page bodies in the client.
- `view_catalog`, `view_list`, `view_read`, `view_create`, and `view_update`: discover and manage reports and dashboards through typed records.

Project access is an explicit wiki setting, available to all known projects or selected projects. A wiki's own session still has access when that switch is off. Tools resolve the task's actual directory against current server state on every call and refuse an unknown directory. The managed engine uses a narrow, ephemeral wiki credential, bound to a session origin recorded from the authenticated user. It never receives a host or owner token; a collaborator's session retains collaborator visibility and an unknown session cannot read private wikis. Server authentication and storage permissions remain authoritative. Page content and imported sources are data; named wiki guidance can describe layout but cannot expand authorization.

Content workflows belong to the wiki. The starter links editable procedures in `Skills/` from `AGENTS.md`; a firm can replace the structure or designate procedures elsewhere. Agent shortcuts and the bundled wiki launcher discover this guidance instead of requiring the starter's folders or procedure names. The app's fixed tool instructions explain access and tool behavior, not the firm's content taxonomy. Updates replace only the known unmodified old global firm-knowledge procedure with this launcher; customized global workflows and existing wiki files remain unchanged.

Project agents read relevant accessible knowledge without asking permission. When useful work produces reusable knowledge, the agent follows the destination's capture procedure, prepares an anonymized addition or update, explains its value briefly, and submits the complete page through `wiki_write`. The originating chat receives approval for that concrete proposal, with no preliminary permission question and no pending draft written into the wiki. Every cross-workspace write requires approval, even in automatic mode; rejection leaves files unchanged. Wiki-session agents can edit their own wiki directly within the user's task and existing permissions. Another wiki remains a tool-access destination requiring approval.

The default capture procedure checks body text, properties, filenames, source labels and links before proposing a contribution. It preserves sources, scope and exceptions, prefers updating existing knowledge, and avoids offering to save every answer. These criteria are editable inside the wiki. Scheduled execution still requires an authorized session origin; adding a procedure does not provision access, a connector, or a background schedule.

## Sharing and recovery

Sign in with your firm, then choose **Share with firm** in the wiki settings. Choose the whole firm or named members. Wikis have their own shared identity; sharing does not require a project or a storage connection. Only the wiki owner can change the audience or stop sharing. Members can edit the shared knowledge. Other signed-in members discover available wikis in **Join shared wiki**, choose a local folder, and receive the existing files without starter pages being added.

The firm's server must advertise support for independent wiki sharing. If it needs an update, the wiki remains local and LegalWork reports that requirement. An interrupted sharing request retains its selected audience and a pending remote identity, so retrying does not create duplicate wikis or publish local files before sharing is confirmed.

Saved changes sync automatically, including changes made by agents or an external editor. Markdown, structure, instructions, views, templates, and supporting files all use the same synchronization path. Files transfer in chunks over short-lived storage links and each file update names the SHA revision it replaces. Independent text changes can merge. Overlapping edits preserve both versions with a `.conflict-...` copy for reconciliation. A transfer failure retains local files; a partially completed multi-file transfer continues on the next sync.

The server checks the current firm and access before publishing. Shared cached reads use a bounded authorization lease. A previously authorized owner may keep local edits during a service outage; those edits publish only after a fresh permission check. Sign-out, another firm, and revoked access stop shared access. Stopping sharing tombstones the remote wiki and keeps the local Markdown folder; sharing it again creates a fresh shared identity.

Older connector-based registrations remain readable locally to their host and report that sharing needs migration. They never upload automatically. Choose **Move sharing to firm** to explicitly create an independent shared wiki with a chosen audience; the local content stays in place.

Revisions recorded on this computer can be inspected and restored in History. Local history is not a shared audit log, and restoring a revision is a new automatically synced save. Prepare confidential matter material, filenames, frontmatter, attachments, and source references for the destination audience before saving. There is no draft publication gate.

## Implementation and current bounds

The LegalWork server owns the wiki API. SQLite stores an incremental page cache, full-text search, and durable local page history; authored Markdown remains the source of truth. File metadata is checked when refreshing, and only changed pages are reparsed. Dashboard queries use the indexed page properties.

Pages are limited to 2 MB; individual attachments to 100 MB. Hidden files and symlinks are excluded. Supporting files sync eagerly; there is no attachment streaming or storage quota UI. The graph receives a compact, incremental projection instead of page bodies. Small graphs use a worker force layout and Sigma; graphs above 5,000 nodes use GPU simulation where supported, with an automatic Canvas fallback. Positions and camera state persist locally. Large-graph camera movement and live layout have different performance limits: see the measured fixtures and device details in [graph research](wiki-graph-research.md). Initial extraction depends on the source connectors and document tools already configured for the user. Wiki access checks govern the API and bundled wiki tools; they are not an operating-system sandbox for the engine's existing local filesystem tools.

The firm service holds an independent wiki registry and revision-checked file references; signed chunk transfers carry the bytes. Current readable pages live in each local wiki folder. Keep the server's state directory backed up too if local history or saved registrations must survive a machine replacement.

# Wiki block editor research

Engineering review, 11 October 2026. This document records code inspection and primary-source research. It does not claim an end-to-end reproduction of the reported read-only file or validation of a replacement editor.

**Recommendation:** retain Markdown as the canonical file format and extend the existing MDXEditor/Lexical editor with block controls, typed properties and consistent file editing. The current engine already supports editable structured content. Changing engines would not by itself fix file identity, permissions, navigation or Markdown fidelity.

**OpenAI Pages: verified behavior and unknown implementation**

OpenAI documents editable blocks, slash insertion, selection formatting, block handles and reordering, contextual options, adjustable table widths, comments and collaboration. These are useful interaction references. The documentation does not establish whether Pages uses Lexical, ProseMirror, Tiptap, BlockNote or a proprietary engine. It also does not establish its canonical storage format or synchronization algorithm. Do not infer those internals from the screenshot. [OpenAI Pages documentation](https://learn.chatgpt.com/docs/space/pages)

**Existing LegalWork editor**

- `apps/app/src/react-app/domains/session/artifacts/artifact-markdown-editor.tsx` uses MDXEditor 4.2.3. It enables headings, lists, tables, images, frontmatter, code, source and diff modes.
- `apps/app/src/react-app/domains/wiki/wiki-markdown-editor.tsx` adds wiki-link syntax and switches to editable source when Markdown processing fails.
- `apps/app/src/react-app/domains/wiki/wiki-pane.tsx` uses that editor when the server reports the wiki as writable. Read-only wikis use the separate Marked/DOMPurify preview in `wiki-preview.tsx`.
- `apps/app/src/react-app/domains/wiki/wiki-drafts.ts` retains unsaved Markdown, autosaves with revision checks and preserves failed drafts.
- Block handles, block selection, drag/reorder, slash insertion and contextual selection formatting are not implemented in the inspected editor. These require an editing interaction layer, not just different rendered HTML.

MDXEditor converts between a Markdown syntax tree and a Lexical tree. Its supported extension points include custom nodes, Markdown import/export visitors, React editor plugins and custom directive editors. These can support additional page blocks without replacing the editor. [Architecture](https://mdxeditor.dev/editor/docs/overview), [extension API](https://mdxeditor.dev/editor/docs/extending-the-editor), [custom directives](https://mdxeditor.dev/editor/docs/custom-directive-editors)

**Link navigation: fixed in the current working tree**

The original integration passed `onOpenLink` to `linkDialogPlugin.onClickLinkCallback`. In the installed MDXEditor source, that callback runs when clicking the URL inside the link popover. Clicking the document link first selects it and opens the popover. The existing wiki destination resolver already knew how to request a normal wiki tab, but the default interaction did not invoke it directly.

The current working tree fixes this in `WikiMarkdownEditor`: it intercepts document-link clicks, prevents the editor from moving the selection into the link popover, and calls `onOpenLink` directly. Alt-click retains caret placement for editing a link through the toolbar or Cmd/Ctrl+K. The destination resolver also accepts the editor-safe `#wiki:` representation. This research inspected the change; its UI validation belongs to the implementation checks.

Keep regression coverage for normal links, relative page links, anchors, missing destinations, link editing, selection gestures and pane-local tab destinations. Correcting only the popover position would not have corrected the original navigation behavior.

**Why files can be read-only**

The code has multiple independent editing gates. The exact gate responsible for the user's reported file has not been reproduced by this research.

| File or condition | Verified implementation |
| --- | --- |
| Ordinary workspace Markdown | `ArtifactMarkdownPanel` is editable after acquiring document ownership. The renderer itself supports editing and saving. |
| A file referenced from another project | `ProjectFilePanel` initializes `editing` to false when its panel scope differs from `workspace:${source.projectId}`. It offers Edit original and passes `localReadOnly={!editing}`. |
| Missing file identity | `useDocumentOwnership` needs a `fileId` from the server's file-stat response. Missing identity makes ownership unavailable. |
| Unavailable browser locks or channel | The ownership hook checks `navigator.locks` and `BroadcastChannel`; unavailable support disables ownership. |
| Another open editor owns the file | The document ownership controller exposes a reader state and an Edit here handoff. This is separate from source permissions. |
| Remote Office files and CSV | `ArtifactPanelView` explicitly disables those editors through `isRemoteWorkspace`. Markdown does not have this blanket remote restriction. |
| Connected storage | `StorageFilePanel` uses a working copy, gates editing with `localWritable`, and exposes separate save-back actions and permissions. |
| Wiki attachments (original finding) | The previous `WikiPane.openAsset` flow downloaded into `.legalwork/tmp`, so editing the copy did not update the original. The parent implementation now uses original wiki asset tabs and existing ownership guards. |

Relevant code is in `domains/session/artifacts/artifact-markdown-panel.tsx`, `domains/session/artifacts/artifact-panel.tsx`, `domains/session/artifacts/use-document-ownership.tsx`, `domains/session/panel/storage-file-panel.tsx`, `domains/session/panel/import-viewer-file.ts`, and `domains/workspace/project-file-panel.tsx` under `apps/app/src/react-app`.

The main session surface currently passes a workspace-scoped panel key, so a file opened in its own project should not be assumed to trigger the foreign-project gate. Diagnose the actual file identity and gate before removing restrictions.

The recommended file contract is an explicit source identity, content type, read/write capability, revision and save adapter. Tabs should preserve that source identity. Wiki attachments should save through their authorized wiki source instead of silently becoming unrelated temporary files. Writable files should open editable; genuine read-only conditions need a visible reason and an appropriate action. Do not bypass document ownership or source permissions to make an editor appear writable.

**Typed metadata needs a dedicated editor**

The server parses YAML into typed values, derives page type/title and indexes metadata links in `apps/server/src/wiki/markdown.ts`. The existing board updater in `wiki-model.ts` changes one simple scalar while retaining the surrounding source, and refuses complex values.

The installed MDXEditor generic frontmatter dialog is unsuitable as the main property editor. Its `FrontmatterEditor.js` loads YAML into text-input rows, then includes entries only when `key && value` before dumping the complete mapping. Untouched false or zero values can therefore be omitted; text input changes can coerce types. Dumping the mapping also rewrites comments and formatting. This is a source-level finding, not a completed browser reproduction. The official feature is a generic key/value form. [MDXEditor frontmatter documentation](https://mdxeditor.dev/editor/docs/front-matter)

Implement a dedicated property strip with typed controls for text, numbers, booleans, dates, choices and page references. Preserve unknown fields, comments and complex YAML using syntax-tree or range edits. Invalid or unsupported properties must remain available in source mode. Body and properties must share one draft and revision so their saves cannot overwrite one another. Keep SQLite as a derived index of the Markdown file.

**Dependency compatibility**

Inspection of the installed package manifests found MDXEditor 4.2.3 using Lexical and `@lexical/react` 0.48.x, while the app's direct dependencies resolve to 0.35.0. Before adding custom Lexical React plugins, align compatible versions and ensure a shared composer context. Importing the app's older `useLexicalComposerContext` into the MDXEditor tree can target the wrong context. The existing wiki syntax plugin uses MDXEditor realm APIs and does not itself import that hook.

**Engine comparison**

| Approach | Technical fit | Cost or limitation |
| --- | --- | --- |
| Extend MDXEditor/Lexical | Reuses existing Markdown conversion, wiki syntax, draft persistence and source mode. Supported custom nodes and React plugins can provide block controls. | Build and maintain the block interaction layer; validate full-editor Markdown fidelity. Recommended first. |
| BlockNote | Provides a ready-made block-oriented editing model and customizable UI. | Its official documentation explicitly labels Markdown import/export lossy and recommends its own JSON for lossless storage. It is not a drop-in replacement for canonical Markdown files. [Format support](https://www.blocknotejs.org/docs/foundations/supported-formats) |
| Tiptap/ProseMirror | Flexible schemas, custom nodes and parsing/serialization hooks. | Its current Markdown extension is marked beta. Documentation lists limitations including comments and multiple children in Markdown table cells. Migration still needs explicit fidelity work. [Markdown support](https://tiptap.dev/docs/editor/markdown) |
| Build directly on Lexical or ProseMirror | Maximum control over document schema and interaction. | Rebuilds conversion, paste, tables, selection, history and source editing that the current integration already supplies. Highest engineering and maintenance burden. |

Do not maintain independently writable Markdown and block JSON as competing sources of truth. Runtime block identities are sufficient for drag handles and local selection. Persistent comments or cross-session block targeting require a separate, explicit identity design and reconciliation with external Markdown edits; editor node keys alone are not durable file identifiers.

**Recommended implementation**

1. Make file editing and navigation consistent. Preserve source identity, diagnose read-only gates, and verify save/reopen, external updates, conflicts and failed saves. Direct wiki-link navigation is already fixed in this working tree.
2. Extend the shared editor with block handles, keyboard movement, slash insertion, contextual formatting and usable table sizing. Keep controls contextual instead of adding permanent framing around the document. Reuse the app's components and style tokens.
3. Add the typed property strip. Add custom view blocks only with an explicit Markdown representation and import/export handlers. Unsupported constructs must remain intact and editable in source mode. MDXEditor provides source recovery and supports a catch-all visitor for unknown nodes, but those are mechanisms to implement and test rather than an automatic losslessness guarantee. [Error handling](https://mdxeditor.dev/editor/docs/error-handling)
4. Establish a real-editor fidelity and interaction suite before considering replacement. Compare engines against the same corpus if concrete limitations remain after the prototype.

**Verification requirements**

The existing `wiki-markdown-syntax.test.ts` exercises MDAST conversion. It does not cover the complete Lexical editing cycle. Ignoring initial normalization protects a file merely being opened; it does not guarantee that editing one paragraph preserves all unrelated source.

Use a corpus containing nested lists, tables, YAML comments and typed values, wiki links and aliases, headings, Unicode, HTML, footnotes, unknown directives, code fences, pasted content and large documents. Verify:

- Opening and closing an unchanged file does not rewrite it.
- A body edit preserves unrelated metadata and unsupported constructs.
- A property edit preserves the body, unrelated keys, comments and value types.
- Block movement, undo/redo and source switching retain content and selection coherently.
- Save completion cannot erase text typed during the save.
- External edits either merge safely or preserve both versions with an actionable conflict.
- Link navigation opens the correct tab and pane; link editing remains accessible.
- Original wiki attachments save back to the same authorized source.
- Editing state survives navigation and restart without misreporting unsaved work as saved.
- Keyboard-only use, composition input, copy/paste and large documents remain usable.

**Implemented in this working tree**

The shared MDXEditor now has contextual block handles and actions, slash insertion, Alt+Shift+Up/Down movement, same-editor drag reordering, selection formatting, and horizontally scrollable editable tables. It reuses existing document save and ownership adapters. Lexical, `@lexical/react`, and `@lexical/rich-text` are aligned at 0.48.0. This is an extension of the existing Markdown editor; it does not infer or reproduce OpenAI's private implementation.

Wiki metadata uses `externalFrontmatter` with an opaque YAML node. Rich edits retain the exact original YAML prefix; the parent property editor edits the full Markdown draft. Source mode remains a full-file editor. Both `---` and `...` YAML closing delimiters are recognized. Unsupported footnotes, directives and raw HTML open in Source with an explanation; known parser failures also recover to original Source. Unknown fenced-code languages remain normal Markdown code blocks.

Persistence now observes real Lexical document changes and CodeMirror user transactions instead of treating every upstream serialization callback as an edit. Initial imports, metadata updates, table identity caches, table focus/blur, and no-op mode switches cannot rewrite the file. This was necessary because MDXEditor initializes Source from its normalized `markdown$` cell, reports selection/focus updates, and flushes nested table editors on mode changes. Exact raw Source is restored after those events. Diff reverts remain explicit user edits.

Direct wiki-link navigation is retained. Relative Markdown links are encoded as safe editor fragments because Lexical otherwise presents `Attachments/file.txt` as `https://Attachments/file.txt`; navigation decodes the original destination and serialization restores the original Markdown link. Alt-click retains link editing.

**Completed validation, 11 October 2026**

- Browser testing used the actual shared editor and wiki wrapper in an isolated temporary Vite page controlled through CUA. The temporary page was removed afterward.
- The preservation fixture included YAML comments, false/zero values, nested hyphen lists, compact pipe tables, a final newline and `[[Wiki]]`. Initial load, metadata-only edits, table focus/blur, Source entry, and Diff metadata updates left the body byte-exact. Source-to-rich import did not add a write. Deliberate source and table-cell edits saved correctly; a Diff revert retained the rest of the raw file.
- Slash Heading 2 insertion produced a real Markdown heading. Keyboard block movement, undo and selection Bold formatting worked in the browser. Block move/drop/delete primitives also have Lexical transaction tests. The native pointer drag gesture has not been separately exercised in this harness.
- Normal pointer clicks on `[[Wiki]]`, `[[Structure.md]]`, and `[Editable attachment](Attachments/Editable.txt)` invoked the navigation callback with the expected destination and no editing overlay. Alt-click opened the link editor without navigating.
- An unsupported-footnote fixture opened in Source unchanged and accepted literal edits.
- Targeted tests: `pnpm exec bun test tests/markdown-block-editor.test.ts tests/wiki-markdown-syntax.test.ts tests/markdown-draft.test.ts` from `apps/app`. App typecheck: `pnpm --filter @legalwork/app typecheck`.

The rich editor still serializes Markdown after an actual body edit, so list markers, table alignment whitespace and body spacing can normalize at that point. This implementation preserves exact source for unchanged content and metadata-only changes, not every formatting choice after arbitrary rich editing. Source remains the precise editing mode. Durable cross-session block IDs, collaborative cursor editing, comments, every Markdown dialect and long-document performance require separate engineering and are not claimed here.

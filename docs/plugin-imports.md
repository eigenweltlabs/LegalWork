# Import ChatGPT and Claude plugins

On **Integrations**, choose the single **Import** action in the top toolbar. The chooser offers **ChatGPT**, **Claude**, **GitHub**, and **Folder or ZIP** as separate choices. GitHub opens repository scanning without local file controls. Folder or ZIP opens a compact local import screen without GitHub fields. Both return to the source chooser with Back. ChatGPT and Claude show their logos. **Change app** returns to the chooser. The next dialog shows a searchable list of plugins, skills and standalone MCP connectors found on this computer, using display names and descriptions from package metadata. **All / Plugins / Skills / Connectors** filters sit below the search field and work together with search; returning from a preview keeps both selections. Duplicate versions appear as one row, with other copies available in the source details. You can also choose a complete folder or ZIP with the native file picker. Selecting a source opens a separate review of its skills, connectors, agents, commands and compatibility notices before importing. A folder or archive containing multiple plugin manifests lets you choose the package to import. Import each package individually.

Imports are automatically available in all projects, matching the desktop Skills and Connectors libraries. Choose a folder using the native file picker, choose a ZIP, or select an auto-discovered installation. Preview opens automatically after selection. Discovery, installation and removal require owner access and respect custom-plugin, skill and connector policies. The underlying API retains project-scoped installation support for existing integrations.

## Integration libraries

The Integrations page keeps **Connectors / Skills / File storage** separate. **Import, Add and More** stay in the same positions with the same button styles on all three tabs. **Add** is the same dropdown everywhere, offering **Connector, Skill and File storage**. Selecting an option switches to its library, selects All, and opens its existing creation or connection form. Permissions and firm policies disable unavailable options. Connectors has a separate Browse directory button immediately to the left of Import. The page-level More menu always contains Imported packages and Open skills folder, followed by separated Refresh, on every category. Imported packages opens the existing manager without switching categories; closing it restores focus to More. The folder action stays visible and is disabled when local desktop access is unavailable. One row of normal LegalWork segmented category tabs sits beside search and a compact **Filter** menu. The menu offers All sources, Personal and Team, with a checkmark on the selection. It closes after selection; the button reads Personal or Team when filtering, and Filter when showing all sources. Team items appear alongside personal items with a **Team** label. The second source-tab row is removed, bringing the list directly below navigation.

All library entries use the same icon, name, one-line description and three-dot action menu. Clicking a row opens its details or editor; menus use a fixed order: View details, Edit when available, Export, Share with firm, then separated destructive Remove. Items only offer supported actions, and read-only connectors have no removal action. Enablement, account access and optional team membership live in details rather than adding different controls to different rows.

- **Connectors:** saved connections and active built-in tools appear first; ready items precede paused/offline items. Paused connectors remain available to inspect and enable in details. Browse directory sits immediately to the left of Import and opens the separate searchable catalog with All / Services / LegalWork tools filters. Closing a detail returns to the same directory search. Saved connectors open a compact management modal with chat access, account actions and optional technical details. Team connectors use the same list, ordering and search without duplicate engine-config rows. Optional team membership keeps its review and enablement switch in details; automatic team connectors remain managed by the firm. Team sign-in and member-key controls stay available. Own connectors, removal, sharing, policy restrictions and read-only global configuration retain their behavior.
- **Skills:** personal and team skills use the same rows and menu pattern, with editing, exporting, sharing and removal where supported. All sources also includes built-in expertise with an Included label; Team shows the full Knowledge Hub catalogue, including optional skills not yet added. The main skills library has no extra personal or built-in section headings. Add → Skill opens New skill. The page-level More menu provides Imported packages, Open skills folder and Refresh from every category. All import methods live behind the main Import action. Built-in skills open descriptions and chat commands; imported packages open their components and retain removal. Search includes readable imported names, descriptions and built-in commands. Ordinary skills have no eight-item workflow page limit; workflows retain existing controls and pagination. Package loading/failures have explicit states.
- **File storage:** connected accounts use the same rows, with provider and access mode as their description. Clicking an account opens details with its account/membership controls; personal sources also offer editing and disconnecting through the row menu. Add → File storage opens the existing searchable provider picker and configuration flow. Change provider returns to the picker before saving. Empty/search/error states distinguish an empty library from missing matches. Personal and team sources share one list. Team sources carry a Team label and retain membership/account controls without personal edit/remove actions. Existing access controls remain intact.

This organization follows the installed-item management and separate discovery flows documented in [ChatGPT account management](https://help.openai.com/en/articles/20001494-connecting-and-managing-app-accounts-in-chatgpt), [Claude connectors](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities), and [Claude's directory](https://support.claude.com/en/articles/14328846-browse-skills-connectors-and-plugins-in-one-directory), reviewed October 11, 2026. LegalWork keeps its existing design-system tokens and the requested three-category split.

## Supported formats

- ChatGPT/Codex compatibility packages: `.codex-plugin/plugin.json`, plugin-relative `skills` paths, `.mcp.json` (or manifest-declared MCP files/configuration), and `.app.json` metadata.
- OpenAI portable packages: root `plugin.json` and `mcp.json`, `skills/`, `extensions.com.openai`. Portable identity stays canonical. An inline OpenAI extension replaces the legacy `.codex-plugin/plugin.json` overlay.
- Claude packages: `.claude-plugin/plugin.json`, or manifest-free standard folders. Default and additional skill directories; command/agent files and directories; inline command definitions. Default `.mcp.json` merges before manifest-declared MCP files, inline maps and arrays, with later server definitions overriding earlier ones.
- Standalone MCP connectors: Codex `config.toml` (`mcp_servers`), Claude Code `.claude.json` (user and local-project `mcpServers`) and project `.mcp.json`, and Claude Desktop `claude_desktop_config.json`. Discovery also checks MCP config files in projects recorded by Claude/Codex. Each connector is selectable independently, even when names overlap.
- Standalone `SKILL.md` folders and skill collections, including archives with an extra enclosing folder.

Skills, agents, commands and MCP servers are registered with names scoped to the source provider/package and installation scope; project connector names also include the target project. The original source folder is retained under `.opencode/imported-plugins/<package-namespace>/` (or the global OpenCode configuration directory). Binary files, shared scripts, reference material, manifests and other assets are preserved; skill resources are also projected next to their active `SKILL.md`. Source files are never rewritten. Generated `.git` and `node_modules` directories and OS metadata are excluded. Install script dependencies separately when needed.

Active instructions retain skill metadata, translate agent/command metadata for OpenCode, resolve `CLAUDE_PLUGIN_ROOT`, `CODEX_PLUGIN_ROOT`, portable `PLUGIN_ROOT`, `CLAUDE_SKILL_DIR` and `CLAUDE_PROJECT_DIR`, and include a mapping of imported component names. Local MCP executable paths and packaged relative script arguments resolve to the preserved bundle. Source executable bits are retained for folder imports and Unix ZIPs. The bundle includes a `LEGALWORK-IMPORT*.json` compatibility report.

Standalone connector imports retain only the selected MCP entry and a source record, never the whole application configuration. Codex environment allowlists, HTTP headers, environment-backed headers/bearer authentication and OAuth client IDs are translated. Environment secrets and stored account/OAuth sessions are not read. Connectors import paused with a visible explanation; successful import opens Connectors for review and activation. Tool filters, approval rules, callback overrides and timeouts that require adaptation are explicitly reported. Reimport replaces the same source entry; uninstall removes its registered connector. Connector cards show readable names while execution identifiers remain unique.

## Features requiring adaptation

Importing the complete source does not reproduce another platform's runtime. The preview explicitly reports these differences:

- ChatGPT registered app IDs and provider-managed authorizations require reconnecting in LegalWork. Account tokens are not read or transferred.
- OAuth client IDs and scopes can be mapped. Endpoint overrides, confidential-client registration and API-key setup require configuring the connector in LegalWork.
- Unresolved environment/user-configuration variables, working-directory requirements and authentication helpers import the connector disabled. A templated/empty remote URL gets a disabled placeholder endpoint; the original configuration remains in the bundle. No environment credentials are read during import. Environment-default syntax uses its declared fallback.
- Claude/OpenAI hooks, LSP configuration, settings, output styles, experimental components, platform workflows and package dependencies are retained but are not automatically activated.
- Model aliases such as `sonnet` and `opus`, platform-specific permission/invocation metadata, dynamic context injection and session/data-directory variables require reviewing/adapting in LegalWork. Fully qualified OpenCode models are retained; foreign permission metadata does not grant permissions.
- An onboarding skill is available as a normal imported skill; setup does not run automatically.

Discovery checks the documented personal/project skill locations, plugin caches, `CODEX_HOME`/`CLAUDE_CONFIG_DIR`, Claude's `installed_plugins.json`, and OpenAI local/repository marketplace source paths. Cloud-only packages must first be exported or downloaded. The importer does not crawl accounts or arbitrary home folders.

The desktop supplies the actual OS home directory for discovery, including in development when the runtime library lives in an isolated home directory. Discovery reads existing installations; importing still writes to the active LegalWork library.

## Updates and limits

Reimporting the same provider/package name replaces the installed package in the selected scope; the preview announces this. Complete package directories are replaced so deleted resources and connectors are pruned. On installation failure, the previous package directories, import record and package-owned connectors are restored. Uninstall removes the retained bundle, active components and registered MCP entries. Removal dialogs state that packages affect all projects. Display names are retained in the installed library, and imported skill cards show readable component names; canonical package and execution identifiers remain unchanged for updates and removal. A successful import opens Skills and confirms the imported package.

Installation requires the digest from the reviewed preview. Source, scope or target changes require another preview. Package names are hashed into namespaces to avoid overwriting other packages. Existing unowned destination files cause a conflict. Folder/ZIP inputs reject traversal, linked files/directories, duplicate archive paths (including case collisions), encrypted/multi-volume/ZIP64 archives and excessive sizes. Limits: 64 MB of source/expanded ZIP data, 5,000 source files, 128 MB/10,000 installed resource files, folder nesting up to 24 levels.

## Format references (reviewed October 2026)

- [OpenAI plugin build guide](https://developers.openai.com/plugins/build/plugins): compatibility/portable manifests, root-relative paths, local marketplaces, MCP authentication and onboarding.
- [OpenAI skills guide](https://developers.openai.com/plugins/build/skills): skills and supporting resources.
- [Agent Plugins manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) and [MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json).
- [Claude plugin manifest reference](https://code.claude.com/docs/en/plugins-reference): optional manifests, component paths, inline definitions, merge precedence and local installation layout.
- [Claude skills reference](https://code.claude.com/docs/en/skills): standard/extended frontmatter, resource directories and runtime substitutions.
- [OpenAI MCP configuration](https://developers.openai.com/codex/mcp): TOML connector fields and environment/authentication settings.
- [MCP local-server setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers): Claude Desktop config locations and format.
- [Claude MCP reference](https://code.claude.com/docs/en/mcp): configuration formats, environment expansion, OAuth and helper differences.

## Validation

![Desktop discovery with readable names and native folder/ZIP choices](images/plugin-import-desktop-dialog.png)

![Separate review of the detected package components](images/plugin-import-review.png)

![Standalone connector discovery in Electron](images/connector-import-discovery.png)

![Standalone connector review in Electron](images/connector-import-review.png)

Native Electron verification found existing installations for both providers, filtered discovery by name and type, checked combined search/filter empty results and Back behavior, imported a Claude folder and a ChatGPT ZIP through the native pickers, and verified the resulting package cards and readable skill names. The ZIP fixture contained skills, a connector, an agent, a command and supporting files; its missing-credentials connector remained disabled with an explicit compatibility note. Standalone Claude and Codex MCP connectors were also discovered from project configuration, reviewed and imported into the paused connector library. A Node runtime smoke check verifies TOML discovery and header translation independently of the Bun test runner. No real MCP service was connected.

`pnpm --filter legalwork-server exec bun test src/connector-imports.test.ts src/plugin-imports.test.ts src/cloud-plugins.test.ts src/claude-plugin-bundle.e2e.test.ts src/runtime-opencode-config-store.test.ts src/validators.test.ts` exercises both providers, wrapped ZIP/folder imports, source assets and executable files, names/metadata, MCP precedence and exact arguments/environment/header values, global/project scope, cross-project removal, updates, rollback, source digests, ownership and malformed/oversized inputs.

`pnpm --filter @legalwork/app test`, app/server `typecheck`, app `test:i18n`, and app/server builds cover the UI and integration. Native Windows folder selection and real third-party MCP OAuth flows require platform/credential testing separately.

## Library redesign verification

The three libraries share one category-navigation row, with search and the compact source Filter menu alongside it. Personal and team items appear in one list, with Team labels on shared entries; built-in skills carry Included labels. Selecting All sources restores the combined list. The source persists across category changes, and search persists across source changes. Successful imports and Add selections reset the source to All so personal items are visible. Source filtering does not grant editing rights over firm-managed items.

Import, Add and More use the same styles and positions. Add offers Connector, Skill and File storage on every category and opens the selected library's existing form. Connectors also has Browse directory immediately left of Import. The page-level More menu provides Imported packages, Open skills folder and Refresh from every category. All import methods remain behind the single main Import action, with separate ChatGPT, Claude, GitHub and Folder or ZIP choices. Workflows retain their existing controls and pagination.

Rows use the same icon, name, description and action menu. View details comes first, followed by supported Edit, Export and Share actions, then separated Remove. Sharing reviews only the selected item. Optional team membership retains its confirmation, installed team skills retain their read-only resource viewer, and automatic items remain firm-managed. Connector account/enablement controls and storage membership stay in details. Unavailable expand arrows, Ready/Paused labels, the sync indicator and the global project-availability badge are removed. Team empty states consistently say no items have been shared by your firm yet, without extra explanatory paragraphs.

Personal, team and built-in skills use the same row spacing across their list boundaries. The old section margin is removed in the embedded library, and an empty team catalogue contributes no blank space. Native Electron verified the personal-to-built-in boundary; the focused 20-test suite and app type checking passed again.

Latest checks:

- `pnpm --filter @legalwork/app exec bun test tests/plugin-import-buttons.test.tsx tests/integration-libraries.test.tsx tests/mcp-library.test.tsx` — 20 passed. Coverage includes source isolation, complete team catalogue rendering and deduplication, embedded search, built-in command search and storage ownership restrictions.
- `pnpm --filter @legalwork/app typecheck` — passed.
- `pnpm --filter @legalwork/app test:i18n` — passed, 5,755 keys × English/German.
- `pnpm --filter @legalwork/app build` — passed, with the existing large-chunk warning.
- The preceding full app suite passed 949 tests across 146 files during the earlier library/import verification.

Native Electron verified All sources, Personal and Team selection, active source labels, menu dismissal after selection, keyboard selection, retained connector search across source changes, source persistence across categories, Skills excluding built-ins under Personal, and the inline Team skills empty state. Actual shared storage sources appear under All/Team with Team labels and are excluded by Personal. Add → Skill from Team File storage opened New skill and reset the source to All. Forms were cancelled; no connection, team membership, credential or shared item was changed. This account has no team skills, so populated catalogue rendering is covered by cached server-view fixtures.

Earlier native checks covered both providers' discovery, folder/ZIP pickers, component review, Back/close/focus, complete Claude-folder/ChatGPT-ZIP imports, paused standalone MCP imports, directory search/filter/detail return, connector setup/account details, package components, selected-item sharing and storage configuration. Windows pickers and real third-party OAuth require separate platform/credential checks. The desktop dev server remains running for review.

![Connector library with one category row](images/integrations-connectors-library.png)

![Compact source-filter menu](images/integrations-source-filter.png)

![Combined skills library](images/integrations-skills-library.png)

![Active Personal source filter](images/integrations-skills-filter.png)

![Shared storage in the combined library](images/integrations-storage-library.png)

![Shared Add dropdown](images/integrations-add-menu.png)

![Common tools menu on File storage](images/integrations-global-tools.png)

![Import source chooser](images/integrations-import-chooser.png)

![Dedicated folder and ZIP import](images/integrations-skill-file-import.png)

![Dedicated GitHub import](images/integrations-github-import.png)

The common-tools menu passed app type checking, the focused 20-test suite and the production build. Native Electron verified the same menu entries on Connectors, Skills and File storage, opening Imported packages from Connectors and File storage without changing categories, and returning focus to More on close. Open skills folder from File storage revealed the existing skills directory in Finder. No package, account or membership was changed.

Connector setup reuses the same **HubTabs** segmented switcher as Integrations and Recorder for **URL / Local server**, above the shared name field. Its shape, spacing, selected surface and focus treatment come from that shared component. URL shows the server address and request-header controls with Continue; Local server shows the command field with Add. Remote workers retain URL-only setup. Native Electron verified switching in both directions with mouse and keyboard, without submitting the form or running a command. App type checking and the production build passed; `pnpm --filter @legalwork/app exec bun test tests/add-mcp-modal.test.tsx tests/mcp-custom-connector.test.ts tests/integration-libraries.test.tsx` passed all 29 tests, and `pnpm --filter @legalwork/app test:i18n` passed with 5,757 keys in English/German.

![Connector setup with URL and Local server tabs](images/integrations-connector-command-tabs.png)

Connector details have only Remove and Close in the footer. Share with firm is available through the library row menu. Native Electron verified the simplified footer without changing connector access or signing in. `pnpm --filter @legalwork/app typecheck` passed, and `pnpm --filter @legalwork/app exec bun test tests/mcp-library.test.tsx` passed all 8 tests.

![Connector details footer](images/integrations-connector-details.png)

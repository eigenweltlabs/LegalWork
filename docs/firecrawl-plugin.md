# Firecrawl

Firecrawl uses its hosted OAuth MCP at
`https://mcp.firecrawl.dev/v2/mcp-oauth`. No Firecrawl CLI or API key is needed.

In **Settings → Integrations → Add → Plugins**, choose **Firecrawl**. LegalWork
finds the latest official Firecrawl package in the local Codex plugin library
and opens the existing plugin import review. Review the skills and connector,
import the package, and sign in to Firecrawl through LegalWork.

If the package is absent, install the official Firecrawl plugin in Codex or use
LegalWork's Import action with an exported package. For remote workers, import
the package onto that worker. **Connect without skills** remains available when
the package cannot be found.

The inspected official package is version 2.8.0 by SideGuide Technologies, Inc.,
from [OpenAI's Firecrawl listing](https://openai.com/business/plugins/firecrawl/).
It contains 12 skills, reference files, artwork, a portable MCP configuration and
ChatGPT app metadata. These are MCP workflows, distinct from Firecrawl's public
CLI skills. LegalWork preserves the complete source package and applies its
usual component namespacing and reference-path adaptation. It does not transfer
ChatGPT account sessions or its sidebar.

The package contains no package-wide redistribution license declaration.
LegalWork therefore imports the user's installed or exported copy; no vendor
skill text or artwork is redistributed in this repository. Check for updates in
the imported plugin's details after updating its official Codex installation.
Updates, rollback and removal use the existing plugin lifecycle. An existing
standalone Firecrawl connection is retained; the imported connector starts
disabled until its own setup is completed.

---
name: firecrawl
description: Use a connected Firecrawl MCP for US government and legal research, retrieving public webpages and documents, and producing cited web research. Load when using Firecrawl, including when a research task needs its Government & Legal Index.
---

# Firecrawl in LegalWork

Use the connected Firecrawl MCP tools and their current schemas. The connector supplies tool descriptions and server instructions; this skill adds source handling and research workflows. Tool names may have the connection's prefix.

If the tools are unavailable, use LegalWork's existing Firecrawl connection flow. MCP sign-in does not authenticate the separate Firecrawl CLI. Do not install the CLI, create another connection, or request an API key just to use an existing MCP connection.

## Choose the workflow

- US statutes, regulations, court opinions or government publications: read [Government research](references/government.md).
- Read a known URL, retrieve a public PDF, save source material, or collect several pages: read [Retrieval and source copies](references/retrieval.md).
- Produce a research brief or a formal cited report: read [Research briefs](references/research.md). A short factual lookup does not require a report.

Use `firecrawl_gov_search` for the US legal index, `firecrawl_search` for general web discovery, and `firecrawl_scrape` for a known source URL. For published scientific literature, use the available `firecrawl_research_*` tools; the ordinary search category `research` only filters websites. Other jurisdictions require suitable sources outside the US legal index.

For Alexandria data, inspect a matching provider's contract through `firecrawl_find_tools`, then execute with the exact discovered inputs through `firecrawl_scrape`. Search and discovery do not execute provider capabilities. Inspect each result for errors and follow its documented pagination.

## Sources and completion

Cite the original publication near the claim it supports. Retain its title, URL, exact supporting passage, and any evidenced section, paragraph, page, version or date. Search excerpts help locate evidence; read the underlying source when the excerpt does not establish the claim. Never invent a pinpoint citation or treat a source's own citations as proof that an authority remains good law.

When saving a source note or deliverable, retain those references and distinguish quoted text from your analysis. Use the project's existing notes and document tools; do not create a note or download a file for every search result. A tool result in chat is not automatically a saved project file.

Reuse content already retrieved. Bound crawls and PDF parsing to the task, check partial results and errors, and explain material gaps. If authentication or a usage limit prevents an operation, report it through the existing connection flow rather than switching credentials or clients to bypass it.

## Maintained sources

This is LegalWork's MCP adaptation of Firecrawl guidance, not an installation of its CLI or complete workflow bundle. Use live tool schemas for the available inputs and capabilities.

- [MCP tools](https://docs.firecrawl.dev/mcp-server/tools) and [Government Index](https://docs.firecrawl.dev/features/gov), reviewed 2026-10-25.
- [Official scrape skill](https://github.com/firecrawl/cli/blob/2f2825d7788725967f11607761818b2565314dc7/skills/firecrawl-scrape/SKILL.md) and [download skill](https://github.com/firecrawl/cli/blob/2f2825d7788725967f11607761818b2565314dc7/skills/firecrawl-download/SKILL.md), used to distinguish extraction from local file delivery.
- [Official deep-research workflow](https://github.com/firecrawl/firecrawl-workflows/blob/d2a986240f9d786ae54fc33fcfd9ad37308e9cc3/skills/firecrawl-deep-research/SKILL.md), used for the research-brief guidance; its [ISC notice](references/firecrawl-workflows-license.txt) is included.

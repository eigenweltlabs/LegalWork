# Retrieval and source copies

Choose tools by the requested output:

| Task | MCP path |
| --- | --- |
| Read a known webpage or public PDF/DOCX URL | `firecrawl_scrape` on that exact URL |
| Extract selected fields | Scrape with the current JSON schema options |
| Discover URLs within a site | `firecrawl_map`, then retrieve selected pages |
| Collect a bounded site section | `firecrawl_crawl`, then inspect its completion result |
| Parse a local document | `firecrawl_parse`, following its hosted upload flow when applicable |
| Get records from a discovered Alexandria provider | Inspect the provider contract, then execute through scrape |

Use the current MCP input schema rather than translating CLI flags literally. Prefer ordinary extracted content when you need to verify or quote a passage; use targeted structured extraction when only specific fields are needed. Check individual document/provider errors as well as the outer request status. Do not retrieve full pages again if a prior result already supplied their content.

## Saved material

For an extracted source copy, save the returned text with LegalWork's normal file tools in the requested project location. Include the original title, source URL and retrieval date, and label it as extracted content. Confirm the file exists before linking it. Extracted text does not preserve the original PDF's layout or provide reliable page numbers unless the result explicitly carries them.

For an original PDF or other binary, use its actual download URL and LegalWork's normal download capability. Firecrawl's scrape API offers `rawBase64`, but that does not mean the connected MCP tool exposes it: inspect the current schema. Never save extracted Markdown with a `.pdf` extension or claim that a tool response was automatically downloaded. Preserve the source link alongside the saved original.

The official CLI's experimental `firecrawl x download` saves site pages as extracted local files. It is a separate authenticated CLI workflow, not an MCP download tool. Do not assume it is installed or shares the MCP login.

For large PDFs or collections, bound pages and collection size with supported options and inspect truncation or parsed/total page metadata. Describe partial coverage. Keep source documents intact when preparing editable drafts.

Reference: [MCP tools](https://docs.firecrawl.dev/mcp-server/tools) and [Scrape formats and document URLs](https://docs.firecrawl.dev/features/scrape).

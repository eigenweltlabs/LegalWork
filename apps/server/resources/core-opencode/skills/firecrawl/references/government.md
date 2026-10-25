# Government research

Establish the relevant US jurisdiction and date from the request. Ask for a missing jurisdiction when it changes the governing rule. Use a supplied source URL directly rather than searching for it again.

1. Search with `firecrawl_gov_search`, including known jurisdiction, court, citation or domain filters supported by the live schema. The `cites` filter finds documents referring to an authority; it is not a finding that the authority is valid or controlling.
2. Inspect the returned title, original URL and matched excerpt. Basic search results contain these fields and rank; do not assume they also contain the complete document or a structured citation record.
3. Retrieve the source with `firecrawl_scrape` when the excerpt does not establish the rule. Verify the issuer, jurisdiction, document type, relevant version and enacted/effective status. Distinguish a bill, historical version or agency summary from enacted current law.
4. Cite the controlling section and supporting passage. Add a paragraph, page, subsection, court or date only when the retrieved evidence establishes it. Identify conflicting sources and unresolved status rather than resolving them from search rank.

Alexandria's Government & Legal Index provider can expose canonical citation identifiers and the authorities a document cites. Inspect its current contract through `firecrawl_find_tools` before retrieving those records. Reuse returned identifiers verbatim. Citation relationships support following authorities; they do not establish subsequent treatment or replace checking the original authority.

For a saved source note, preserve the original title and URL, relevant jurisdiction/version, retrieval date, exact supporting passage, and evidenced pinpoint. Link a local copy when one was actually saved. State whether the copy is extracted text or an original file. Keep the legal conclusion separate from the quoted evidence.

A useful answer links its material claims to the sources actually read. Filtered-out documents, partial parsing and no search hits do not establish that no applicable law exists.

Reference: [Government Index guide](https://docs.firecrawl.dev/features/gov), [search response and filters](https://docs.firecrawl.dev/api-reference/endpoint/gov-search), and [citation relationships through Alexandria](https://www.firecrawl.dev/gov-index).

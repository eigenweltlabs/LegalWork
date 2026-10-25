# US legal research

LegalWork's built-in `search_us_law` tool searches the
[Firecrawl Government & Legal Index](https://www.firecrawl.dev/gov-index) for US
federal, state and local statutes, regulations, court opinions and agency publications.
Ask, for example: “Find California's statute on employee noncompete agreements,
then read and cite the current section.”

The tool is available on workers with managed web access, including the desktop
app, alongside `legalwork_websearch` and `legalwork_webfetch`. It needs no account
or key to start. It uses the same authenticated server route, calling chat's
network settings, web-search permissions and URL-level web permissions. In Approve
mode, the query and filters appear in the chat before any request is sent; Off
blocks the request. Permission changes and cancellation also stop pending requests.

Searching this index currently uses no Firecrawl credits. Keyless daily limits
apply per IP. For higher limits, optionally save `FIRECRAWL_API_KEY` in Settings >
Environment and restart the worker to load the environment. The key stays in the
server's outgoing Authorization header and is redacted from approvals. Rate-limit
and provider failures are reported as errors, never as an empty search.

The query is sent to Firecrawl. Use an abstract legal question without confidential
client facts. The integration sends only the query, result limit and supplied
filters, not workspace files, session IDs or agent identity.

The [API](https://docs.firecrawl.dev/api-reference/endpoint/gov-search) supports:

| Argument | Meaning |
| --- | --- |
| `query` | Question, including the relevant jurisdiction and date |
| `k` | Result limit, 1–20 in LegalWork; default 5 |
| `jurisdiction` | `us` (federal) or a state/territory such as `us-ca` |
| `court` | CourtListener ID such as `scotus` or `ca9` |
| `courtType` | Federal/state court category |
| `cites` | Citation or canonical ID of a law/case that results must cite |
| `domain` | Source hostname such as `irs.gov` |

Filters combine with AND and exclude pages without the corresponding labels.
The tool preserves result URLs and titles and returns bounded excerpts, marking
truncated excerpts. The agent must open original sources with `legalwork_webfetch`
and verify issuer, jurisdiction, enacted/effective status and version before
citing controlling law. Results can include historical versions, bills, guidance
and third-party reproductions. Neither no hits nor a citation match establishes
the absence of applicable law or that a case remains good law.

Use general web search for German, EU and other non-US law. This integration uses
the `/v2/search/gov` endpoint; Alexandria's richer citation graph and full-content
provider are outside its scope.

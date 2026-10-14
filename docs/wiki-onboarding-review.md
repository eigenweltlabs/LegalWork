# Harvey wiki onboarding review

Reviewed 12 October 2026. Wiki: **Harvey Chris Test**. This is a review of the user's completed onboarding, not a second import. Existing wiki content and the source archive were preserved.

## Finding

The run produced a source-linked matter inventory, but did not finish building a useful firm wiki. The main failure was the definition of completion: source coverage and identifier caution dominated the instructions and delegation. Entity reconciliation, substantive synthesis, firm context, recurring processes and reader usability did not have clear deliverables or owners.

There is useful factual material in some matter summaries. It should be retained and developed. Repeated warnings about what the agent did not infer should not be the organizing voice of the wiki.

## Scope and evidence

The review inventoried all 378 Markdown files and the saved dashboard definition, examined the onboarding conversation and its five child conversations, and read representative pages across the source batches. Source comparisons use document text returned during that run. This is not a claim to have independently reread the entire archive.

| Observed result | Why it matters |
| --- | --- |
| 266 typed matter pages | Broad folder coverage, but this alone does not establish useful onboarding |
| 62 typed client pages and 25 additional identity/source records under Clients | 87 records are not 87 unique clients; the tree mixes profiles with identity audit material |
| Flat Clients and Matters collections | Readers must navigate long lists, often named by identifiers |
| One knowledge article | Its general milestone-reading advice does not capture the breadth of the underlying practice knowledge |
| No substantive process pages or person pages | Available evidence about people and working procedures was not developed |
| Firm/About plus a folder hub | The firm name was recovered, but little about its offices, people or capabilities |
| Four starter templates | The presence of template headings does not mean reusable firm documents were extracted |
| 352 Markdown files contain the raw team connection identifier | Machine provenance leaked into reader-facing prose |
| 173 of 266 typed matter pages lack a practice field | Even a practice overview cannot reliably group the current index |

The five child conversations contain 688 source-reader calls across 585 distinct paths, including 28 email files. This demonstrates source access, but does not imply complete reading of those files. Many calls read only short prefixes. The problem was not simply an inability to read documents: the run often failed to turn information it had already read into useful pages.

## Assessment of the ten reported issues

1. **Organization:** confirmed. Large flat collections, identifier-based paths and extensive hub lists reproduce an inventory. Use shallow groups based on how readers browse, readable page names, one stable home per subject, and indexed relations for other dimensions. Do not create empty folder hierarchies just to look organized.
2. **Unique clients and people:** confirmed as an unresolved task. Workers split by source range and created source-specific identity records. A shared registry and a cross-batch reconciliation owner were missing. Some source identifiers genuinely conflict, so mechanically merging equal names would also be wrong. Compare business, contacts, roles, dates, related matters and organizational relationships. Preserve a concise disagreement on the relevant profile when needed.
3. **Dashboard:** confirmed. The saved view is two record counts, source lists and large tables. Its matter query is capped at 100 rows although there are 266 matter pages. It is neither an effective overview nor a complete directory. Build a historical practice overview with supported groupings, useful aggregate counts, a small selection of matters and links to filtered detail. Missing fields should remain unknown, not become invented current stages or workloads.
4. **Firm context:** partially present, substantially incomplete. The run identified Calderwood & Harkness LLP. Sources also supplied offices, partners, associates, practice roles and intake rules that were not synthesized into firm and people pages.
5. **Repeated processes:** confirmed. The agent read email and checklist material but produced no process pages. Comparing intake, conflicts, handoffs, approvals, closing and post-closing records must be an explicit task. Describe an observed procedure as such unless the evidence establishes an approved firm rule. One example is not proof of a recurring firm-wide process.
6. **Progress:** confirmed. The parent plan had three broad tasks. One long extraction phase concealed entity work, synthesis, organization and verification. Plans should name those deliverables, show batch progress beneath them, and keep synthesis incomplete until it actually happens.
7. **Reusable knowledge:** confirmed. Substantive issues remain buried in matter summaries. Useful examples include post-closing control agreements, signing versus funding conditions, intercreditor arrangements and subsidiary versus parent consent requirements. These are candidates for source-based synthesis, not prevalidated legal rules.
8. **Sources folder:** an empty folder is not inherently a defect. Keeping the original archive in connected storage is sensible. What is missing is convenient, durable access to supporting evidence. Copy selected documents when a usable durable link is unavailable or a reusable attachment is needed. Do not duplicate the whole S3 archive or turn Sources into an import diary.
9. **Source evidence presentation:** confirmed. Connection UUIDs, object paths, hashes and extraction ranges dominate many references. Readers need a document title, date, relevant section and a working link. Machine provenance belongs behind that reference or in structured source metadata. The generic connected-storage reference opening path also needs a dedicated follow-up; the review does not claim those citations are fixed by wording alone.
10. **Page quality:** confirmed across many examples, but not every page is devoid of useful content. A matter page should explain the client's objective, situation, work, issues, developments and result. A client page should explain the business, relationship, contacts and work. Material uncertainty belongs next to the affected fact. Agent actions, read offsets and repeated lists of things not inferred belong in task state.

## Concrete source comparison

The MTDC new-matter intake for matter 1031-00001 contains a description of the Illinois transit authority, general counsel Terrence Whitfield, CISO Lucia Marchetti and executive director Darnell Okafor. It identifies Rachel Bernstein in Privacy & Data Security, the Chicago office, the conflicts director, and a procedure requiring written conflicts clearance and engagement authorization before substantive work. Later records describe the declined engagement.

The generated client page concentrates on prospective/declined status, conflicting EINs and source paths. It omits much of the business and contact information. This is a direct example of useful information already read but not synthesized. Conflicting identifiers across MTDC records remain a real reconciliation issue; the correct response is not to assert that every similar record is the same legal entity.

Matter 1001-00001 is a better starting point: it contains the acquisition objective, HSR issues, team members, dates and fee information. Those details should support related client, person and practice-knowledge pages instead of remaining isolated in one summary.

The Northgate closing checklist for 1022-00003 similarly names the working team and client contact and describes a sequence involving board approval, signatures, nominee withdrawal, appointment and disclosure. Compare it with other relevant records to establish a useful scoped process. Do not promote one checklist to firm policy.

## Synthesis applies to every region and wiki structure

The rule is general: understand the subject, reconcile it across sources, extract what is useful, connect it, and verify reader tasks. The wiki's editable structure determines the destinations. Blank and customized wikis need the same synthesis discipline without being forced into law-firm folders.

| Region or equivalent custom type | Required synthesis |
| --- | --- |
| Firm / organization | Identity, supported offices, capabilities, working conventions and relationships |
| People | One contextual profile per established person, roles, expertise, organizations and relevant work |
| Clients / entities | Business, relationship, contacts, history and connected matters; reconcile aliases and source conflicts |
| Matters / projects | Purpose, context, work, substantive issues, developments, outcomes and related knowledge |
| Knowledge / topics | An answer or explanation assembled across evidence, including applicability and meaningful exceptions |
| Processes / procedures | Usable steps, roles, inputs, outputs and exceptions, with observed versus approved status |
| Templates / reusable assets | An actual reusable artifact, when to use it, how to adapt it and its relationship to guidance |
| Sources / evidence | Selected accessible references or supporting files with readable provenance |
| Dashboards / overviews | Questions answered through normalized fields, aggregates and purposeful selections |
| Reports / dated outputs | A coherent conclusion and supporting analysis with explicit time and source scope |

Unsupported regions may remain empty after deliberate investigation. Synthesis does not mean producing generic prose or meeting a page quota.

## Changes implemented after this review

- Both firm and blank starters contain editable synthesis guidance in Structure.md. Firm setup now assigns reconciliation, firm/people context, knowledge, processes, navigation and usability as explicit deliverables. Blank setup follows the same discipline using its own chosen structure.
- Client and matter starter templates describe useful content instead of emphasizing evidence-audit headings. Dashboard guidance requires aggregate comparisons and concise selections rather than a large directory.
- Wiki-local skill loading and resource reads retain the authenticated chat origin, fixing the observed "Workspace not found" fallback when loading setup skills.
- The graph waits for a real viewport and resizes/refreshes when a hidden tab becomes visible. Graph is available in the wiki tab plus menu.
- Chats show a running-subagent count and a persistent small panel listing descendant agents. Status refresh uses the existing engine API and activity store.
- Failed view creation is displayed as not saved. Terminal tool results repair stale cards after reconnect, and confirmed idle snapshots end abandoned generation indicators. Historical results do not automatically open tabs.

The live wiki was not rewritten or reimported. New starter guidance does not silently replace customized instructions in existing wikis.

## Repair sequence for the existing wiki

1. Establish readable names, a minimal shared field vocabulary and a cross-source entity map. Preserve the original files and ambiguous assertions while reconciling.
2. Improve client and matter content from the sources, with targeted continuation reads where important sections were not read.
3. Develop firm and person pages, substantive knowledge and observed processes across batches. Reuse existing facts rather than starting the whole import again.
4. Consolidate duplicates where supported, group growing collections, add meaningful relations and repair moved links.
5. Provide usable evidence references and selected supporting attachments. Build an overview around actual questions and supported historical data.
6. Verify reader tasks and source coverage separately. Report remaining gaps in chat. Completion requires both useful content and working navigation.

## Validation

- Focused app tests: 24 passed, covering graph viewport lifecycle, tab behavior, descendant-agent counting and view-generation reconciliation.
- Starter and skill-tool tests: 20 passed, including wiki-origin headers on composed skill and resource requests.
- App typecheck and server build passed.
- Native Electron checks and their limits are recorded in [wiki-validation.md](wiki-validation.md).

The improved instructions have not been validated by another full model-driven Harvey import. Passing software checks is not evidence that the model will now produce a high-quality wiki; that requires a subsequent content-level run and review.

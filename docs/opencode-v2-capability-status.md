# Engine and capability acceptance status

Checkpoint: 26 October 2026, 16:09 UTC. Migration remains unfinished. The
priority is platform execution, migration safety and real agent/tool behavior.
The user explicitly separated inherited browser bugs from completion; no
regression from v1 remains required. See [the separate browser issues](opencode-v2-browser-known-issues.md).

## Platforms

| Configuration tested | Verified | Still running or remaining |
|---|---|---|
| macOS ARM64 | Normal final7 Electron startup, patched v2 engine, retained project/document, native tool calls and original visible-browser scenario; full build/package/security. | Remaining shared real-agent regression cases and final adoption. |
| Linux x64 | Normal final7 engine/Electron startup and live native registry; prior final6 real PowerPoint task4/4, saved artifact and observer qualification. Final7 real Excel completes reading, edits, recalculation and same-workbook checks; root independently verifies the saved workbook and exact trace qualification. | Excel strict score remains3/4: the original-file assertion detects a style XML CRLF→LF change also present in v1. Legal/delegation/large-connector comparisons remain. |
| Windows x64 Server VM | Final7 normal build/package/security/unsigned installer and installed upgrade pass. All2620 installed package files match; all15 chats/75 messages and empty queue remain exact in SQL and accessible through public APIs. Actual licensed Word read/tracked edit/comment/save/reopen passed on final6. Actual final7 engine direct/CodeMode MCP reconnect/recovery component passes2 tests/26 original assertions. | Real-model cross-provider in-app DOCX acceptance preparation. External Microsoft Word and controller-hosted MCP component evidence retain their separate scopes. |

These are the actual tested configurations, not a claim that every CPU/OS
combination was executed. All twelve upstream engine target artifacts were
built and statically verified. Intel Mac, Linux ARM64 and Windows ARM64 app
execution is not yet established. The user explicitly requires all six app/engine
configurations before migration completion. The CI producer and six-runner
acceptance workflow are drafted but have not executed. They build the reviewed
engine from its original frozen upstream dependency graph and transfer it through
Actions artifacts, without publishing it or granting access to private traces.
Windows11 hardware
performance and automatic update delivery retain the user's separate release checks.

## Tool registration

A source-backed audit compares every explicit tool dictionary entry in the
frozen v1 plugin source with the actual final7 Linux native registry:

- **145 of145 domain-tool registrations remain present under their exact names**
  (or their native namespace); the live project registry has239 total tools.
- This covers Word7, Excel9, PowerPoint8, in-app/extension/UI41, calendar7, drafts6,
  scheduled tasks9, skills4, storage9, reviews18, wiki/views22, sandbox3,
  complete-output reader1 and the existing benchmark feature1.
- One additional old declaration only returned the literal version string
  `opencode-chrome-devtools@1.0.4`. That plugin was replaced by the approved
  native browser integration; it was not a document/browser action.
- The normal build packages31 native plugin directories.

This verifies availability, not successful execution or reasoning quality. It
counts explicit baseline dictionaries only; factory-generated/native tools and
the retired external browser plugin's dynamically imported tools have separate
contracts and acceptance. Tools remain subject to their actual project
configuration and permissions. No new tool/output cap is introduced.

Private audit: `~/.codex/benchmarks/legalwork-capability-source-parity-20261026/`
`live-registration-comparison.json`, SHA256
`c4937e781a2d6766a72e8a5e7df8ed121ad6ed45bac920c6bc4da2cec6c713cb`.
The full mapping retains exact source files/lines and observed native IDs.

## Remaining acceptance

1. Finish matched legal/Office tasks, delegation and the large connector task
   with unchanged prompts, original files/assertions and complete traces.
2. Complete native-v2 queue/restart, context and scheduled execution. Existing
   deterministic queue controls pass. Further v1 harness reruns are deferred
   while the native-v2 lane takes priority. The latest v1 control restored its
   chat correctly but a normal feature announcement obscured the Deny button;
   no denied-permission or model-quality verdict is claimed for that attempt.
3. Finish exact connector-recovery and cross-provider checks, then finalize the
   pinned derivative's adoption/distribution metadata after functional acceptance.
4. Execute the six-platform CI acceptance and verify the latest private-auth
   runtime change in an actual package. Public workspace/status metadata now
   omits both flat and nested native engine credentials. The desktop reads the
   live embedded-server config privately, matches the exact selected project and
   follows credential rotation. Real HTTP tests pass13 cases/98 assertions;
   desktop tests pass435 with4 platform skips; app/server typechecks pass. These
   source checks do not establish packaged acceptance for this newer change.

The final7 NDA run completed18 real EU Gemini requests and saved its report;
both original mechanical assertions pass. A full56-criterion substantive
assessment proposes55/56 versus the previous v1 result53/56. Root has reviewed
the summary and independently adjudicated the borderline non-solicit item and
the two previous omissions, but full independent acceptance remains open. The
unchanged C045 rubric/source conflict and six additional quality concerns remain
recorded, including compelled-disclosure severity and unsupported factual claims.
This is not a blind quality estimate. The original trace-incomplete result is
retained; its one internal-search gap has a proposed exact qualification, not a
general tracing waiver. Complete closed-state archives are verified in private
EU cloud storage. Delegation is now executing; the large-connector and native
queue/context/scheduler cases remain separate outstanding checks.

The first final7 Excel attempt stopped before inference because the fresh UI had
no selected model. That zero-call failure and original workbook are retained.
Ordinary UI selection and a new empty chat corrected setup; the separately
admitted real run completed18 requests with no provider/engine error. Its original
`trace-incomplete` result remains unchanged. Root independently verifies all2704
retained files,62 raw trace records,18 complete provider wires, four full internal
search returns/outer timings and three exact empty-object document-list pairs.
The saved workbook preserves all7 checked formula/value cells,32 original cell
styles,18 row attribute sets,28 untouched non-formula cells and the original
theme. Only the previously observed XML line ending differs. Exact additive
qualification is accepted; no general trace waiver, request-role attribution,
controlled speed/cost claim, model rerun or assertion relaxation has occurred.

Full request/response and tool evidence is retained, including failures. Native
internal search lacks its own separate timing span under the user's accepted
exception; full search results and outer-call timings remain. Do not claim
controlled speed/cost improvements when request roles, source baselines or
provider cache state differ.

No release, push or default derivative selection has occurred.

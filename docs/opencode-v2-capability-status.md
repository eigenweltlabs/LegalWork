# Engine and capability acceptance status

Checkpoint: 26 October 2026, 17:05 UTC. Migration remains unfinished. The
priority is platform execution, migration safety and real agent/tool behavior.
The user explicitly separated inherited browser bugs from completion; no
regression from v1 remains required. See [the separate browser issues](opencode-v2-browser-known-issues.md).

## Platforms

| Configuration tested | Verified | Still running or remaining |
|---|---|---|
| macOS ARM64 | Normal final7 Electron startup, patched v2 engine, retained project/document, native tool calls and original visible-browser scenario; full build/package/security. | Remaining shared real-agent regression cases and final adoption. |
| Linux x64 | Normal final7 engine/Electron startup and live native registry; prior final6 PowerPoint4/4. Final7 actual Excel, NDA, delegation and large-MCP tasks completed; root independently verifies their files, complete wires and exact trace qualifications. | Excel strict3/4 matches v1's style XML CRLF→LF change. NDA55/56 versus v1 53/56 retains the frozen rubric/source conflict and additional legal-quality concerns. Delegation strict8/9 versus v1 9/9 differs in three citation capitalizations. Large MCP3/3 preserves the full2,024,587-byte result. Queue/context/scheduling remain. |
| Windows x64 Server VM | Final7 normal build/package/security/unsigned installer and installed upgrade pass. All2620 installed package files match; all15 chats/75 messages and empty queue remain exact in SQL and accessible through public APIs. Actual licensed Word read/tracked edit/comment/save/reopen passed on final6. Actual final7 engine MCP recovery component passes2 tests/26 original assertions. Actual final7 Claude in-app DOCX editing qualifies4/4 after root verifies the saved tracked30→45 edit, full wires and exact zero-argument tool traces. | Original Claude controller-path failure remains unchanged; read-only recovery adds separate evidence without a model rerun. In-app DOCX, external Microsoft Word and controller-hosted MCP component evidence retain their separate scopes. |

These are the actual tested configurations, not a claim that every CPU/OS
combination was executed. All twelve upstream engine target artifacts were
built and statically verified. Intel Mac, Linux ARM64 and Windows ARM64 app
execution is not yet established. The user explicitly requires all six app/engine
configurations before migration completion. The first migration checkpoint was pushed at `d35228ebb9c44d2827e3d1b8c7bf7f925917d253`.
The [six-platform CI acceptance](https://github.com/eigenweltlabs/legalwork/actions/runs/40359354246)
started at16:27:48UTC. Its reviewed twelve-target engine producer passed; all six
sandbox jobs stopped because CI had not prepared the Node worker runtime.
Commit43f80e46 adds the existing checksum-pinned runtime preparation. It also
keeps complete layered-TLS tests on verified Bun1.3.14 because1.4.2/1.4.4 stall
in that test-host path; production Node22 and engine compiler1.4.4 are unchanged.
Thirteen CI controls pass. An explicit run ID plus independently verified manifest
allows reuse of the unchanged producer rather than recompiling twelve targets.
No successful six-platform app execution is claimed yet. The workflows build the reviewed
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

1. Complete native-v2 queue/restart, context and scheduled execution. Existing
   deterministic queue controls pass. Further v1 harness reruns are deferred
   while the native-v2 lane takes priority. The latest v1 control restored its
   chat correctly but a normal feature announcement obscured the Deny button;
   no denied-permission or model-quality verdict is claimed for that attempt.
2. Finalize the
   pinned derivative's adoption/distribution metadata after functional acceptance.
3. Execute the six-platform CI acceptance and verify the latest private-auth
   runtime change in an actual package. Public workspace/status metadata now
   omits both flat and nested native engine credentials. The desktop reads the
   live embedded-server config privately, matches the exact selected project and
   follows credential rotation. Real HTTP tests pass13 cases/98 assertions;
   desktop tests pass435 with4 platform skips; app/server typechecks pass. These
   source checks are now supplemented by an actual final8 Mac normal build/package/security and real engine startup. It verifies the exact native version and credential-free workspace metadata; browser connection acceptance remains separate.

Latest dev3b214a80c is merged at80d34a95, including checkout/sign-in expiry and
Mac updater shutdown fixes. Migration-specific import integration is corrected
at43969414. All437 desktop tests pass with4 platform skips;29 affected sign-in
tests and app/server typechecks pass. Earlier real task results retain their
sealed9c278ff0/final7 identities rather than claiming execution of this newer source.

The final7 NDA run completed18 real EU Gemini requests and saved its report;
both original mechanical assertions pass. Root independently accepts the full
56-criterion coverage assessment:55/56 versus v1 53/56, including354 exact cited
source/report passages and all retained evidence. The
unchanged C045 rubric/source conflict and six additional quality concerns remain
recorded, including compelled-disclosure severity and unsupported factual claims.
This is not a blind quality estimate. The original trace-incomplete result is
retained; its one internal-search gap has a root-accepted exact qualification,
not a general tracing waiver. Complete closed-state archives are verified in
private EU cloud storage. Delegation completed with two distinct actual
parent-linked reviewers and complete22-pair tool traces. Literal v2 strict8/9
versus v1 strict9/9 remains: exactly three citation labels use source-identical
capitalized Section. Root accepts the exact additive functional qualification;
both memos retain external-statute/fixed48h-buffer claims outside the supplied
sources. Large MCP passes all3 original assertions, matching v1's parsed decision.
All4 native connector calls contain the complete2,024,587-byte text and ordered
structured result; the actual digest tool consumes the entire source. Root
accepts its exact two-search qualification and verifies all11 full GeminiEU/medium
wires. Native search has no separate child event/timing; originals remain
trace-incomplete. Request roles and controlled cost/speed comparisons are not claimed.

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

The migration branch is pushed for CI; no release or default derivative selection has occurred.

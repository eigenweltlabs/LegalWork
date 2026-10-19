# OneDrive startup downloads — 19 October 2026

Confirmed with the actual Microsoft OneDrive client and a signed-in account containing only synthetic documents. LegalWork 0.2.10 downloaded every document in a project when its initial document-sharing scan ran. An unregistered OneDrive folder stayed online-only. No agent prompt or explicit document open was needed.

## Root cause

Project sharing starts a background document-sync round shortly after server startup and normally repeats every minute. New files and files whose metadata changed are opened to calculate SHA-256 before deciding what to upload. Opening an online-only placeholder downloads its contents. The released code also checks the upload size limit **after** hashing, so even a rejected large upload can download first.

A successful existing baseline avoids re-reading files whose size and modification time still match. Evicting already-synced files with OneDrive preserved those timestamps in this test; the released app did **not** download them again on that restart. Separately, the released code fails to save a verified new timestamp when content is unchanged, so timestamp changes can cause repeated hashing.

This explains downloads within shared project roots. It does not establish that Timothy's affected local folders are precisely those roots, or explain downloads outside them. Production database counts describe uploaded records, not how many local files were inspected or read. The timing of newly shared projects is consistent with the reported onset, but the local paths were not recorded there.

The separate FFF-disable change does not address this sharing scan. [OpenCode v1.18.29 already disables FFF by default on Windows](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/core/src/flag/flag.ts#L34).

## Real OneDrive reproduction

Environment: GCloud Windows Server 2022, OneDrive **26.178.0913.0007**, Electron **43.7.5 / Node 24.21.0**. The reported customer environment was Windows 11; that exact OS was not tested.

The signed-in OneDrive contained 21 synthetic documents: 10 in the registered Corporate project and 11 in an unregistered Litigation control folder. All 21 were initially online-only. Availability was observed with metadata-only Windows attributes, without opening document data.

The actual released LegalWork 0.2.10 desktop app and its managed OpenCode engine were started in the interactive Windows session with an isolated profile. For sharing, the app used a local HTTP test service implementing project listing and file commits, with document sharing enabled and the other scopes disabled. **OneDrive's client and cloud storage were real; the Eigenwelt sharing service was a local test double.** No production sharing state was modified.

| App and operation | Project documents downloaded | Control documents downloaded | Sharing result |
| --- | ---: | ---: | --- |
| Released, unshared startup | 0 / 10 | 0 / 11 | Sharing disabled |
| Released, unshared restart | 0 / 10 | 0 / 11 | Sharing disabled |
| Released, initial shared startup | **10 / 10** | 0 / 11 | 10 file commits and 10 saved baselines |
| Released, evict files and restart with saved baseline | 0 / 10 | 0 / 11 | Existing baseline reused |
| Fixed, initial shared startup | **0 / 10** | 0 / 11 | 10 online-only deferrals, no file commits |
| Fixed, restart with deferred files | **0 / 10** | 0 / 11 | 10 online-only deferrals, no file commits |
| Fixed, explicitly read one document | **1 / 10** | 0 / 11 | Exactly one file committed; nine deferred |
| Fixed, evict the agreed document and restart | **0 / 10** | 0 / 11 | Its baseline stays settled; the other nine remain deferred |

The released shared startup began at 17:17:04 UTC; the first hydration was observed at 17:17:17 UTC. No agent message was sent. Unshared startup also created 27 support files (about 3.4 MB) in the project, which OneDrive can upload; that is separate from downloading the original documents.

For the fixed test, four compiled server modules were replaced inside the release's ASAR. The official development Electron executable of the **same version** was used because the production executable validates its embedded archive hash. The app's UI, managed engine and remaining release resources were retained. This is not a test of a newly packaged production installer; frontend labels were validated through typechecking and the translation check.

Machine-readable observations and a screenshot are in [`evidence/onedrive`](../../evidence/onedrive). They contain synthetic paths and test identifiers only.

### Repeat manually with a test account

1. Place several documents in one OneDrive project folder and another folder as a control. Register only the first folder in LegalWork. Use an isolated LegalWork profile and test sharing account/service.
2. Choose OneDrive's **Free up space** for the documents. Wait until every original file has `Offline` or `RecallOnDataAccess`; merely removing the pinned flag does not prove eviction is complete.
3. Start the released app with sharing disabled, then restart it. Record original-file availability separately from newly created support files.
4. Enable document sharing with an empty local sync baseline, then restart. Observe downloads without sending a prompt. Check the control folder and sharing commits.
5. Repeat with the fix and an empty baseline. Expect no original downloads and an `online_only` deferral for each project document.
6. Restart again, then deliberately open one document. Expect only that document to download and join sharing. The remaining originals must stay online-only.
7. Also evict an already-agreed document and restart. Matching cached metadata and remote hash should remain settled without opening its contents.

A metadata-only check in Windows PowerShell is:

```powershell
Get-ChildItem -LiteralPath $testFolder -File -Recurse | ForEach-Object {
  [pscustomobject]@{
    Path = $_.FullName
    OnlineOnly = (([int][IO.File]::GetAttributes($_.FullName) -band 0x401000) -ne 0)
  }
}
```

## Fix

- Query Windows `Offline` / `RecallOnDataAccess` attributes before content reads. Defer unavailable files rather than hash, upload, overwrite, delete or conflict them. Inspection failures stop/defer work instead of allowing reads.
- Reuse already-agreed metadata and remote hashes without marking an evicted, unchanged file as pending.
- Keep remote reconciliation pending for deferred changes, so a later explicit download can resume safely.
- Apply the same availability rule to access-revocation checks, retaining a potentially changed local copy without downloading it.
- Reject oversized files from metadata before hashing. Save verified timestamps when content is unchanged.
- Distinguish Windows cloud reparse points from real symbolic links using `lstat`, without following links.
- Explain online-only deferrals in project-sharing status in English and German.

This changes sharing behavior intentionally: an online-only document that has not yet been shared waits until its contents are available locally. Downloading it explicitly, or making it available offline in OneDrive, allows sharing to resume.

The availability check is a preflight, not an atomic no-recall file handle: eviction between checking metadata and reading remains possible. [Microsoft's attribute definitions](https://learn.microsoft.com/en-us/windows/win32/fileio/file-attribute-constants) distinguish `RecallOnDataAccess` from `RecallOnOpen`, whose bit is shared with EA and is meaningful only for directory enumeration. Other cloud providers and macOS were not integration-tested.

## Regression checks

- `pnpm exec bun test apps/server/src/project-file-sync.test.ts apps/server/src/project-sync.test.ts apps/server/src/project-review-sync.test.ts apps/server/src/file-storage/project-folders.test.ts` — 58 passed, 300 assertions.
- `pnpm --filter legalwork-server exec node node_modules/typescript/bin/tsc -p tsconfig.json` — passed, compiled modules used in the Windows test.
- `pnpm --filter @legalwork/app typecheck` — passed.
- `pnpm --filter @legalwork/app test:i18n` — passed.
- `pnpm --filter legalwork-server build` — passed before the final cached-file fast path; final server compilation passed afterward.
- `git diff --check` — passed.

The regression cases cover deferral/resumption alongside available files, preservation of remote edits and baselines, reconciliation across rounds, access revocation without hashing, timestamp caching, and unchanged evicted files staying settled.

## Earlier native fixture tests

The included C# Cloud Files provider creates real NTFS placeholders without a cloud account; it records kernel `FETCH_DATA` callbacks and requesting processes. Metadata enumeration, `stat`, `realpath`, and attribute queries caused zero hydration requests. Explicit reading caused one. The released sync skipped these particular placeholders because libuv exposed them as links, so that earlier zero was **not** a reproduction of the incident. With cloud reparse classification and the availability guard, all 24 stayed deferred without hydration; explicitly downloading one allowed only that file to upload.

Stock OpenCode v1.18.29 startup and `/path`, `/session`, `/file`, `/find/file` requests also caused zero hydration with this fixture, with both the Windows FFF default and FFF explicitly enabled. These were limited engine tests, not agent conversations. The real OneDrive desktop test above provides the positive incident reproduction.

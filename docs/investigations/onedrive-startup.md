# OneDrive startup downloads — 19 October 2026

Confirmed with the real Microsoft OneDrive client and a signed-in test account containing only synthetic documents. LegalWork 0.2.10 downloaded all ten documents in a project when its initial document-sharing scan ran. An unregistered control folder stayed online-only. No agent prompt or document open was needed.

## Cause and policy

Project sharing starts background document sync shortly after server startup. New files and files with changed metadata are opened to calculate SHA-256. Reading an online-only OneDrive placeholder downloads it. A saved, matching baseline avoids that read; evicting already-agreed files and restarting did not reproduce another download in this test.

The product policy for this fix is: **document sharing cannot be enabled for cloud-backed local project folders; link a Cloud Folder instead.** This applies regardless of whether the documents are currently downloaded. Opening a cloud document later does not opt it into Eigenwelt document sharing.

The restriction applies to existing projects whose saved settings still enable documents. Their effective local Documents setting is off, the sharing dialog explains why, and the API rejects enabling it. Existing local files and previously uploaded remote copies are not deleted. Notes, recordings, review results, tasks, calendar entries and project details retain their separate sharing choices. Reviews and calendar attachments cannot pull ordinary project documents back into file sharing. Notes and recordings remain file-backed app content; the guard does not disable those separate scopes.

The earlier per-file deferral experiment has been replaced by this folder policy. There is no per-placeholder availability helper or online-only pending queue in the final change.

## Detection and enforcement

On Windows, `isCloudFolder` calls [CfGetSyncRootInfoByPath](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfgetsyncrootinfobypath) for basic sync-root metadata. This identifies registered cloud roots and nested project folders without enumerating documents or relying on folder names or hydration flags. OneDrive's root and two nested folders returned success; ordinary local folders returned `ERROR_CLOUD_FILE_NOT_UNDER_SYNC_ROOT`. Unexpected inspection failures stop work instead of allowing a content scan.

On macOS, standard File Provider folders under `~/Library/CloudStorage` and iCloud Drive are recognized, including resolved aliases into those locations. Path-boundary checks avoid treating similarly named ordinary folders as cloud storage. Legacy or nonstandard provider locations outside those roots are not covered by this macOS detector. Linux cloud mounts are not detected.

`projectSyncStatus` returns the effective Documents setting and `fileSharingDisabledReason: "cloud_folder"`. The UI locks the Documents switch off, shows “File sharing cannot be enabled for cloud folders. Link a Cloud Folder instead.”, and labels reviews without promising included documents. Saving settings through the API with Documents enabled returns HTTP 409 / `project_sync_cloud_folder`.

The background round independently enforces the policy, including old stored settings. If no note or recording files are in scope, the file engine exits before scanning. Otherwise only those file-backed scopes are eligible; reviewed documents and calendar attachments do not broaden them. Access-revocation checks apply the same document restriction. The remote reconciliation checkpoint is not advanced while cloud document sharing is blocked, so moving the project to an ordinary local folder does not miss changes that arrived meanwhile.

## Real OneDrive verification

Environment: isolated GCloud Windows Server 2022 VM; Microsoft OneDrive **26.178.0913.0007**; Electron **43.7.5 / Node 24.21.0**. The reported customer OS was Windows 11 and was not tested directly.

The signed-in OneDrive account had 21 synthetic originals: ten in the registered Corporate project and eleven in an unregistered Litigation control. Availability was checked through metadata-only Windows Offline/RecallOnDataAccess attributes. The actual LegalWork desktop app and managed OpenCode engine ran in the interactive session. OneDrive's client and cloud were real; the Eigenwelt project-sharing endpoint was a **local synthetic HTTP service**, not production.

| Operation | Original documents downloaded | File-sharing requests |
| --- | ---: | --- |
| Released, unshared startup and restart | 0 / 21 | None |
| Released, initial shared startup | **10 / 21**, all in the registered project | 10 file commits |
| Released, evict and restart with saved baseline | 0 / 21 | No further file commits |
| Folder-policy fix, existing saved Documents=true | **0 / 21** | No file listing or commits |
| Folder-policy fix, warm restart | **0 / 21** | No file listing or commits |
| Folder-policy fix, explicitly read one document | **1 / 21**, only the deliberately read file | Still no file listing or commits |

The fixed desktop API returned Documents=false and the cloud-folder reason; attempts to enable it returned 409. Pending changes remained zero. The deliberately read file was not uploaded afterward, unlike the abandoned per-file deferral experiment.

The released shared startup began at 17:17:04 UTC; first hydration was observed at 17:17:17 UTC. No agent message was sent. Unshared startup also created 27 support files, about 3.4 MB, which OneDrive can upload; that is distinct from downloading original documents.

For the fixed Windows test, the compiled server modules were inserted into the release ASAR, using the official development Electron executable of the same version because the release executable validates its archive hash. This does not validate a newly packaged production installer. The sharing UI was exercised separately in a local browser fixture rendering the actual product component with cloud/local status responses: cloud Documents was disabled and off; ordinary local Documents remained enabled; Notes could still be changed. The fixture made no production sharing changes.

See [`evidence/onedrive`](../../evidence/onedrive) for machine-readable observations and the sharing-dialog screenshot. All fixture data and identifiers are synthetic.

### Repeat with a test account

1. Register one OneDrive folder as a LegalWork project; keep a second folder unregistered as a control. Use an isolated profile and a test sharing service/account.
2. Choose OneDrive's **Free up space**. Wait for the Offline/RecallOnDataAccess attributes; removing the pinned flag alone does not prove eviction is complete.
3. On 0.2.10, enable document sharing with an empty baseline and restart. Observe downloads without sending a prompt.
4. With the fix, restart with the old saved Documents=true setting. Expect no original downloads, file listing, uploads or deferred backlog.
5. Open sharing settings: Documents must be disabled/off with the Cloud Folder explanation. A direct API request enabling Documents must return 409.
6. Restart, then explicitly open one document. Only that file should download; it must remain excluded from Eigenwelt document sharing.
7. Check an ordinary local project: document sharing remains available. Check notes and review-result sharing separately; review source documents must stay excluded on a cloud project.

## Checks and remaining limits

- `pnpm exec bun test apps/server/src/cloud-folder.test.ts apps/server/src/project-file-sync.test.ts apps/server/src/project-sync.test.ts apps/server/src/project-review-sync.test.ts apps/server/src/file-storage/project-folders.test.ts` — 59 passed, 297 assertions.
- `pnpm --filter legalwork-server build` — passed.
- `pnpm --filter @legalwork/app typecheck` — passed.
- `pnpm --filter @legalwork/app test:i18n` — passed, 6832 keys in both shipped languages.
- `git diff --check` — passed.

The affected user's exact local project paths were not recorded in the production project records, so the reproduction confirms this mechanism rather than identifying every affected folder on his computer. Uploaded-row counts do not measure how many files were scanned or read. This path cannot explain unrelated folders downloading outside configured project roots. Other providers were not integration-tested.

The separate FFF-disable change does not affect this sharing scan. [OpenCode v1.18.29 already disables FFF by default on Windows](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/core/src/flag/flag.ts#L34).

# LegalWork for Raycast

An optional entry point into the same LegalWork Assistant: the panel, files, actions and conversations are the app's own. The extension never needs Raycast AI.

## Pairing

1. In LegalWork open Settings, Assistant launcher, and enable Raycast pairing.
2. LegalWork writes `launcher-pairing.json` into its application-support folder with the local server URL and a per-session token. Only your user account can read it; the token changes on every app start and the file is removed when pairing is disabled.
3. The commands read that file on every call. Launch URLs (`legalwork://assistant/...`) carry identifiers only; selected text travels over the paired loopback connection as a one-time staged context that expires after five minutes.

## Commands

- **Open LegalWork Assistant**: resume the current conversation, or pass a question.
- **Ask LegalWork with Selection**: stages the front app's selection and opens the Assistant with it attached.
- **Search LegalWork**: files, projects, chats, tasks and recordings with per-source coverage; open a result in LegalWork.
- **Run LegalWork Quick Action**: saved quick actions on the selection or clipboard.
- **LegalWork Work**: delegated work and what needs your decision.

A cold start is an ordinary launch URL; LegalWork queues the invocation and delivers it to the panel once it is ready. Repeated delivery of the same invocation does nothing twice.

## Development

```bash
pnpm install
pnpm --filter legalwork-raycast dev
```

The extension targets Raycast on macOS and Windows; `getSelectedText` and `open` are the only platform APIs it relies on.

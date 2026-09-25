# Contributing to ClawMuse

Thanks for helping. This guide covers setting up, the checks a change has to pass, and how releases
are cut.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems are
reported privately; see [SECURITY.md](SECURITY.md), not the issue tracker.

## Setting up

You need Node.js 22 and npm. A Mac is needed to package the app; everything else works on macOS,
Windows and Linux.

```bash
git clone https://github.com/PSA-Team-source/clawmuse.git
cd clawmuse
npm ci
npm run dev
```

`npm run dev` starts electron-vite with hot reload. On first launch the app installs the pinned
OpenClaw runtime into `~/.openclaw-clawmuse/runtime` and asks for a model if it cannot find one on
your machine. Your development copy uses the same `~/.openclaw-clawmuse` profile as an installed
ClawMuse.

## Before opening a pull request

Run the same checks CI runs:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

On a Mac, `npm run verify` adds the smoke test and the local end-to-end tests. Changes to the
runtime setup (`src/main/services/local-runtime`) should also pass `npm run test:e2e:pairing`, and
changes that affect a first run on a clean machine `npm run test:e2e:clean`.

Guidelines:

- **Keep pull requests focused.** One change per pull request, with a description of what it does
  and how you checked it. UI changes include a screenshot in light and dark mode.
- **Add a test with the logic.** Tests live next to the code in `__tests__` folders and run with
  Vitest.
- **Respect the IPC boundary.** The renderer never reaches Node. New channels go into
  `src/shared/ipc.ts` and are documented in [`docs/IPC.md`](docs/IPC.md).
- **Use the design tokens.** ESLint rejects hard-coded colours and sizes in the renderer; use the
  tokens in `src/renderer/src/design` and `global.css`.
- **Reuse OpenClaw.** ClawMuse drives the OpenClaw gateway rather than reimplementing it. If the
  runtime already has a command or a config key for something, use it.
- **Never commit credentials.** Keys belong in `.env.local` (gitignored) and never in the bundle:
  `npm run check:secrets` fails the build when a local key ends up in `out/`.

Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org) style used
in the history, for example `fix(chat): keep the draft when the gateway reconnects`.

## Reporting bugs and proposing features

Use the issue forms. For a bug, include the ClawMuse version (*Settings → About*), your OS and
architecture, and the relevant lines from the logs:

- App log: `~/Library/Logs/ClawMuse/main.log` on macOS, `%APPDATA%\ClawMuse\logs\main.log` on
  Windows.
- Gateway log: the command palette's **Open runtime log** command.

Remove API keys, tokens and personal data from anything you paste.

## Releasing

Releases are built by [`.github/workflows/release.yml`](.github/workflows/release.yml) when a tag
`v<version>` is pushed. The tag must match `version` in `package.json`.

```bash
npm version 1.1.0 --no-git-tag-version   # bump package.json and package-lock.json
git commit -am "chore(release): 1.1.0"
git tag v1.1.0
git push origin main v1.1.0
```

The workflow:

1. builds the macOS DMG and ZIP for arm64 and x64 on a macOS runner;
2. builds the NSIS installers for x64 and arm64 on a Windows runner;
3. publishes a GitHub Release with the installers, the updater manifests (`latest-mac.yml`,
   `latest.yml`), the blockmaps and `SHA256SUMS.txt`.

Running it from the Actions tab (*Run workflow*) builds everything and keeps the files as workflow
artifacts without publishing a release, which is the way to test a signing setup.

### Signing secrets

Signing is optional. Each platform is signed only when its secrets are set; otherwise the build is
unsigned and the macOS app is ad-hoc signed by `scripts/after-sign.mjs`, which makes it open
through *Open Anyway* rather than being reported as damaged.

Add these under *Settings → Secrets and variables → Actions → Secrets*:

**macOS: Developer ID signing and notarization**

| Secret | Value |
|---|---|
| `CSC_LINK` | The **Developer ID Application** certificate with its private key, exported as `.p12` and base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | The password of that `.p12` |
| `APPLE_ID` | The Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID (appleid.apple.com → Sign-In and Security), not the account password |
| `APPLE_TEAM_ID` | The 10-character Team ID |

With `CSC_LINK` alone the app is signed but not notarized. Notarization runs when all five are
set. Only the Account Holder of an Apple Developer team can create a Developer ID Application
certificate.

**Windows, option A: Azure Trusted Signing** (preferred)

| Secret | Value |
|---|---|
| `AZURE_TENANT_ID` | Microsoft Entra tenant of the app registration |
| `AZURE_CLIENT_ID` | Client ID of an app registration with the *Trusted Signing Certificate Profile Signer* role |
| `AZURE_CLIENT_SECRET` | A client secret of that app registration |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | The account's region endpoint, e.g. `https://eus.codesigning.azure.net` |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | The Trusted Signing account name |
| `AZURE_TRUSTED_SIGNING_PROFILE` | The certificate profile name |
| `AZURE_TRUSTED_SIGNING_PUBLISHER` | The publisher name, exactly the certificate's subject CN |

**Windows, option B: a code-signing certificate file**

| Secret | Value |
|---|---|
| `WIN_CSC_LINK` | The `.pfx` certificate, base64-encoded |
| `WIN_CSC_KEY_PASSWORD` | Its password |

Azure Trusted Signing is used when all of its secrets are set; otherwise `WIN_CSC_LINK` is used
when set.

### After a release

The stable download links on clawmuse.app (`/download/mac-arm64`, `/download/mac-x64`,
`/download/windows-x64`, `/download/windows-arm64`) are redirects maintained with the website;
point them at the new release assets.

Before announcing, install the way a user does: download the DMG, drag the app to Applications and
open it from Finder, and run the Windows installer from Explorer. Running a binary from a shell
bypasses Gatekeeper and SmartScreen and proves nothing about what users will see.

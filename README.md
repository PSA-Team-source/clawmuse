<p align="center">
  <img src="resources/icon.png" alt="" width="96" height="96">
</p>

<h1 align="center">ClawMuse</h1>

<p align="center">
  <strong>Your personal AI, on your own computer.</strong><br>
  A desktop assistant for macOS and Windows that reads the news around your goals,
  suggests what to do next, and does the work with the files and tools on your machine.
  No account, no ClawMuse server, no analytics.
</p>

<p align="center">
  <a href="https://github.com/PSA-Team-source/clawmuse/actions/workflows/ci.yml"><img src="https://github.com/PSA-Team-source/clawmuse/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT licence"></a>
  <a href="https://clawmuse.app"><img src="https://img.shields.io/badge/site-clawmuse.app-FF5A4E.svg" alt="clawmuse.app"></a>
</p>

<p align="center">
  <img src="site/public/img/feed.webp" alt="The ClawMuse Feed: stories about the user's goal, each with its sources and picture" width="880">
</p>

## Download

| Platform | Installer |
|---|---|
| macOS 12+, Apple silicon (M1 and later) | [ClawMuse for Mac (Apple silicon)](https://clawmuse.app/download/mac-arm64) |
| macOS 12+, Intel | [ClawMuse for Mac (Intel)](https://clawmuse.app/download/mac-x64) |
| Windows 10/11, x64 | [ClawMuse for Windows (x64)](https://clawmuse.app/download/windows-x64) |
| Windows 10/11, ARM64 | [ClawMuse for Windows on ARM](https://clawmuse.app/download/windows-arm64) |

Every release, with its `SHA256SUMS.txt`, is also on the
[Releases page](https://github.com/PSA-Team-source/clawmuse/releases).

**First open.** Until releases carry an Apple Developer ID and a Windows code-signing
certificate, the operating system asks you to confirm once:

- **macOS**: if macOS says it cannot check the app for malware, open *System Settings → Privacy &
  Security* and click **Open Anyway**.
- **Windows**: if SmartScreen appears, click **More info → Run anyway**. The installer is per-user
  and needs no administrator rights.

The first launch downloads the [OpenClaw](https://github.com/openclaw/openclaw) runtime ClawMuse
runs on (a pinned release, once), using the Node.js built into the app and an npm that ships inside
it. No Node, Homebrew or terminal is needed on your side.

## What it does

<table>
<tr>
<td width="50%"><img src="site/public/img/welcome.webp" alt="ClawMuse asks: What are you working toward?"></td>
<td width="50%"><img src="site/public/img/ideas.webp" alt="ClawMuse Ideas tailored to the user's goal"></td>
</tr>
<tr>
<td><strong>Goals first.</strong> ClawMuse asks what you are working toward. The Feed, the Ideas and
the moments it speaks up are all shaped by the answer.</td>
<td><strong>Ideas.</strong> Concrete things it can do next, such as a roadmap, a competitor scan or
a tracker, written for your situation. One click starts one.</td>
</tr>
</table>

<p align="center">
  <img src="site/public/img/chat.webp" alt="ClawMuse chat planning the user's week" width="880">
</p>

- **A daily Feed.** A short edition of real news that matters to your goals, each story with its
  sources.
- **Chat that gets things done.** It researches, writes, plans and keeps track, using the files,
  shell and managed browser on your computer. Quick Chat opens from anywhere with <kbd>Alt</kbd>+<kbd>Space</kbd>.
- **Check-ins that respect you.** It messages first only when it has something specific, within
  your hours, and never mid-conversation.
- **Skills and routines.** Write or edit skills in the built-in studio; anything done more than
  once can become a scheduled task that reports back into the same conversation.
- **Teach a task.** Record your own browsing; a bot turns the trail into a draft skill you review
  before it goes live.
- **Approvals.** A bot stops and asks before anything irreversible. Per-bot tool limits are
  enforced by the runtime.
- **Channels.** Reach your assistant from Telegram or Discord as well as the app.
- **Bring your own model.** Uses a signed-in Claude Code, an Anthropic, OpenAI, OpenRouter or Z.ai
  key, or a local [Ollama](https://ollama.com) / [LM Studio](https://lmstudio.ai). On first launch
  it looks for a credential this computer already has and tells you which file it found it in.

## What leaves your machine

1. **Your messages go to the model provider you chose**, under your own key and their terms,
   unless the model runs locally, in which case nothing leaves.
2. **When a bot browses or calls a connector**, it reaches that site the way your browser would.
3. **First launch downloads the OpenClaw runtime** from the npm registry, at a pinned version.
4. **The Feed looks up headlines**: short search terms drawn from your goals go to Bing News
   (Google News as the fallback).

There is no analytics, no crash reporting and no update check unless a distributor builds with
`CLAWMUSE_UPDATE_FEED` set. Deleting `~/.openclaw-clawmuse` deletes everything, and *Settings → Data
controls → Remove ClawMuse* does that for you.

## How it works

ClawMuse is an Electron app that drives a local [OpenClaw](https://docs.openclaw.ai) gateway. It
does not reimplement the agent runtime: it installs a pinned `openclaw` CLI into a private prefix,
writes the gateway configuration, and talks to the gateway over a loopback WebSocket.

```
 ┌──────────────────────── ClawMuse (Electron) ────────────────────────┐
 │  renderer  React 19 · Zustand · TanStack Query · three.js           │
 │     │  window.clawmuse.*  (contextBridge; typed in src/shared/ipc)  │
 │  preload                                                            │
 │     │  ipcMain                                                      │
 │  main      runtime manager · secure store (OS keychain) · tray ·    │
 │            shortcuts · notifications · deep links (clawmuse://)     │
 └─────┬───────────────────────────────────────────────────────────────┘
       │  ws://127.0.0.1:<port>  (gateway token + Ed25519 device identity)
       ▼
 openclaw gateway   profile "clawmuse", state in ~/.openclaw-clawmuse
   macOS:   a launchd LaunchAgent, so agents keep working after you quit the app
   Windows: `openclaw gateway run`, supervised by the app with restart backoff
       ├── agents     one per bot: own memory, instructions and tool limits
       ├── cron       scheduled tasks
       ├── skills     SKILL.md files
       └── tools      files, shell (exec), a managed browser profile, MCP connectors
```

| Concept | Where it lives |
|---|---|
| A bot | an OpenClaw agent in `agents.list[]` of `~/.openclaw-clawmuse/openclaw.json` |
| Its guidelines | `AGENTS.md` in the bot's private workspace, `~/.openclaw-clawmuse/bots/<id>` |
| Memory, auth, transcripts | its own `agentDir`, `~/.openclaw-clawmuse/agents/<id>` |
| What it may do | a per-agent `tools.deny` list, enforced by the gateway |
| Provider keys | `~/.openclaw-clawmuse/.env` (never inside the app bundle) |
| App secrets | encrypted with Electron `safeStorage` (the macOS Keychain, DPAPI on Windows) |

Source layout:

| Path | Contents |
|---|---|
| `src/main` | Electron main process; `services/local-runtime` installs, configures and supervises the gateway |
| `src/preload` | the `window.clawmuse` bridge |
| `src/renderer` | the React UI (`routes/`, `features/`, `stores/`, `design/`) |
| `src/shared` | the IPC contract shared by main and renderer ([`docs/IPC.md`](docs/IPC.md)) |
| `native` | the macOS key monitor used by push-to-talk (Swift, built by `scripts/build-native.mjs`) |
| `scripts` | packaging hooks, smoke and end-to-end tests |

## Build from source

Requirements: **Node.js 22** and npm. Development, tests and `npm run build` work on macOS,
Windows and Linux. Packaging runs on a Mac: the Command Line Tools are enough, and full Xcode 26
adds the layered macOS 26 icon. The release workflow also builds and signs the Windows installers
on Windows runners.

```bash
git clone https://github.com/PSA-Team-source/clawmuse.git
cd clawmuse
npm ci

npm run dev           # run the app with hot reload
npm run typecheck     # TypeScript, main and renderer
npm run lint          # ESLint
npm test              # Vitest unit tests
npm run build         # production bundle in out/
```

Packaging:

```bash
npm run pack:dir      # unpacked app in dist/ (fastest way to try a packaged build)
npm run dist:mac      # DMG + ZIP, arm64 and x64
npm run dist:win      # NSIS installers, x64 and arm64
```

A build without a Developer ID is ad-hoc signed by `scripts/after-sign.mjs`, so it opens through
**Open Anyway** instead of being reported as damaged. Signed and notarized releases are produced by
the [release workflow](.github/workflows/release.yml); see [CONTRIBUTING.md](CONTRIBUTING.md#releasing).

## Limits

- **The agents run on your real machine.** Approvals and per-bot tool limits are real, but a bot
  with file and shell access has file and shell access. Give each bot the narrowest permissions
  that let it do its job.
- **An approval covers the action being proposed.** Anything already done stays done; there is no
  undo.
- **Teach a task records a trail of pages, not clicks.** The draft skill infers the steps and says
  what it inferred.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report
security problems privately as described in [SECURITY.md](SECURITY.md). Everyone taking part is
expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

MIT, see [LICENSE](LICENSE). Built on [OpenClaw](https://github.com/openclaw/openclaw) (MIT).

# The IPC contract

The single source of truth is [`src/shared/ipc.ts`](../src/shared/ipc.ts). Both main and renderer
import from it, so renaming a channel breaks typecheck on both sides instead of failing silently at
runtime.

## Security model

```
Renderer  ──window.clawmuse.*──▶  preload (contextBridge)  ──ipcRenderer──▶  main
   ▲                                                                         │
   └────────────────  callback with the event stripped  ◀─── webContents.send ┘
```

- `contextIsolation: true`, `nodeIntegration: false` — the renderer cannot reach Node.
- Every listener wrapper in preload **deliberately drops** the `IpcRendererEvent` argument. Handing
  it to renderer code leaks `event.sender`, i.e. a live `ipcRenderer` handle, defeating context
  isolation.
- `secure:*` only accepts keys in `SECURE_KEYS`. The renderer cannot make main write arbitrary
  files.
- `shell:open-external` only allows `http:`/`https:`. Otherwise a compromised renderer could force
  any local handler to open.
- `webviewTag: false`, and `will-attach-webview` is blocked app-wide.
- `will-navigate` blocks navigation away from the app's origin; external links go to the real
  browser.

## Invoke channels (renderer → main, with a return value)

| Channel | In | Out | Notes |
|---|---|---|---|
| `app:info` | — | `AppInfo` | version, platform, arch, isDev, isDarkMode |
| `app:set-badge` | `number` | — | Dock badge: pending approvals |
| `secure:available` | — | `boolean` | `false` ⇒ the Keychain is unusable |
| `secure:get` | `SecureKey` | `string \| null` | Undecryptable ciphertext is **deleted** and returns `null` (Keychain reset / new machine) |
| `secure:set` | `{ key, value }` | — | Throws if the Keychain is unavailable — it does **not** fall back to plaintext |
| `secure:delete` | `SecureKey` | — | |
| `window:open` | `'main' \| 'quick-chat'` | — | |
| `window:close-self` | — | — | The quick panel **hides** (keeping the React tree alive); ordinary windows close |
| `window:minimize` / `window:toggle-maximize` / `window:set-always-on-top` | | | |
| `shell:open-external` | `string` | — | http(s) only |
| `notify:show` | `NotifyPayload` | — | Clicking deep-links to `route` |
| `updater:check` / `updater:install` | — | — | |
| `shortcut:get` | — | `string` | The current accelerator |
| `shortcut:set` | `string` | `boolean` | `false` = another app holds the combination |
| `runtime:mode-get` | — | `RuntimeMode` \| `null` | `null` = never chosen → route to `/choose-mode`. **Distinct** from a stored `'local'` |
| `runtime:mode-set` | `RuntimeMode` | — | Writes `userData/runtime-mode.json`. Not localStorage: signing out would wipe it |
| `runtime:status` | — | `LocalRuntimeStatus` | Current state; triggers nothing |
| `runtime:ensure` | — | `LocalRuntimeStatus` | Idempotent; attaches if a gateway is already running |
| `runtime:restart` | — | `LocalRuntimeStatus` | `gateway restart --safe` (drains in-flight work first) |
| `runtime:stop` | — | — | Explicit Settings action only; quitting the app does **not** call this |
| `runtime:credentials` | — | `{port,token,wsUrl}` \| `null` | So the renderer can open its own WS |
| `runtime:device-sign` | `DeviceSignRequest` | `DeviceSignature` | **The private key is never returned** |
| `runtime:handshake-failed` | `HandshakeFailureReport` | `HandshakeFailureOutcome` | Logs WS failures to `main.log`; approves **this machine's own device** on `pairing-required` |
| `runtime:logs` / `runtime:open-logs` | — | `RuntimeLogs` / — | `~/Library/Logs/openclaw/gateway-clawmuse.log` |
| `runtime:resolution` | — | `OpenclawResolution` \| `null` | Which binary is in use and where it came from |
| `runtime:node-check` | — | `NodeCheck` | The child process's Node, not Electron's |
| `runtime:detect-providers` | — | `DetectedLocalProvider[]` | Probes Ollama / LM Studio on loopback |
| `runtime:apply-provider` | `ProviderChoice` | — | Key → `.env`, wiring → `openclaw.json` |
| `runtime:provider-configured` | — | `boolean` | The onboarding gate |

### Additional event channel

| Channel | Payload | Listener |
|---|---|---|
| `runtime-status` | `LocalRuntimeStatus` | `runtime.store` → the boot/onboarding screens |

### The `fs:*` channels — why none of them takes an absolute path

| Channel | In | Out |
|---|---|---|
| `fs:roots` / `fs:add-root` | — | `FsRoot[]` / `FsRoot \| null` (opens the native folder picker) |
| `fs:list` / `fs:read` | `{rootId, path}` | `FsEntry[]` / `FsReadResult` |
| `fs:write` | `{rootId, path, content}` | — |
| `fs:mkdir` / `fs:delete` / `fs:reveal` | `{rootId, path}` | — |
| `fs:rename` | `{rootId, from, to}` | — |

`path` is **always relative** to `rootId`. That is a type constraint, not a convention: no channel
exists that accepts an absolute path, so there is nothing to traverse out of. Main also `realpath`s
every resolved path and re-checks the root prefix — `resolve()` handles `../`, but only `realpath`
sees through a symlink that lives inside the workspace and points at `/`. Both attacks have tests.

### Why `runtime:device-sign` is separate from `runtime:credentials`

The gateway token can cross IPC: it is only meaningful on loopback and the renderer needs it to open
the socket. The Ed25519 private key **cannot** — it is the device identity, bound to the gateway's
pairing record. So the renderer sends a nonce and receives exactly one signature; no channel returns
the key.

### Why `runtime:handshake-failed` does **not** take a `requestId`

This channel approves a device pairing request — an operation that grants `operator.admin` scope. If
it accepted a `requestId` from the renderer, any code running in the renderer could rubber-stamp an
unrelated client waiting in the queue (precisely what the manual `openclaw devices approve <id>`
workaround does).

So the renderer only describes **the failure it saw**; main looks up the list itself and approves
only the record matching both the `deviceId` **and** the public key of the private key main holds.
No renderer-supplied parameter influences which record is chosen.

## Event channels (main → renderer)

| Channel | Payload | Listener |
|---|---|---|
| `deeplink` | `string` | `useDeepLinks()` |
| `update-status` | `UpdateStatus` | The About screen |
| `menu-command` | `MenuCommand` | `useMenuCommands()` in `AppShell` |
| `system-theme-changed` | `boolean` | (reserved — the app is dark-only today) |

## One-way channels (renderer → main, `ipcRenderer.send`)

| Channel | Payload | Effect |
|---|---|---|
| `renderer:ready` | — | Replays buffered deep links + update status |
| `renderer:connection-state` | `string` | Updates the label in the tray menu |

## Secret storage

`safeStorage` only encrypts and decrypts; it does **not** store. Storage is ours:

```
~/Library/Application Support/ClawMuse/secure/
  access_token.bin     (0600)   ciphertext of the JWT
  refresh_token.bin    (0600)   ciphertext of the sandbox record (which holds gateway_token)
```

The directory is created `0700`. Only ciphertext reaches disk — the key lives in the macOS Keychain.

> The `refresh_token` slot holds the **sandbox record**, not an OAuth refresh token. The backend
> issues no refresh token to this client; the sandbox record embeds `gateway_token`, so it must be
> encrypted, and reusing an existing slot avoids widening the IPC surface.

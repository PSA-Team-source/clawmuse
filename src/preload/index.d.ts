import type { ClawMuseBridge } from './index'

declare global {
  interface Window {
    /** Injected by `src/preload/index.ts` via `contextBridge`. */
    clawmuse: ClawMuseBridge
  }
}

export {}

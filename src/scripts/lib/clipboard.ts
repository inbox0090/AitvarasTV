// Cross-platform clipboard write.
//
// Tauri build: routes through `@tauri-apps/plugin-clipboard-manager`,
// which calls the OS clipboard API directly (Windows / macOS / Linux
// via `arboard`, Android via `ClipboardManager`, iOS via
// `UIPasteboard`). Bypasses the WebView's user-gesture and
// permission-prompt restrictions, which is the reason `navigator.clipboard`
// is unreliable in mobile WebViews.
//
// Web build (or any context without a Tauri runtime): falls back to
// `navigator.clipboard.writeText`. Browser policy requires this to run
// inside a user-gesture handler; the existing call sites (button
// onClick, right-click menu) satisfy that.

import { log } from "@/scripts/lib/log.js"

const isTauri =
  typeof window !== "undefined" &&
  (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri) {
    try {
      const mod = await import("@tauri-apps/plugin-clipboard-manager")
      await mod.writeText(text)
      return
    } catch (err) {
      log.warn("[xt:clipboard] tauri write failed, falling back to navigator:", err)
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  throw new Error("clipboard write unavailable")
}

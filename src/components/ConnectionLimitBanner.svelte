<script>
  // Provider connection-limit banner shown inside the Downloads card.
  // Hidden when the cap is unknown (M3U source or cold cache); otherwise
  // tints border + background + dot per level, so the warning isn't
  // hue-only.
  //
  // Refreshes on `xt:active-changed` (switching playlists) and on
  // `USER_INFO_LOADED_EVENT` (user_info hydrated by the Downloads card's
  // own `refreshUserInfoForActive`).
  import { onMount } from "svelte"
  import { t, LOCALE_EVENT } from "@/scripts/lib/i18n.js"
  import {
    getConnectionLimitWarning,
    USER_INFO_LOADED_EVENT,
  } from "@/scripts/lib/account-info.js"

  let warning = $state(readWarning())
  let locale = $state(0)
  const tr = (key, params) => (locale, t(key, params))

  function readActivePlaylistId() {
    try {
      const raw = localStorage.getItem("xt_playlists") || '{"selectedId":""}'
      return JSON.parse(raw)?.selectedId || ""
    } catch {
      return ""
    }
  }

  function readWarning() {
    return getConnectionLimitWarning(readActivePlaylistId())
  }

  const TINTS = {
    ok:   { border: "border-line",     bg: "bg-surface-2/40", dot: "bg-fg-3", label: "text-fg" },
    warn: { border: "border-warn/40",  bg: "bg-warn/5",       dot: "bg-warn", label: "text-warn" },
    crit: { border: "border-bad/40",   bg: "bg-bad/10",       dot: "bg-bad",  label: "text-bad" },
  }
  const LABEL_KEY = {
    ok: "settings.connectionLimit.ok",
    warn: "settings.connectionLimit.warn",
    crit: "settings.connectionLimit.crit",
  }

  onMount(() => {
    const refresh = () => { warning = readWarning() }
    const onLocale = () => { locale++ }
    document.addEventListener(USER_INFO_LOADED_EVENT, refresh)
    document.addEventListener("xt:active-changed", refresh)
    document.addEventListener(LOCALE_EVENT, onLocale)
    return () => {
      document.removeEventListener(USER_INFO_LOADED_EVENT, refresh)
      document.removeEventListener("xt:active-changed", refresh)
      document.removeEventListener(LOCALE_EVENT, onLocale)
    }
  })
</script>

{#if warning}
  {@const tint = TINTS[warning.level]}
  <div
    class="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-xs transition-colors {tint.border} {tint.bg}"
    role="status"
    aria-live="polite">
    <span class="flex items-center gap-2">
      <span class="size-2.5 rounded-full shrink-0 {tint.dot}" aria-hidden="true"></span>
      <span class="font-medium {tint.label}">{tr(LABEL_KEY[warning.level])}</span>
    </span>
    <span class="text-fg-3 leading-relaxed">
      {tr("settings.connectionLimit.detail", {
        current: String(warning.currentCons),
        max: String(warning.maxCons),
      })}
    </span>
  </div>
{/if}

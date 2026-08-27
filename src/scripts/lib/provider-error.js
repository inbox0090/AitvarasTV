import { t } from "@/scripts/lib/i18n.js"

/**
 * Classify a failed provider call into a discrete reason so the UI can pick
 * actionable copy. Returns one of:
 *   - "unreachable"     - DNS / refused / timeout, no response came back
 *   - "timeout"         - request was aborted by the caller's signal
 *   - "cors"            - browser blocked the response on cross-origin grounds
 *   - "auth_rejected"   - server answered but rejected the credentials
 *                         (HTTP 401/403, or Xtream `user_info.auth === 0`)
 *   - "not_found"       - HTTP 404
 *   - "rate_limited"    - HTTP 429
 *   - "server_error"    - HTTP 5xx
 *   - "http_error"      - any other non-OK HTTP status
 *   - "bad_response"    - 2xx but body wasn't parseable / didn't have the
 *                         expected shape (parse failed, not JSON, etc.)
 *   - "unknown"         - couldn't pin it down; `raw` carries the original
 *                         message so the UI can surface it as a fallback
 *
 * Pure data - no i18n. Callers translate via `t("providerError.classify."
 * + kind)`, passing `{status: result.httpStatus}` when set.
 *
 * @param {object} input
 * @param {unknown} [input.error]      Caught error (TypeError, AbortError, etc.).
 * @param {Response} [input.response]  Response from the failed call.
 * @param {number} [input.httpStatus]  Explicit HTTP status (overrides response.status).
 * @param {object} [input.payload]     Parsed response body, used to detect Xtream auth=0.
 * @returns {{ kind: string, httpStatus?: number, raw?: string }}
 */
export function classifyError({ error, response, httpStatus, payload } = {}) {
  const status = httpStatus ?? response?.status

  if (payload && typeof payload === "object") {
    const auth = payload?.user_info?.auth
    if (auth === 0 || auth === "0") {
      return { kind: "auth_rejected" }
    }
  }

  if (status != null) {
    if (status === 401 || status === 403) return { kind: "auth_rejected", httpStatus: status }
    if (status === 404) return { kind: "not_found", httpStatus: status }
    if (status === 429) return { kind: "rate_limited", httpStatus: status }
    if (status >= 500 && status < 600) return { kind: "server_error", httpStatus: status }
    if (status >= 400 && status < 600) return { kind: "http_error", httpStatus: status }
  }

  if (error) {
    const name = (error?.name || "").toString()
    const message = (error?.message || error || "").toString()
    if (name === "AbortError" || /timeout|timed out/i.test(message)) {
      return { kind: "timeout", raw: message }
    }
    if (/cors|access-control|cross-?origin/i.test(message)) {
      return { kind: "cors", raw: message }
    }
    // TypeError "Failed to fetch" / "Load failed" / "NetworkError when attempting to fetch resource"
    if (name === "TypeError" || /failed to fetch|load failed|networkerror|fetch failed/i.test(message)) {
      return { kind: "unreachable", raw: message }
    }
    if (/json|parse|unexpected (token|end)/i.test(message)) {
      return { kind: "bad_response", raw: message }
    }
    return { kind: "unknown", raw: message.slice(0, 200) }
  }

  return { kind: "unknown" }
}

/**
 * Translate a classifyError() result into a user-facing string. Centralises the
 * key lookup so callers don't repeat the `providerError.classify.<kind>` shape.
 *
 * @param {{ kind: string, httpStatus?: number, raw?: string }} classified
 * @returns {string}
 */
export function describeClassifiedError(classified) {
  if (!classified || !classified.kind) return t("providerError.classify.unknown")
  const key = `providerError.classify.${classified.kind}`
  const params = classified.httpStatus != null ? { status: String(classified.httpStatus) } : {}
  return t(key, params)
}

const SIGNAL_ART = `
<svg viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M48 64v8" />
  <path d="M40 78l8 -6 8 6" opacity=".55" />
  <path d="M40 50a12 12 0 0 1 16 0" opacity=".7" />
  <path d="M32 42a24 24 0 0 1 32 0" opacity=".5" />
  <path d="M24 34a36 36 0 0 1 48 0" opacity=".3" />
</svg>
`

function fmtTime(d = new Date()) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(d)
  } catch {
    return ""
  }
}

const KIND_KEY = {
  channels: "providerError.kind.channels",
  movies: "providerError.kind.movies",
  series: "providerError.kind.series",
  EPG: "providerError.kind.epg",
  content: "providerError.kind.content",
}

/**
 * @param {HTMLElement|null} statusEl  The status container to render into.
 * @param {object}   opts
 * @param {string}  [opts.providerName]  Active playlist title; falls back to "this provider".
 * @param {string}  [opts.kind="content"]   "channels" | "movies" | "series" | "EPG" | "content"
 * @param {() => any} opts.onRetry          Re-runs the loader.
 * @param {string}  [opts.detail]           Optional secondary line (e.g. error.message).
 */
export function renderProviderError(statusEl, opts) {
  if (!statusEl) return
  const provider = (opts?.providerName || "").trim() || t("providerError.fallback")
  const kind = opts?.kind || "content"
  const noun = t(KIND_KEY[kind] || KIND_KEY.content)
  const onRetry = typeof opts?.onRetry === "function" ? opts.onRetry : () => {}

  statusEl.replaceChildren()
  statusEl.classList.add("provider-error-host")

  const wrap = document.createElement("section")
  wrap.setAttribute("role", "alert")
  wrap.setAttribute("aria-live", "polite")
  wrap.className = "provider-error"

  const art = document.createElement("div")
  art.className = "provider-error__art"
  art.innerHTML = SIGNAL_ART
  wrap.appendChild(art)

  const copy = document.createElement("div")
  copy.className = "provider-error__copy"

  const title = document.createElement("h2")
  title.className = "provider-error__title"
  title.textContent = t("providerError.title", { provider })

  const sub = document.createElement("p")
  sub.className = "provider-error__sub"
  sub.textContent = t("providerError.sub", { noun })

  copy.append(title, sub)
  wrap.appendChild(copy)

  if (opts?.detail) {
    const detail = document.createElement("p")
    detail.className = "provider-error__detail"
    detail.textContent = String(opts.detail)
    wrap.appendChild(detail)
  }

  const meta = document.createElement("p")
  meta.className = "provider-error__meta"
  const lastTime = fmtTime()
  meta.innerHTML = lastTime
    ? `<span class="provider-error__meta-dot" aria-hidden="true"></span>${t("providerError.lastTried")} <time>${lastTime}</time>`
    : ""
  wrap.appendChild(meta)

  const actions = document.createElement("div")
  actions.className = "provider-error__actions"

  const retryBtn = document.createElement("button")
  retryBtn.type = "button"
  retryBtn.className = "provider-error__retry"
  retryBtn.innerHTML =
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>` +
    `<span class="provider-error__retry-label">${t("providerError.tryAgain")}</span>`
  retryBtn.addEventListener("click", () => {
    if (retryBtn.disabled) return
    retryBtn.disabled = true
    wrap.classList.add("provider-error--retrying")
    const label = retryBtn.querySelector(".provider-error__retry-label")
    if (label) label.textContent = t("providerError.retrying")
    try {
      Promise.resolve(onRetry()).finally(() => {
        if (retryBtn.isConnected) {
          retryBtn.disabled = false
          wrap.classList.remove("provider-error--retrying")
          if (label) label.textContent = t("providerError.tryAgain")
        }
      })
    } catch {
      retryBtn.disabled = false
      wrap.classList.remove("provider-error--retrying")
      if (label) label.textContent = t("providerError.tryAgain")
    }
  })

  const settingsLink = document.createElement("a")
  settingsLink.href = "/settings"
  settingsLink.className = "provider-error__settings"
  settingsLink.textContent = t("providerError.checkSettings")

  actions.append(retryBtn, settingsLink)
  wrap.appendChild(actions)

  statusEl.appendChild(wrap)
}

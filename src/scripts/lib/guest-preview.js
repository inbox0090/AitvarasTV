const state = {
  ready: false,
  guest: false,
  enabled: true,
  durationMs: 30_000,
  locked: false,
  modal: null,
}
const timers = new WeakMap()

const currentPath = () => `${window.location.pathname}${window.location.search}`
const makeButton = (label, href, className) => {
  const link = document.createElement("a")
  link.textContent = label
  link.href = href
  link.className = className
  return link
}

function showPlanModal() {
  if (state.modal) return
  const backdrop = document.createElement("div")
  backdrop.className = "guest-preview-modal"
  backdrop.setAttribute("role", "dialog")
  backdrop.setAttribute("aria-modal", "true")
  backdrop.setAttribute("aria-labelledby", "guest-preview-title")

  const card = document.createElement("section")
  card.className = "guest-preview-modal__card"
  const eyebrow = document.createElement("p")
  eyebrow.className = "guest-preview-modal__eyebrow"
  eyebrow.textContent = "PREVIEW ENDED"
  const title = document.createElement("h2")
  title.id = "guest-preview-title"
  title.textContent = "Choose a plan to keep watching."
  const copy = document.createElement("p")
  copy.textContent = "Your free preview has ended. Sign in or choose a channel plan to continue watching Live TV, Movies, TV Shows, and Series."
  const actions = document.createElement("div")
  actions.className = "guest-preview-modal__actions"
  actions.append(
    makeButton("Choose a plan", `/auth?mode=register&next=${encodeURIComponent(currentPath())}`, "guest-preview-modal__primary"),
    makeButton("Sign in", `/auth?next=${encodeURIComponent(currentPath())}`, "guest-preview-modal__secondary"),
  )
  const later = document.createElement("button")
  later.type = "button"
  later.className = "guest-preview-modal__later"
  later.textContent = "Maybe later"
  later.addEventListener("click", () => {
    backdrop.remove()
    state.modal = null
  })
  card.append(eyebrow, title, copy, actions, later)
  backdrop.append(card)
  document.body.append(backdrop)
  state.modal = backdrop
  card.querySelector("a")?.focus()
}

function stopMedia(media) {
  try { media.pause() } catch {}
  try {
    media.removeAttribute("src")
    media.load()
  } catch {}
}

function finishPreview() {
  if (state.locked) return
  state.locked = true
  document.querySelectorAll("video, audio").forEach((media) => {
    const timer = timers.get(media)
    if (timer) {
      clearTimeout(timer.timeout)
      timers.delete(media)
    }
    stopMedia(media)
  })
  document.dispatchEvent(new CustomEvent("xt:guest-preview-ended"))
  showPlanModal()
}

function schedule(media) {
  const existing = timers.get(media)
  if (existing) return
  const remainingMs = Math.max(0, media.__xtGuestPreviewRemainingMs ?? state.durationMs)
  if (remainingMs <= 0) return finishPreview()
  const startedAt = performance.now()
  const timeout = window.setTimeout(() => {
    media.__xtGuestPreviewRemainingMs = 0
    timers.delete(media)
    finishPreview()
  }, remainingMs)
  timers.set(media, { timeout, startedAt, remainingMs })
}

function pauseTimer(media) {
  const timer = timers.get(media)
  if (!timer) return
  clearTimeout(timer.timeout)
  const elapsed = performance.now() - timer.startedAt
  media.__xtGuestPreviewRemainingMs = Math.max(0, timer.remainingMs - elapsed)
  timers.delete(media)
}

async function initialise() {
  try {
    const [meResponse, policyResponse] = await Promise.all([
      fetch("/api/auth/me", { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" }),
      fetch("/api/guest-preview-policy", { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" }),
    ])
    const access = meResponse.ok ? await meResponse.json() : { role: "guest", authenticated: false }
    const policy = policyResponse.ok ? await policyResponse.json() : { enabled: true, durationSeconds: 30 }
    state.guest = access?.authenticated !== true && access?.role !== "admin"
    state.enabled = policy?.enabled !== false
    const seconds = Number(policy?.durationSeconds)
    state.durationMs = Number.isFinite(seconds) ? Math.max(0, Math.min(86400, seconds) * 1000) : 30_000
  } catch {
    // Fail closed for media preview; the server still controls page access.
    state.guest = true
    state.enabled = true
    state.durationMs = 30_000
  }
  state.ready = true
  if (state.guest) {
    document.querySelectorAll("video, audio").forEach((media) => {
      if (media instanceof HTMLMediaElement && !media.paused) {
        if (!state.enabled) finishPreview()
        else {
          if (media.__xtGuestPreviewRemainingMs == null) media.__xtGuestPreviewRemainingMs = state.durationMs
          schedule(media)
        }
      }
    })
  }
}

document.addEventListener("play", (event) => {
  const media = event.target
  if (!(media instanceof HTMLMediaElement) || !state.ready || !state.guest) return
  if (!state.enabled) {
    event.preventDefault()
    finishPreview()
    return
  }
  if (state.locked) {
    event.preventDefault()
    stopMedia(media)
    showPlanModal()
    return
  }
  if (media.__xtGuestPreviewRemainingMs == null) media.__xtGuestPreviewRemainingMs = state.durationMs
  schedule(media)
}, true)
document.addEventListener("pause", (event) => {
  const media = event.target
  if (media instanceof HTMLMediaElement && state.guest) pauseTimer(media)
}, true)
document.addEventListener("ended", (event) => {
  const media = event.target
  if (media instanceof HTMLMediaElement) {
    const timer = timers.get(media)
    if (timer) clearTimeout(timer.timeout)
    timers.delete(media)
  }
}, true)

document.addEventListener("xt:guest-preview-reset", () => {
  state.locked = false
  state.modal?.remove()
  state.modal = null
  document.querySelectorAll("video, audio").forEach((media) => {
    delete media.__xtGuestPreviewRemainingMs
  })
})

void initialise()

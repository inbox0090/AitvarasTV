export const SETTINGS_POLICY_EVENT = "xt:settings-policy"

// Fail-open default keeps the existing client behaviour intact if the admin
// service is unavailable or the app is opened as a standalone static build.
export const DEFAULT_SETTINGS_POLICY = Object.freeze({
  enabled: true,
  features: Object.freeze({
    playlists: true,
    "appearance.display": true,
    "appearance.behavior": true,
    "appearance.homeSections": true,
    "watching.liveTv": true,
    "watching.playback": true,
    "network.network": true,
    "network.discord": true,
    "network.tmdb": true,
    "network.netLog": true,
    "library.categories": true,
    "library.favorites": true,
    "data.downloads": true,
    "data.backup": true,
    "data.storage": true,
    "about.update": true,
    "about.changelog": true,
    "about.licenses": true,
    "help.docs": true,
    "help.feedback": true,
    "help.support": true,
    danger: true,
  }),
})

export function normalizeSettingsPolicy(value) {
  const source = value && typeof value === "object" ? value : {}
  const sourceFeatures = source.features && typeof source.features === "object" ? source.features : {}
  const features = { ...DEFAULT_SETTINGS_POLICY.features }
  for (const key of Object.keys(features)) {
    if (typeof sourceFeatures[key] === "boolean") features[key] = sourceFeatures[key]
  }
  return { enabled: source.enabled !== false, features }
}

export async function loadSettingsPolicy() {
  try {
    const response = await fetch("/api/settings-policy", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
    if (!response.ok) return normalizeSettingsPolicy(DEFAULT_SETTINGS_POLICY)
    return normalizeSettingsPolicy(await response.json())
  } catch {
    return normalizeSettingsPolicy(DEFAULT_SETTINGS_POLICY)
  }
}

export function isSettingsFeatureEnabled(policy, key) {
  return policy?.enabled !== false && policy?.features?.[key] !== false
}

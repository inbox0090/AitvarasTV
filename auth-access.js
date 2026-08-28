const guestAccess = {
  authenticated: false,
  role: "guest",
  user: null,
  plan: null,
  allChannels: false,
}

export async function loadViewerAccess() {
  try {
    const response = await fetch("/api/auth/me", { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" })
    if (!response.ok) return guestAccess
    const value = await response.json()
    return value && typeof value === "object" ? value : guestAccess
  } catch {
    return guestAccess
  }
}

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ")

const channelTokens = (channel) => {
  const categories = Array.isArray(channel?.categories) ? channel.categories : []
  const categoryIds = Array.isArray(channel?.categoryIds) ? channel.categoryIds : []
  return [...categories, categoryIds, channel?.category, channel?.category_id, channel?.categoryId, channel?.bouquet_id, channel?.bouquetId].flat()
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(normalize)
}

const planTokens = (plan) => [
  plan?.category,
  ...(String(plan?.bouquetIds || "").split(",")),
].filter((value) => String(value || "").trim() !== "").map(normalize)

export function channelAllowed(channel, access) {
  if (access?.role === "admin" || access?.allChannels === true) return true
  // Guests must be able to see the catalogue so the global guest-preview
  // controller can allow a timed preview and stop playback after the policy
  // duration. Subscription gating applies to authenticated clients; admins
  // continue to bypass it above.
  if (!access?.authenticated || access?.role === "guest") return true
  const plan = access?.plan
  if (!plan) return false
  const allowed = planTokens(plan)
  // "General" is the safe seeded catch-all until an administrator maps a plan
  // to a concrete XUI category or bouquet ID.
  if (!allowed.length || allowed.includes("general") || allowed.includes("all")) return true
  const tokens = channelTokens(channel)
  return tokens.some((token) => allowed.includes(token))
}

export function filterChannelsForViewer(channels, access) {
  return Array.isArray(channels) ? channels.filter((channel) => channelAllowed(channel, access)) : []
}

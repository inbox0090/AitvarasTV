const fallbackPlans = [
  {
    id: "basic",
    name: "Basic",
    description: "A focused setup for your everyday viewing.",
    price: 0,
    currency: "EUR",
    billingPeriod: "varies by subscription",
    durationDays: 30,
    maxConnections: 1,
    features: ["Movies and series", "Live channel support", "Personal watchlist"],
    checkoutUrl: "/login",
    featured: false,
  },
  {
    id: "standard",
    name: "Standard",
    description: "A balanced experience across your viewing devices.",
    price: 0,
    currency: "EUR",
    billingPeriod: "varies by subscription",
    durationDays: 30,
    maxConnections: 2,
    features: ["Everything in Basic", "Programme guide support", "Continue watching"],
    checkoutUrl: "/login",
    featured: true,
  },
  {
    id: "premium",
    name: "Premium",
    description: "A complete home-theatre workflow for your library.",
    price: 0,
    currency: "EUR",
    billingPeriod: "varies by subscription",
    durationDays: 30,
    maxConnections: 4,
    features: ["Everything in Standard", "Offline downloads", "Advanced playback controls"],
    checkoutUrl: "/login",
    featured: false,
  },
]

const allowedUrl = (value) => {
  const url = String(value || "").trim()
  return url.startsWith("/") || /^https:\/\//i.test(url) ? url : "/login"
}

const formatPrice = (plan) => {
  const price = Number(plan.price)
  if (!Number.isFinite(price) || price <= 0) return { value: "Provider pricing", period: plan.billingPeriod || "varies by subscription" }
  try {
    return {
      value: new Intl.NumberFormat(undefined, { style: "currency", currency: String(plan.currency || "EUR"), maximumFractionDigits: 2 }).format(price),
      period: plan.billingPeriod || `${plan.durationDays || 30} days`,
    }
  } catch {
    return { value: `${price.toFixed(2)} ${plan.currency || "EUR"}`, period: plan.billingPeriod || `${plan.durationDays || 30} days` }
  }
}

const setText = (root, selector, value) => {
  const element = root.querySelector(selector)
  if (element) element.textContent = value
}

const updateCard = (card, plan) => {
  setText(card, "[data-plan-name]", plan.name || "Untitled plan")
  setText(card, "[data-plan-description]", plan.description || "Choose the viewing setup that fits your home.")
  const category = plan.category || "General"
  const accountType = plan.accountTypeLabel || plan.accountType || "XUI line"
  const duration = plan.durationDays || 30
  const connections = plan.maxConnections || 1
  setText(card, "[data-plan-meta]", `${accountType} · ${category} · ${connections} connection${connections === 1 ? "" : "s"} · ${duration} days`)
  const price = formatPrice(plan)
  setText(card, "[data-price-value]", price.value)
  setText(card, "[data-price-period]", price.period)
  const features = card.querySelector("[data-plan-features]")
  if (features) {
    features.replaceChildren(...(Array.isArray(plan.features) ? plan.features : []).map((feature) => {
      const item = document.createElement("li")
      item.innerHTML = '<span aria-hidden="true">✓</span>'
      const text = document.createElement("span")
      text.textContent = String(feature)
      item.append(text)
      return item
    }))
  }
  const action = card.querySelector("[data-plan-action]")
  if (action) {
    action.href = allowedUrl(plan.checkoutUrl)
    action.dataset.planAction = plan.slug || plan.id || "plan"
    action.classList.toggle("btn-primary", Boolean(plan.featured))
    action.classList.toggle("btn", !plan.featured)
  }
  card.dataset.plan = plan.slug || plan.id || "plan"
  card.dataset.planCategory = plan.category || ""
  card.dataset.planConnections = String(plan.maxConnections || 1)
  card.dataset.planDuration = String(plan.durationDays || 30)
  card.classList.toggle("cinema-plan--featured", Boolean(plan.featured))
  const badge = card.querySelector(".cinema-plan__badge")
  if (plan.featured && !badge) {
    const newBadge = document.createElement("span")
    newBadge.className = "cinema-plan__badge"
    newBadge.textContent = "Most popular"
    card.prepend(newBadge)
  } else if (!plan.featured && badge) {
    badge.remove()
  }
}

export async function loadPublicPlans() {
  try {
    const response = await fetch("/api/plans", { headers: { Accept: "application/json" }, credentials: "same-origin" })
    if (!response.ok) throw new Error(`plans endpoint returned ${response.status}`)
    const payload = await response.json()
    return Array.isArray(payload?.plans) ? payload.plans : fallbackPlans
  } catch {
    return fallbackPlans
  }
}

export async function applyPublicPlans() {
  const root = document.querySelector("[data-plans-root]")
  const grid = root?.querySelector("[data-plans-grid]")
  const empty = root?.querySelector("[data-plans-empty]")
  if (!root || !grid) return
  const plans = await loadPublicPlans()
  if (plans.length === 0) {
    grid.hidden = true
    empty?.removeAttribute("hidden")
    return
  }
  const template = grid.querySelector("[data-plan]")
  if (!template) return
  const cards = plans.slice(0, 12).map((plan) => {
    const card = template.cloneNode(true)
    card.hidden = false
    updateCard(card, plan)
    return card
  })
  grid.replaceChildren(...cards)
  grid.hidden = false
  empty?.setAttribute("hidden", "")
}

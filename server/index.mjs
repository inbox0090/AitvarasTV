import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const DIST = path.join(ROOT, "dist")
const DATA_DIR = process.env.ADMIN_DATA_DIR || path.join(ROOT, "data")
const DB_PATH = process.env.ADMIN_DB_PATH || path.join(DATA_DIR, "admin.sqlite")
const PORT = Number(process.env.PORT || 4321)
const HOST = process.env.HOST || "127.0.0.1"
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin"
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ""
const INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || "admin"
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`
const COOKIE_NAME = "xt_admin_session"
const CLIENT_COOKIE_NAME = "xt_client_session"
const SESSION_TTL_SECONDS = 60 * 60 * 12
const CLIENT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
const RESET_TTL_SECONDS = 60 * 30
const isProduction = process.env.NODE_ENV === "production"

fs.mkdirSync(DATA_DIR, { recursive: true })
const db = new DatabaseSync(DB_PATH)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS admin_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS app_settings_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    features_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscription_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'General',
    account_type TEXT NOT NULL DEFAULT 'line',
    bouquet_ids TEXT NOT NULL DEFAULT '',
    duration_days INTEGER NOT NULL DEFAULT 30,
    max_connections INTEGER NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    billing_period TEXT NOT NULL DEFAULT '30 days',
    features_json TEXT NOT NULL DEFAULT '[]',
    checkout_url TEXT NOT NULL DEFAULT '/login',
    active INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS client_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    plan_id INTEGER,
    role TEXT NOT NULL DEFAULT 'client',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS client_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES client_users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS guest_preview_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    duration_seconds INTEGER NOT NULL DEFAULT 30,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS client_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT 'manual',
    provider_customer_id TEXT NOT NULL DEFAULT '',
    provider_payment_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    current_period_start INTEGER,
    current_period_end INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
    FOREIGN KEY(plan_id) REFERENCES subscription_plans(id) ON DELETE RESTRICT
  );
  CREATE TABLE IF NOT EXISTS payment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    client_user_id INTEGER,
    plan_id INTEGER,
    amount INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'eur',
    status TEXT NOT NULL DEFAULT 'pending',
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(provider, provider_event_id),
    FOREIGN KEY(client_user_id) REFERENCES client_users(id) ON DELETE SET NULL,
    FOREIGN KEY(plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL
  );
`)

const now = () => Math.floor(Date.now() / 1000)
const DEFAULT_GUEST_PREVIEW_SECONDS = 30
const readGuestPreviewPolicy = () => {
  const row = db.prepare("SELECT enabled, duration_seconds, updated_at FROM guest_preview_policy WHERE id = 1").get()
  if (!row) {
    db.prepare("INSERT INTO guest_preview_policy (id, enabled, duration_seconds, updated_at) VALUES (1, 1, ?, ?)").run(DEFAULT_GUEST_PREVIEW_SECONDS, now())
    return { enabled: true, durationSeconds: DEFAULT_GUEST_PREVIEW_SECONDS, updatedAt: now() }
  }
  return { enabled: row.enabled !== 0, durationSeconds: Math.max(0, Number(row.duration_seconds) || 0), updatedAt: row.updated_at }
}
const writeGuestPreviewPolicy = (body) => {
  const parsed = Number.parseInt(String(body.durationSeconds ?? "30"), 10)
  const durationSeconds = Number.isFinite(parsed) ? Math.min(86400, Math.max(0, parsed)) : DEFAULT_GUEST_PREVIEW_SECONDS
  const enabled = body.enabled === "on" || body.enabled === true || String(body.enabled) === "true"
  db.prepare("INSERT INTO guest_preview_policy (id, enabled, duration_seconds, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, duration_seconds = excluded.duration_seconds, updated_at = excluded.updated_at").run(enabled ? 1 : 0, durationSeconds, now())
  return { enabled, durationSeconds, updatedAt: now() }
}
const SETTINGS_FEATURES = {
  playlists: { label: "Playlists", description: "Add, refresh, and manage connected playlists." },
  "appearance.display": { label: "Display", description: "Language, theme, accent, and display preferences." },
  "appearance.behavior": { label: "Behavior", description: "Interface sounds, haptics, TV safe area, and related behaviour." },
  "appearance.homeSections": { label: "Home page sections", description: "Home page strip and section customisation." },
  "watching.liveTv": { label: "Live TV", description: "Live TV layout and EPG preferences." },
  "watching.playback": { label: "Playback", description: "Player backend, audio, captions, and playback controls." },
  "network.network": { label: "Network", description: "User-Agent, timeout, and developer network controls." },
  "network.discord": { label: "Discord Rich Presence", description: "Discord presence integration when available." },
  "network.tmdb": { label: "TMDb metadata", description: "Optional TMDb enrichment and API key controls." },
  "network.netLog": { label: "Network log", description: "Diagnostic network request log." },
  "library.categories": { label: "Categories", description: "Hidden category and genre controls." },
  "library.favorites": { label: "Favorites", description: "Favorite ordering and library controls." },
  "data.downloads": { label: "Downloads", description: "Download folder and concurrency settings." },
  "data.backup": { label: "Backup", description: "Export and import local app settings." },
  "data.storage": { label: "Storage", description: "Cache, history, logs, and local storage controls." },
  "about.update": { label: "App update", description: "Application update controls." },
  "about.changelog": { label: "What's new", description: "Release notes and changelog." },
  "about.licenses": { label: "Licenses and attribution", description: "Open-source license and attribution details." },
  "help.docs": { label: "Read the docs", description: "Documentation and help resources." },
  "help.feedback": { label: "Send feedback", description: "Feedback and diagnostic export tools." },
  "help.support": { label: "Support", description: "Support contact options." },
  danger: { label: "Danger zone", description: "Reset, restore, and destructive local data actions." },
}
const defaultSettingsFeatures = () => Object.fromEntries(Object.keys(SETTINGS_FEATURES).map((key) => [key, true]))
const readSettingsPolicy = () => {
  const row = db.prepare("SELECT enabled, features_json, updated_at FROM app_settings_policy WHERE id = 1").get()
  if (!row) {
    const features = defaultSettingsFeatures()
    db.prepare("INSERT INTO app_settings_policy (id, enabled, features_json, updated_at) VALUES (1, 1, ?, ?)").run(JSON.stringify(features), now())
    return { enabled: true, features, updatedAt: now() }
  }
  let stored = {}
  try { stored = JSON.parse(row.features_json || "{}") } catch { stored = {} }
  const features = defaultSettingsFeatures()
  for (const key of Object.keys(features)) if (typeof stored[key] === "boolean") features[key] = stored[key]
  return { enabled: row.enabled !== 0, features, updatedAt: row.updated_at }
}
const writeSettingsPolicy = (body) => {
  const features = Object.fromEntries(Object.keys(SETTINGS_FEATURES).map((key) => [key, body[`feature.${key}`] === "on"]))
  const enabled = body.enabled === "on"
  db.prepare("INSERT INTO app_settings_policy (id, enabled, features_json, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, features_json = excluded.features_json, updated_at = excluded.updated_at").run(enabled ? 1 : 0, JSON.stringify(features), now())
  return { enabled, features, updatedAt: now() }
}
const PLAN_ACCOUNT_TYPES = {
  line: "XUI line",
  trial: "XUI trial",
  reseller: "XUI reseller package",
  custom: "Custom account",
}
const DEFAULT_PLAN_SEEDS = [
  { slug: "basic", name: "Basic", description: "A focused setup for everyday viewing.", category: "General", accountType: "line", durationDays: 30, maxConnections: 1, price: 0, currency: "EUR", billingPeriod: "30 days", features: ["Movies and series", "Live channel support", "Personal watchlist"], featured: false, sortOrder: 10 },
  { slug: "standard", name: "Standard", description: "A balanced experience across your viewing devices.", category: "General", accountType: "line", durationDays: 30, maxConnections: 2, price: 0, currency: "EUR", billingPeriod: "30 days", features: ["Everything in Basic", "Programme guide support", "Continue watching"], featured: true, sortOrder: 20 },
  { slug: "premium", name: "Premium", description: "A complete home-theatre workflow for your library.", category: "Premium", accountType: "line", durationDays: 30, maxConnections: 4, price: 0, currency: "EUR", billingPeriod: "30 days", features: ["Everything in Standard", "Offline downloads", "Advanced playback controls"], featured: false, sortOrder: 30 },
]
const seedSubscriptionPlans = () => {
  const count = db.prepare("SELECT COUNT(*) AS count FROM subscription_plans").get()?.count || 0
  if (Number(count) > 0) return
  const insert = db.prepare("INSERT INTO subscription_plans (slug, name, description, category, account_type, bouquet_ids, duration_days, max_connections, price, currency, billing_period, features_json, checkout_url, active, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
  for (const plan of DEFAULT_PLAN_SEEDS) insert.run(plan.slug, plan.name, plan.description, plan.category, plan.accountType, "", plan.durationDays, plan.maxConnections, plan.price, plan.currency, plan.billingPeriod, JSON.stringify(plan.features), "/login", plan.featured ? 1 : 0, plan.sortOrder, now(), now())
}
const parsePlanFeatures = (value) => String(value || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 12)
const clampInt = (value, fallback, min, max) => { const parsed = Number.parseInt(String(value), 10); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback }
const safeCheckoutUrl = (value) => { const url = String(value || "").trim(); return url.startsWith("/") || /^https:\/\//i.test(url) ? url.slice(0, 500) : "/login" }
const slugify = (value) => String(value || "plan").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "plan"
const readPlanFeatures = (value) => { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean).slice(0, 12) : [] } catch { return [] } }
const serializePlan = (row) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  category: row.category,
  accountType: row.account_type,
  accountTypeLabel: PLAN_ACCOUNT_TYPES[row.account_type] || PLAN_ACCOUNT_TYPES.custom,
  bouquetIds: row.bouquet_ids,
  durationDays: row.duration_days,
  maxConnections: row.max_connections,
  price: Number(row.price || 0),
  currency: row.currency,
  billingPeriod: row.billing_period,
  features: readPlanFeatures(row.features_json),
  checkoutUrl: safeCheckoutUrl(row.checkout_url),
  active: row.active !== 0,
  featured: row.featured !== 0,
  sortOrder: row.sort_order,
  updatedAt: row.updated_at,
})
const listSubscriptionPlans = (activeOnly = false) => {
  const rows = activeOnly
    ? db.prepare("SELECT * FROM subscription_plans WHERE active = 1 ORDER BY sort_order ASC, id ASC").all()
    : db.prepare("SELECT * FROM subscription_plans ORDER BY sort_order ASC, id ASC").all()
  return rows.map(serializePlan)
}
const upsertSubscriptionPlan = (body) => {
  const id = clampInt(body.id, 0, 0, Number.MAX_SAFE_INTEGER)
  const name = String(body.name || "Untitled plan").trim().slice(0, 80) || "Untitled plan"
  let slug = slugify(body.slug || name)
  const duplicate = db.prepare("SELECT id FROM subscription_plans WHERE slug = ? AND id != ?").get(slug, id)
  if (duplicate) slug = `${slug}-${Date.now().toString(36).slice(-5)}`
  const accountType = Object.hasOwn(PLAN_ACCOUNT_TYPES, String(body.accountType)) ? String(body.accountType) : "line"
  const priceNumber = Number.parseFloat(String(body.price ?? "0").replace(",", "."))
  const price = Number.isFinite(priceNumber) ? Math.max(0, Math.min(999999, Math.round(priceNumber * 100) / 100)) : 0
  const record = {
    slug,
    name,
    description: String(body.description || "").trim().slice(0, 240),
    category: String(body.category || "General").trim().slice(0, 80) || "General",
    accountType,
    bouquetIds: String(body.bouquets || "").trim().slice(0, 500),
    durationDays: clampInt(body.durationDays, 30, 1, 3650),
    maxConnections: clampInt(body.connections, 1, 1, 100),
    price,
    currency: String(body.currency || "EUR").trim().toUpperCase().slice(0, 3) || "EUR",
    billingPeriod: String(body.billingPeriod || "30 days").trim().slice(0, 40) || "30 days",
    features: parsePlanFeatures(body.features),
    checkoutUrl: safeCheckoutUrl(body.checkoutUrl),
    active: body.active === "on" ? 1 : 0,
    featured: body.featured === "on" ? 1 : 0,
    sortOrder: clampInt(body.sortOrder, 0, 0, 9999),
  }
  if (id) {
    db.prepare("UPDATE subscription_plans SET slug = ?, name = ?, description = ?, category = ?, account_type = ?, bouquet_ids = ?, duration_days = ?, max_connections = ?, price = ?, currency = ?, billing_period = ?, features_json = ?, checkout_url = ?, active = ?, featured = ?, sort_order = ?, updated_at = ? WHERE id = ?").run(record.slug, record.name, record.description, record.category, record.accountType, record.bouquetIds, record.durationDays, record.maxConnections, record.price, record.currency, record.billingPeriod, JSON.stringify(record.features), record.checkoutUrl, record.active, record.featured, record.sortOrder, now(), id)
  } else {
    db.prepare("INSERT INTO subscription_plans (slug, name, description, category, account_type, bouquet_ids, duration_days, max_connections, price, currency, billing_period, features_json, checkout_url, active, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(record.slug, record.name, record.description, record.category, record.accountType, record.bouquetIds, record.durationDays, record.maxConnections, record.price, record.currency, record.billingPeriod, JSON.stringify(record.features), record.checkoutUrl, record.active, record.featured, record.sortOrder, now(), now())
  }
  return record
}
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex")
const makeToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url")
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
const parseCookies = (header = "") => Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]))
const parseBody = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString("utf8")
  const type = request.headers["content-type"] || ""
  if (type.includes("application/json")) return JSON.parse(raw || "{}")
  return Object.fromEntries(new URLSearchParams(raw))
}
const redirect = (response, location) => { response.writeHead(303, { Location: location }); response.end() }
const sendHtml = (response, html, status = 200, headers = {}) => {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers })
  response.end(html)
}
const sendJson = (response, payload, status = 200) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  response.end(JSON.stringify(payload))
}
const setCookie = (response, token, maxAge = SESSION_TTL_SECONDS) => {
  const secure = isProduction ? "; Secure" : ""
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`)
}
const clearCookie = (response) => response.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
const setClientCookie = (response, token, maxAge = CLIENT_SESSION_TTL_SECONDS) => {
  const secure = isProduction ? "; Secure" : ""
  response.setHeader("Set-Cookie", `${CLIENT_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`)
}
const clearClientCookie = (response) => response.setHeader("Set-Cookie", `${CLIENT_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)

const passwordHash = (password, salt = crypto.randomBytes(16).toString("hex")) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => error ? reject(error) : resolve({ salt, hash: derived.toString("hex") }))
})
const verifyPassword = (password, salt, expected) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => {
    if (error) return reject(error)
    const actual = Buffer.from(derived.toString("hex"), "hex")
    const target = Buffer.from(expected, "hex")
    resolve(actual.length === target.length && crypto.timingSafeEqual(actual, target))
  })
})
const normalizeEmail = (value) => String(value || "").trim().toLowerCase().slice(0, 160)
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const safeNextPath = (value) => {
  const next = String(value || "/").trim()
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/admin") ? next.slice(0, 240) : "/"
}
const createClientSession = (userId, response) => {
  const token = makeToken(32)
  db.prepare("INSERT INTO client_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(hashToken(token), userId, now() + CLIENT_SESSION_TTL_SECONDS, now())
  setClientCookie(response, token)
  return token
}
const readClientUser = (request) => {
  const raw = parseCookies(request.headers.cookie || "")[CLIENT_COOKIE_NAME]
  if (!raw) return null
  const row = db.prepare("SELECT u.*, p.slug AS plan_slug, p.name AS plan_name, p.category AS plan_category, p.bouquet_ids AS plan_bouquet_ids, p.account_type AS plan_account_type, p.duration_days AS plan_duration_days, p.max_connections AS plan_max_connections FROM client_sessions s JOIN client_users u ON u.id = s.user_id LEFT JOIN subscription_plans p ON p.id = u.plan_id WHERE s.token_hash = ? AND s.expires_at > ?").get(hashToken(raw), now())
  if (!row) return null
  return row
}
const clientAccessFromUser = (user) => ({
  authenticated: true,
  role: "client",
  user: { id: user.id, email: user.email, displayName: user.display_name },
  plan: user.plan_slug ? { slug: user.plan_slug, name: user.plan_name, category: user.plan_category, bouquetIds: user.plan_bouquet_ids || "", accountType: user.plan_account_type, durationDays: user.plan_duration_days, maxConnections: user.plan_max_connections } : null,
  allChannels: false,
})
const readBillingForUser = (userId) => {
  const row = db.prepare("SELECT s.*, p.slug AS plan_slug, p.name AS plan_name, p.price AS plan_price, p.currency AS plan_currency, p.duration_days AS plan_duration_days FROM client_subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.client_user_id = ? ORDER BY s.updated_at DESC, s.id DESC LIMIT 1").get(userId)
  if (!row) return null
  return { id: row.id, planSlug: row.plan_slug, planName: row.plan_name, provider: row.provider, status: row.status, amount: Number(row.plan_price || 0), currency: row.plan_currency, currentPeriodStart: row.current_period_start, currentPeriodEnd: row.current_period_end, active: row.status === "active" && Number(row.current_period_end || 0) > now() }
}
const clientAccessFromUserWithBilling = (user) => ({ ...clientAccessFromUser(user), subscription: readBillingForUser(user.id) })
const stripeSecretKey = () => String(process.env.STRIPE_SECRET_KEY || "").trim()
const stripeWebhookSecret = () => String(process.env.STRIPE_WEBHOOK_SECRET || "").trim()
const createStripeCheckoutSession = async (user, plan) => {
  const secret = stripeSecretKey()
  if (!secret) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY to the server environment.")
  const amount = Math.round(Number(plan.price || 0) * 100)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("This plan has no configured payment price yet.")
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${APP_ORIGIN}/account?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_ORIGIN}/account?billing=cancelled`,
    client_reference_id: String(user.id),
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": String(plan.currency || "EUR").toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][price_data][product_data][name]": String(plan.name || "Streaming plan"),
    "line_items[0][price_data][product_data][description]": String(plan.description || `${plan.duration_days} days of channel access`).slice(0, 500),
    "metadata[user_id]": String(user.id),
    "metadata[plan_slug]": String(plan.slug),
  })
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.url) throw new Error(payload?.error?.message || "Stripe could not create a checkout session.")
  return payload
}
const readRawBody = (request) => new Promise((resolve, reject) => {
  let body = ""
  request.setEncoding("utf8")
  request.on("data", (chunk) => { body += chunk; if (body.length > 2_000_000) { request.destroy(); reject(new Error("Request body too large")) } })
  request.on("end", () => resolve(body))
  request.on("error", reject)
})
const verifyStripeSignature = (rawBody, signature) => {
  const secret = stripeWebhookSecret()
  if (!secret || !signature) return false
  const parts = String(signature).split(",")
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2)
  const received = parts.find((part) => part.startsWith("v1="))?.slice(3)
  if (!timestamp || !received || Math.abs(now() - Number(timestamp)) > 300) return false
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  const expectedBuffer = Buffer.from(expected, "hex")
  const receivedBuffer = Buffer.from(received, "hex")
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
}
const applyStripeCheckoutEvent = (event) => {
  if (event?.type !== "checkout.session.completed") return
  const session = event.data?.object || {}
  const userId = clampInt(session.metadata?.user_id || session.client_reference_id, 0, 0, Number.MAX_SAFE_INTEGER)
  const planSlug = String(session.metadata?.plan_slug || "").trim().toLowerCase()
  if (!userId || !planSlug || session.payment_status !== "paid") return
  const user = db.prepare("SELECT id FROM client_users WHERE id = ?").get(userId)
  const plan = db.prepare("SELECT * FROM subscription_plans WHERE slug = ? AND active = 1").get(planSlug)
  if (!user || !plan) return
  const eventId = String(event.id || session.id || "")
  if (!eventId) return
  try {
    db.prepare("INSERT INTO payment_events (provider, provider_event_id, client_user_id, plan_id, amount, currency, status, raw_json, created_at, updated_at) VALUES ('stripe', ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?)").run(eventId, userId, plan.id, Math.round(Number(session.amount_total || plan.price * 100)), String(session.currency || plan.currency || "eur").toLowerCase(), JSON.stringify(event), now(), now())
  } catch {
    return
  }
  const previous = db.prepare("SELECT * FROM client_subscriptions WHERE client_user_id = ? AND status = 'active' ORDER BY current_period_end DESC LIMIT 1").get(userId)
  const start = Math.max(now(), Number(previous?.current_period_end || 0))
  const end = start + Number(plan.duration_days || 30) * 86400
  db.prepare("INSERT INTO client_subscriptions (client_user_id, plan_id, provider, provider_customer_id, provider_payment_id, status, current_period_start, current_period_end, created_at, updated_at) VALUES (?, ?, 'stripe', ?, ?, 'active', ?, ?, ?, ?)").run(userId, plan.id, String(session.customer || ""), String(session.payment_intent || session.id), start, end, now(), now())
  db.prepare("UPDATE client_users SET plan_id = ?, updated_at = ? WHERE id = ?").run(plan.id, now(), userId)
}
const viewerAccess = (request) => {
  const admin = getAdmin(request)
  if (admin) return { authenticated: true, role: "admin", user: { username: admin.username, email: admin.email || "" }, plan: null, allChannels: true }
  const user = readClientUser(request)
  if (!user) return { authenticated: false, role: "guest", user: null, plan: null, allChannels: false }
  return clientAccessFromUserWithBilling(user)
}
const pageNeedsClientAuth = (pathname) => {
  if (pathname === "/" || pathname === "/index.html") return false
  if (pathname === "/livetv" || pathname.startsWith("/livetv/") || pathname === "/movies" || pathname.startsWith("/movies/") || pathname === "/series" || pathname.startsWith("/series/")) return false
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/") || pathname.startsWith("/_astro/") || pathname.startsWith("/images/") || pathname === "/favicon.svg") return false
  if (pathname === "/auth" || pathname === "/auth/" || pathname === "/register" || pathname === "/signup") return false
  return !path.extname(pathname)
}
const clientAccessRedirect = (request, response, url) => {
  if (!pageNeedsClientAuth(url.pathname)) return false
  const access = viewerAccess(request)
  if (!access.authenticated) {
    redirect(response, `/auth?next=${encodeURIComponent(url.pathname + url.search)}`)
    return true
  }
  if (access.role === "client" && !access.plan) {
    redirect(response, `/auth?choose=1&next=${encodeURIComponent(url.pathname + url.search)}`)
    return true
  }
  return false
}

const existingAdmin = db.prepare("SELECT * FROM admin_users WHERE username = ?").get(ADMIN_USERNAME)
if (!existingAdmin) {
  const credentials = await passwordHash(INITIAL_PASSWORD)
  db.prepare("INSERT INTO admin_users (username, email, password_hash, password_salt, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").run(ADMIN_USERNAME, ADMIN_EMAIL, credentials.hash, credentials.salt, now(), now())
  console.log(`Created bootstrap admin '${ADMIN_USERNAME}'. The first login must change the password.`)
}
seedSubscriptionPlans()

db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(now())
db.prepare("DELETE FROM admin_reset_tokens WHERE expires_at < ? OR used_at IS NOT NULL").run(now())
db.prepare("DELETE FROM client_sessions WHERE expires_at < ?").run(now())

const getAdmin = (request) => {
  const raw = parseCookies(request.headers.cookie || "")[COOKIE_NAME]
  if (!raw) return null
  const row = db.prepare("SELECT u.*, s.expires_at FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?").get(hashToken(raw), now())
  return row || null
}
const createSession = (userId, response) => {
  const token = makeToken()
  db.prepare("INSERT INTO admin_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(hashToken(token), userId, now() + SESSION_TTL_SECONDS, now())
  setCookie(response, token)
}
const requireAdmin = (request, response) => {
  const admin = getAdmin(request)
  if (!admin) { redirect(response, "/admin/login"); return null }
  return admin
}

const pageShell = (title, body, options = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | AitvarasTV Admin</title><style>
:root{color-scheme:dark;--bg:#07080d;--surface:#11131b;--surface2:#181b25;--line:#2a2e3c;--fg:#f6f7fb;--muted:#9da4b5;--accent:#ff4d67;--accent2:#ff8b57;--ok:#67dfaa;--radius:18px}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 75% 0%,#241522 0,transparent 35rem),var(--bg);color:var(--fg);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}a{color:inherit}button,input{font:inherit}button{cursor:pointer}.admin-shell{min-height:100vh;display:grid;grid-template-columns:250px minmax(0,1fr)}.admin-side{border-right:1px solid var(--line);background:rgba(8,9,14,.86);padding:26px 18px;display:flex;flex-direction:column;gap:26px}.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800}.mark{width:30px;height:30px;border:3px solid var(--accent);border-radius:9px;display:grid;place-items:center;color:var(--accent)}.side-nav{display:grid;gap:6px}.side-nav a{padding:11px 13px;border-radius:11px;color:var(--muted);text-decoration:none}.side-nav a:hover,.side-nav a.active{background:var(--surface2);color:var(--fg)}.side-footer{margin-top:auto;color:var(--muted);font-size:12px}.admin-main{min-width:0;padding:34px clamp(20px,4vw,60px) 54px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:35px}.eyebrow{color:var(--accent2);text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:800}.topbar h1{font-size:clamp(28px,4vw,44px);line-height:1.05;margin:6px 0 0}.account{display:flex;align-items:center;gap:12px;color:var(--muted)}.avatar{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:800}.logout{border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--muted);padding:9px 12px}.logout:hover{color:var(--fg);border-color:var(--accent)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.stat,.panel{background:rgba(17,19,27,.72);border:1px solid var(--line);border-radius:var(--radius);padding:20px}.stat strong{display:block;font-size:30px;margin-top:7px}.stat span{color:var(--muted)}.panel{margin-top:22px}.panel h2{margin:0 0 8px;font-size:20px}.panel p{color:var(--muted);margin-top:0}.danger{color:#ff9aa9}.success{color:var(--ok)}.error{color:#ff9aa9}.form{display:grid;gap:14px;max-width:440px}.form label{display:grid;gap:6px;color:var(--muted);font-size:13px}.form input{width:100%;border:1px solid var(--line);border-radius:11px;background:var(--surface2);color:var(--fg);padding:12px 13px;outline:none}.form input:focus{border-color:var(--accent)}.primary{border:0;border-radius:11px;background:linear-gradient(100deg,var(--accent),var(--accent2));color:#fff;font-weight:800;padding:12px 16px}.muted{color:var(--muted)}.notice{border-radius:11px;padding:11px 13px;margin-bottom:14px;background:rgba(255,77,103,.1);border:1px solid rgba(255,77,103,.3)}.settings-frame{width:100%;height:calc(100vh - 205px);min-height:650px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg)}.login-wrap{min-height:100vh;display:grid;place-items:center;padding:20px}.login-card{width:min(100%,460px);background:rgba(17,19,27,.92);border:1px solid var(--line);border-radius:24px;padding:32px;box-shadow:0 25px 100px rgba(0,0,0,.45)}.login-card h1{font-size:32px;margin:8px 0}.login-card p{color:var(--muted)}.login-card .brand{margin-bottom:30px}.login-card .form{max-width:none}.login-card a{color:var(--muted);font-size:13px}.mobile-menu{display:none}@media(max-width:800px){.admin-shell{display:block}.admin-side{border-right:0;border-bottom:1px solid var(--line);padding:16px;gap:14px}.side-nav{display:flex;overflow:auto}.side-nav a{white-space:nowrap}.side-footer{display:none}.admin-main{padding:26px 16px 40px}.grid{grid-template-columns:1fr}.topbar{align-items:flex-start;flex-direction:column}.account{width:100%;justify-content:space-between}.settings-frame{height:calc(100vh - 250px);min-height:500px}}
.feature-panel{max-width:1100px}.feature-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:16px 0}.feature-toolbar .muted{margin-left:auto;font-size:12px}.master-toggle,.feature-row{display:flex;align-items:center;gap:14px;padding:16px;border:1px solid var(--line);border-radius:14px;background:rgba(24,27,37,.64);cursor:pointer}.master-toggle{border-color:rgba(255,77,103,.45);background:rgba(255,77,103,.07)}.master-toggle input,.feature-row input{width:18px;height:18px;accent-color:var(--accent);flex:none}.master-toggle span,.feature-row span{display:grid;gap:3px;min-width:0}.master-toggle strong,.feature-row strong{font-size:14px}.master-toggle small,.feature-row small{color:var(--muted);font-size:12px}.master-toggle em,.feature-row em{margin-left:auto;font-style:normal;color:var(--ok);font-size:12px;white-space:nowrap}.feature-row:not(:has(input:checked)) em{color:var(--muted)}.feature-group{display:grid;gap:8px;margin-top:18px}.feature-group__head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 3px 4px}.feature-group__head h3{margin:3px 0 0;font-size:15px}.select-group{border:1px solid var(--line);border-radius:9px;background:transparent;color:var(--muted);padding:7px 10px;font-size:12px}.select-group:hover{border-color:var(--accent);color:var(--fg)}.feature-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}.feature-actions .muted{font-size:12px}@media(max-width:800px){.feature-toolbar .muted{margin-left:0;width:100%}.feature-row{align-items:flex-start}.feature-row em{margin-top:2px}.feature-group__head{align-items:flex-start}.feature-actions .primary{width:100%}} .plan-panel{max-width:1200px}.plan-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:18px}.plans-admin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:22px;align-items:start}.plan-editor{background:rgba(17,19,27,.78);border:1px solid var(--line);border-radius:var(--radius);padding:20px}.plan-editor--new{border-color:rgba(255,139,87,.5);background:rgba(24,20,28,.9)}.plan-editor__head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px}.plan-editor__head h3{margin:4px 0 0;font-size:20px}.plan-status{border:1px solid var(--line);border-radius:999px;padding:4px 9px;font-size:11px;color:var(--muted);white-space:nowrap}.plan-status.is-on{border-color:rgba(103,223,170,.35);color:var(--ok)}.plan-form{display:grid;gap:16px}.plan-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.plan-form label{display:grid;gap:6px;color:var(--muted);font-size:13px}.plan-form label.wide{grid-column:1/-1}.plan-form input,.plan-form select,.plan-form textarea{width:100%;border:1px solid var(--line);border-radius:11px;background:var(--surface2);color:var(--fg);padding:11px 12px;outline:none}.plan-form textarea{resize:vertical;min-height:80px}.plan-form input:focus,.plan-form select:focus,.plan-form textarea:focus{border-color:var(--accent)}.plan-form small{color:var(--muted);font-size:11px;line-height:1.4}.plan-form__checks{display:flex;gap:16px;flex-wrap:wrap;padding-top:2px}.plan-form__checks label{display:flex;align-items:center;gap:8px;color:var(--muted)}.plan-form__checks input{width:17px;height:17px;accent-color:var(--accent)}.plan-form__actions{display:flex;gap:10px;align-items:center;padding-top:2px}.plan-delete{margin-top:10px}.plan-delete button{width:100%}@media(max-width:1050px){.plans-admin-grid{grid-template-columns:1fr}}@media(max-width:600px){.plan-form-grid{grid-template-columns:1fr}.plan-form label.wide{grid-column:auto}.plan-toolbar .primary{width:100%;text-align:center}.plan-form__actions .primary{width:100%}} </style></head><body>${body}</body></html>`

const adminNav = (active) => `<nav class="side-nav" aria-label="Admin navigation"><a class="${active === "overview" ? "active" : ""}" href="/admin">Overview</a><a class="${active === "billing" ? "active" : ""}" href="/admin/billing">Billing analytics</a><a class="${active === "plans" ? "active" : ""}" href="/admin/plans">Plans & pricing</a><a class="${active === "features" ? "active" : ""}" href="/admin/features">Client controls</a><a class="${active === "guest-preview" ? "active" : ""}" href="/admin/guest-preview">Guest preview</a><a class="${active === "settings" ? "active" : ""}" href="/admin/settings">Settings</a><a class="${active === "security" ? "active" : ""}" href="/admin/security">Security</a><a href="/" target="_blank" rel="noreferrer">Open platform</a></nav>`
const dashboardFrame = (admin, active, title, eyebrow, content) => pageShell(title, `<div class="admin-shell"><aside class="admin-side"><a class="brand" href="/admin"><span class="mark">∞</span><span>AitvarasTV<br><small class="muted">Admin console</small></span></a>${adminNav(active)}<div class="side-footer">Private control surface<br>Signed in as <strong>${escapeHtml(admin.username)}</strong></div></aside><main class="admin-main"><header class="topbar"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1></div><div class="account"><span class="avatar">${escapeHtml(admin.username[0].toUpperCase())}</span><span>${escapeHtml(admin.username)}</span><form method="post" action="/admin/logout"><button class="logout" type="submit">Sign out</button></form></div></header>${content}</main></div>`)

const renderLogin = (error = "") => pageShell("Admin login", `<main class="login-wrap"><section class="login-card"><a class="brand" href="/"><span class="mark">∞</span><span>AitvarasTV</span></a><div class="eyebrow">Restricted area</div><h1>Admin sign in</h1><p>Use the separate administrator account. This login is independent from the platform playlist account.</p>${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ""}<form class="form" method="post" action="/admin/login"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Sign in</button></form><p><a href="/admin/forgot">Forgot admin password?</a></p></section></main>`)

const renderForgot = (message = "", error = "") => pageShell("Forgot password", `<main class="login-wrap"><section class="login-card"><a class="brand" href="/admin/login"><span class="mark">∞</span><span>AitvarasTV Admin</span></a><div class="eyebrow">Account recovery</div><h1>Reset admin password</h1><p>Enter the admin email address. If SMTP is configured, a one-time reset link will be sent.</p>${message ? `<div class="notice success">${escapeHtml(message)}</div>` : ""}${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ""}<form class="form" method="post" action="/admin/forgot"><label>Admin email<input name="email" type="email" autocomplete="email" required></label><button class="primary" type="submit">Send reset link</button></form><p><a href="/admin/login">Back to admin login</a></p></section></main>`)

const renderReset = (token, error = "") => pageShell("Set new password", `<main class="login-wrap"><section class="login-card"><a class="brand" href="/admin/login"><span class="mark">∞</span><span>AitvarasTV Admin</span></a><div class="eyebrow">Secure reset</div><h1>Choose a new password</h1><p>Use a strong password with at least 12 characters.</p>${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ""}<form class="form" method="post" action="/admin/reset"><input type="hidden" name="token" value="${escapeHtml(token)}"><label>New password<input name="password" type="password" minlength="12" autocomplete="new-password" required></label><label>Repeat password<input name="password2" type="password" minlength="12" autocomplete="new-password" required></label><button class="primary" type="submit">Save new password</button></form></section></main>`)

const emptyPlan = () => ({ id: 0, slug: "", name: "", description: "", category: "General", accountType: "line", bouquetIds: "", durationDays: 30, maxConnections: 1, price: 0, currency: "EUR", billingPeriod: "30 days", features: [], checkoutUrl: "/login", active: true, featured: false, sortOrder: 0 })
const renderPlanEditor = (plan) => {
  const p = { ...emptyPlan(), ...plan }
  const accountOptions = Object.entries(PLAN_ACCOUNT_TYPES).map(([value, label]) => `<option value="${value}" ${p.accountType === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")
  return `<article class="plan-editor"><div class="plan-editor__head"><div><div class="eyebrow">${p.id ? "Edit plan" : "New plan"}</div><h3>${escapeHtml(p.name || "Create a plan")}</h3></div>${p.id ? `<span class="plan-status ${p.active ? "is-on" : "is-off"}">${p.active ? "Active" : "Hidden"}</span>` : ""}</div><form class="plan-form" method="post" action="/admin/plans/save"><input type="hidden" name="id" value="${p.id || ""}"><div class="plan-form-grid"><label>Plan name<input name="name" value="${escapeHtml(p.name)}" placeholder="e.g. Sports Plus" required></label><label>Slug<input name="slug" value="${escapeHtml(p.slug)}" placeholder="sports-plus"></label><label>Playlist category / bouquet group<input name="category" value="${escapeHtml(p.category)}" placeholder="Sports, Movies, Premium"></label><label>XUI account type<select name="accountType">${accountOptions}</select></label><label class="wide">XUI bouquet IDs<input name="bouquets" value="${escapeHtml(p.bouquetIds)}" placeholder="e.g. 1, 4, 12"><small>Comma-separated bouquet IDs from XUI One. This is a mapping only; it does not call the provider.</small></label><label>Duration (days)<input type="number" name="durationDays" min="1" max="3650" value="${p.durationDays}"></label><label>Max connections<input type="number" name="connections" min="1" max="100" value="${p.maxConnections}"></label><label>Price<input type="number" name="price" min="0" max="999999" step="0.01" value="${p.price}"></label><label>Currency<input name="currency" maxlength="3" value="${escapeHtml(p.currency)}"></label><label>Billing label<input name="billingPeriod" value="${escapeHtml(p.billingPeriod)}" placeholder="30 days"></label><label>Sort order<input type="number" name="sortOrder" min="0" max="9999" value="${p.sortOrder}"></label><label class="wide">Description<textarea name="description" rows="2" maxlength="240">${escapeHtml(p.description)}</textarea></label><label class="wide">Features, one per line<textarea name="features" rows="4" placeholder="Movies and series\nLive channel support">${escapeHtml(p.features.join("\\n"))}</textarea></label><label class="wide">Choose plan URL<input name="checkoutUrl" value="${escapeHtml(p.checkoutUrl)}" placeholder="/login or https://checkout.example"></label></div><div class="plan-form__checks"><label><input type="checkbox" name="active" ${p.active ? "checked" : ""}> Visible on public pricing</label><label><input type="checkbox" name="featured" ${p.featured ? "checked" : ""}> Mark as most popular</label></div><div class="plan-form__actions"><button class="primary" type="submit">${p.id ? "Save plan" : "Create plan"}</button></div></form>${p.id ? `<form class="plan-delete" method="post" action="/admin/plans/delete" onsubmit="return confirm('Delete this plan?')"><input type="hidden" name="id" value="${p.id}"><button class="logout danger" type="submit">Delete</button></form>` : ""}</article>`
}
const renderPlansAdmin = (admin, saved = false) => {
  const plans = listSubscriptionPlans(false)
  const editors = plans.map(renderPlanEditor).join("")
  return dashboardFrame(admin, "plans", "Plans & pricing", "XUI catalogue", `<section class="panel plan-panel"><div class="eyebrow">XUI One plan mapping</div><h2>Plans, categories and prices</h2><p>Configure the offers shown on the public Home page. Map each offer to your XUI One playlist category or bouquet IDs, choose the account type, set duration and simultaneous connection limits, and define the public price. This catalogue does not modify existing provider, playlist, or playback routes.</p>${saved ? `<div class="notice success">Plan catalogue saved.</div>` : ""}<div class="plan-toolbar"><span class="muted">${plans.length} plan${plans.length === 1 ? "" : "s"} configured · ${plans.filter((plan) => plan.active).length} public</span><a class="primary" style="display:inline-block;text-decoration:none" href="/admin/plans#new-plan">Add plan</a></div></section><div class="plans-admin-grid">${editors}<article id="new-plan" class="plan-editor plan-editor--new">${renderPlanEditor(emptyPlan())}</article></div>`)
}

const readBillingStats = () => {
  const totals = db.prepare("SELECT COUNT(DISTINCT CASE WHEN s.status = 'active' AND COALESCE(s.current_period_end, 0) > ? THEN s.client_user_id END) AS active_subscribers, COALESCE(SUM(CASE WHEN e.status = 'succeeded' THEN e.amount ELSE 0 END), 0) AS revenue_cents, COUNT(CASE WHEN e.status = 'succeeded' THEN 1 END) AS successful_payments FROM client_subscriptions s LEFT JOIN payment_events e ON e.client_user_id = s.client_user_id").get(now())
  const plans = db.prepare("SELECT p.id, p.name, p.slug, p.currency, COUNT(DISTINCT CASE WHEN s.status = 'active' AND COALESCE(s.current_period_end, 0) > ? THEN s.client_user_id END) AS active_subscribers, COALESCE(SUM(CASE WHEN e.status = 'succeeded' AND e.plan_id = p.id THEN e.amount ELSE 0 END), 0) AS revenue_cents FROM subscription_plans p LEFT JOIN client_subscriptions s ON s.plan_id = p.id LEFT JOIN payment_events e ON e.plan_id = p.id GROUP BY p.id ORDER BY active_subscribers DESC, revenue_cents DESC, p.sort_order ASC, p.id ASC").all(now())
  return { activeSubscribers: Number(totals?.active_subscribers || 0), revenueCents: Number(totals?.revenue_cents || 0), successfulPayments: Number(totals?.successful_payments || 0), plans: plans.map((row) => ({ name: row.name, slug: row.slug, currency: row.currency, activeSubscribers: Number(row.active_subscribers || 0), revenueCents: Number(row.revenue_cents || 0) })) }
}
const moneyLabel = (cents, currency = "EUR") => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: String(currency || "EUR").toUpperCase() }).format(Number(cents || 0) / 100) } catch { return `${(Number(cents || 0) / 100).toFixed(2)} ${String(currency || "EUR").toUpperCase()}` } }
const renderBillingAdmin = (admin) => {
  const stats = readBillingStats()
  const rows = stats.plans.map((plan) => `<tr><td><strong>${escapeHtml(plan.name)}</strong><small>${escapeHtml(plan.slug)}</small></td><td>${plan.activeSubscribers}</td><td>${escapeHtml(moneyLabel(plan.revenueCents, plan.currency))}</td><td><a class="logout" style="display:inline-block;text-decoration:none" href="/admin/plans">Edit plan</a></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No plans configured.</td></tr>`
  const content = `<section class="grid"><div class="stat"><span>Active subscribers</span><strong>${stats.activeSubscribers}</strong><span>Paid or active access</span></div><div class="stat"><span>Recorded revenue</span><strong>${escapeHtml(moneyLabel(stats.revenueCents, "EUR"))}</strong><span>${stats.successfulPayments} successful payment event${stats.successfulPayments === 1 ? "" : "s"}</span></div><div class="stat"><span>Payment provider</span><strong>${stripeSecretKey() ? "Stripe" : "Setup needed"}</strong><span>${stripeSecretKey() ? "Checkout is configured" : "Add STRIPE_SECRET_KEY"}</span></div></section><section class="panel billing-panel"><div class="eyebrow">Subscriber intelligence</div><h2>Subscribers and revenue by plan</h2><p>Revenue is calculated from verified payment webhook events. Active subscribers are clients with an active subscription whose current period has not ended.</p><div class="billing-table-wrap"><table class="billing-table"><thead><tr><th>Plan</th><th>Active subscribers</th><th>Recorded revenue</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`
  return dashboardFrame(admin, "billing", "Billing analytics", "Subscriptions & revenue", content)
}
const sendSmtp = async (to, subject, text) => {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
  const from = process.env.SMTP_FROM || user
  if (!host || !user || !pass || !from) throw new Error("SMTP is not configured")
  const tls = port === 465
  const transport = await import(tls ? "node:tls" : "node:net")
  const socket = await new Promise((resolve, reject) => {
    const s = tls ? transport.connect({ host, port, servername: host }, () => resolve(s)) : transport.createConnection({ host, port }, () => resolve(s))
    s.once("error", reject)
  })
  socket.setEncoding("utf8")
  const readResponse = () => new Promise((resolve, reject) => {
    let data = ""
    const onData = (chunk) => { data += chunk; if (/^\d{3} /.test(data.split("\n").pop()?.trim() || "")) { socket.off("data", onData); resolve(data) } }
    socket.on("data", onData); socket.once("error", reject)
  })
  const command = async (line, expected) => { socket.write(`${line}\r\n`); const response = await readResponse(); if (expected && !response.startsWith(expected)) throw new Error(`SMTP error: ${response.trim()}`) }
  await readResponse(); await command(`EHLO ${process.env.SMTP_HELO || "localhost"}`, "250")
  await command("AUTH LOGIN", "334")
  await command(Buffer.from(user).toString("base64"), "334")
  await command(Buffer.from(pass).toString("base64"), "235")
  await command(`MAIL FROM:<${from}>`, "250"); await command(`RCPT TO:<${to}>`, "250"); await command("DATA", "354")
  socket.write(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text.replace(/^\./gm, "..")}\r\n.\r\n`)
  await readResponse(); await command("QUIT", "221"); socket.end()
}

const router = async (request, response, url) => {
  const { pathname } = url
  if (pathname === "/admin/login" && request.method === "GET") return sendHtml(response, renderLogin())
  if (pathname === "/admin/login" && request.method === "POST") {
    const body = await parseBody(request)
    const user = db.prepare("SELECT * FROM admin_users WHERE username = ?").get(String(body.username || ""))
    if (!user || !(await verifyPassword(String(body.password || ""), user.password_salt, user.password_hash))) return sendHtml(response, renderLogin("Invalid admin username or password."), 401)
    createSession(user.id, response)
    redirect(response, user.must_change_password ? "/admin/security?force=1" : "/admin")
    return
  }
  if (pathname === "/admin/forgot" && request.method === "GET") return sendHtml(response, renderForgot())
  if (pathname === "/admin/forgot" && request.method === "POST") {
    const body = await parseBody(request)
    const user = db.prepare("SELECT * FROM admin_users WHERE username = ? AND lower(email) = lower(?)").get(ADMIN_USERNAME, String(body.email || ""))
    if (!user) return sendHtml(response, renderForgot("If that email matches the admin account, a reset link will be sent.", ""))
    const token = makeToken(32)
    db.prepare("INSERT INTO admin_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(hashToken(token), user.id, now() + RESET_TTL_SECONDS, now())
    const link = `${APP_ORIGIN}/admin/reset?token=${encodeURIComponent(token)}`
    try { await sendSmtp(user.email, "AitvarasTV admin password reset", `Use this one-time link to reset your admin password:\n\n${link}\n\nThe link expires in 30 minutes.`) } catch (error) { console.error(error); return sendHtml(response, renderForgot("SMTP is not configured yet. Add SMTP_* values to the Ubuntu .env file, then try again."), 503) }
    return sendHtml(response, renderForgot("If that email matches the admin account, a reset link has been sent."))
  }
  if (pathname === "/admin/reset" && request.method === "GET") return sendHtml(response, renderReset(url.searchParams.get("token") || ""))
  if (pathname === "/admin/reset" && request.method === "POST") {
    const body = await parseBody(request)
    const reset = db.prepare("SELECT * FROM admin_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").get(hashToken(String(body.token || "")), now())
    if (!reset || String(body.password || "") !== String(body.password2 || "") || String(body.password || "").length < 12) return sendHtml(response, renderReset(String(body.token || ""), "The reset link is invalid or the passwords do not match. Use at least 12 characters."), 400)
    const credentials = await passwordHash(String(body.password))
    db.prepare("UPDATE admin_users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?").run(credentials.hash, credentials.salt, now(), reset.user_id)
    db.prepare("UPDATE admin_reset_tokens SET used_at = ? WHERE token_hash = ?").run(now(), hashToken(String(body.token || "")))
    db.prepare("DELETE FROM admin_sessions WHERE user_id = ?").run(reset.user_id)
    return sendHtml(response, pageShell("Password changed", `<main class="login-wrap"><section class="login-card"><div class="eyebrow">Success</div><h1>Password changed</h1><p>Your admin password was updated. Sign in with the new password.</p><a class="primary" style="display:inline-block;text-decoration:none" href="/admin/login">Go to admin login</a></section></main>`))
  }
  if (pathname === "/admin/logout" && request.method === "POST") {
    const raw = parseCookies(request.headers.cookie || "")[COOKIE_NAME]
    if (raw) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(raw))
    clearCookie(response); redirect(response, "/admin/login"); return
  }
  const admin = requireAdmin(request, response)
  if (!admin) return
  if (pathname === "/admin/features" && request.method === "POST") {
    const body = await parseBody(request)
    writeSettingsPolicy(body)
    redirect(response, "/admin/features?saved=1")
    return
  }
  if (pathname === "/admin/guest-preview" && request.method === "POST") {
    const body = await parseBody(request)
    writeGuestPreviewPolicy(body)
    redirect(response, "/admin/guest-preview?saved=1")
    return
  }
  if (pathname === "/admin/plans/save" && request.method === "POST") {
    const body = await parseBody(request)
    upsertSubscriptionPlan(body)
    redirect(response, "/admin/plans?saved=1")
    return
  }
  if (pathname === "/admin/plans/delete" && request.method === "POST") {
    const body = await parseBody(request)
    const id = clampInt(body.id, 0, 0, Number.MAX_SAFE_INTEGER)
    if (id) db.prepare("DELETE FROM subscription_plans WHERE id = ?").run(id)
    redirect(response, "/admin/plans?saved=1")
    return
  }
  if (pathname === "/admin" && request.method === "GET") {
    const force = url.searchParams.get("force")
    const content = `${force ? `<div class="notice">For security, change the temporary bootstrap password before continuing.</div>` : ""}<div class="grid"><div class="stat"><span>Admin account</span><strong>${escapeHtml(admin.username)}</strong><span>Separate from platform users</span></div><div class="stat"><span>Session</span><strong>Active</strong><span>Protected HttpOnly cookie</span></div><div class="stat"><span>Recovery</span><strong>${admin.email ? "Ready" : "Setup needed"}</strong><span>${admin.email ? "SMTP reset can be enabled" : "Add admin email in .env"}</span></div></div><section class="panel"><div class="eyebrow">Control center</div><h2>Welcome to your private admin dashboard.</h2><p>Manage the platform presentation and open the existing settings surface inside this protected admin shell. The public playlist account remains separate.</p><p><a class="primary" style="display:inline-block;text-decoration:none" href="/admin/features">Manage client Settings</a> <a class="logout" style="display:inline-block;text-decoration:none;margin-left:8px" href="/admin/settings">Open settings dashboard</a></p></section>`
    return sendHtml(response, dashboardFrame(admin, "overview", "Admin dashboard", "Private control center", content))
  }
  if (pathname === "/admin/billing" && request.method === "GET") {
    return sendHtml(response, renderBillingAdmin(admin))
  }
  if (pathname === "/admin/plans" && request.method === "GET") {
    return sendHtml(response, renderPlansAdmin(admin, url.searchParams.get("saved") === "1"))
  }
  if (pathname === "/admin/guest-preview" && request.method === "GET") {
    const policy = readGuestPreviewPolicy()
    const saved = url.searchParams.get("saved")
    const content = `<section class="panel feature-panel"><div class="eyebrow">Public viewing access</div><h2>Guest preview control</h2><p>Set how long an unauthenticated visitor may preview Live TV, Movies, TV Shows, and Series. When the timer ends, playback is stopped and the viewer is shown the plan selection prompt.</p>${saved ? `<div class="notice success">Guest preview policy saved.</div>` : ""}<form method="post" action="/admin/guest-preview" class="form"><label class="master-toggle"><input type="checkbox" name="enabled" ${policy.enabled ? "checked" : ""}><span><strong>Allow guest preview</strong><small>Disable this to stop playback immediately for visitors who are not signed in.</small></span><em>${policy.enabled ? "Enabled" : "Disabled"}</em></label><label>Preview duration (seconds)<input name="durationSeconds" type="number" min="0" max="86400" step="1" value="${policy.durationSeconds}" required><small>Use 30 for a 30-second preview. Use 0 to stop guests immediately when playback starts.</small></label><div class="feature-actions"><button class="primary" type="submit">Save guest preview</button><span class="muted">The new limit applies when the next media preview starts.</span></div></form></section>`
    return sendHtml(response, dashboardFrame(admin, "guest-preview", "Guest preview", "Public access", content))
  }
  if (pathname === "/admin/features" && request.method === "GET") {
    const policy = readSettingsPolicy()
    const saved = url.searchParams.get("saved")
    const groups = [
      ["Playlists", ["playlists"]],
      ["Appearance", ["appearance.display", "appearance.behavior", "appearance.homeSections"]],
      ["Watching", ["watching.liveTv", "watching.playback"]],
      ["Network", ["network.network", "network.discord", "network.tmdb", "network.netLog"]],
      ["Library", ["library.categories", "library.favorites"]],
      ["Data", ["data.downloads", "data.backup", "data.storage"]],
      ["About", ["about.update", "about.changelog", "about.licenses"]],
      ["Help & feedback", ["help.docs", "help.feedback", "help.support"]],
      ["Danger zone", ["danger"]],
    ]
    const cards = groups.map(([group, keys]) => `<section class="feature-group"><div class="feature-group__head"><div><div class="eyebrow">Client Settings</div><h3>${escapeHtml(group)}</h3></div><button type="button" class="select-group" data-group="${keys.join(",")}">Toggle group</button></div>${keys.map((key) => { const item = SETTINGS_FEATURES[key]; return `<label class="feature-row"><input type="checkbox" name="feature.${escapeHtml(key)}" ${policy.features[key] ? "checked" : ""}><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></span><em>${policy.features[key] ? "Visible" : "Hidden"}</em></label>` }).join("")}</section>`).join("")
    const content = `<section class="panel feature-panel"><div class="eyebrow">Client experience access</div><h2>Control Settings visibility</h2><p>Choose which Settings areas clients can see. This controls the public Settings page and its Account menu entry; it does not remove or alter the existing playlist, playback, or provider APIs.</p>${saved ? `<div class="notice success">Client Settings policy saved.</div>` : ""}<form method="post" action="/admin/features" id="feature-policy-form"><label class="master-toggle"><input type="checkbox" name="enabled" ${policy.enabled ? "checked" : ""}><span><strong>Enable client Settings page</strong><small>When disabled, clients see a short unavailable message instead of the Settings controls.</small></span><em>${policy.enabled ? "Enabled" : "Disabled"}</em></label><div class="feature-toolbar"><button type="button" class="logout" id="enable-all">Enable all</button><button type="button" class="logout" id="disable-all">Disable all</button><span class="muted">Last saved: ${new Date(policy.updatedAt * 1000).toLocaleString()}</span></div>${cards}<div class="feature-actions"><button class="primary" type="submit">Save client controls</button><span class="muted">Changes apply when the client next loads Settings.</span></div></form></section><script>document.querySelectorAll(".select-group").forEach((button)=>button.addEventListener("click",()=>{const keys=button.dataset.group.split(",");const boxes=keys.map((key)=>document.querySelector('input[name="feature.'+key+'"]')).filter(Boolean);const enabled=boxes.some((box)=>!box.checked);boxes.forEach((box)=>box.checked=enabled)}));document.getElementById("enable-all")?.addEventListener("click",()=>document.querySelectorAll('#feature-policy-form input[type="checkbox"]').forEach((box)=>box.checked=true));document.getElementById("disable-all")?.addEventListener("click",()=>document.querySelectorAll('#feature-policy-form input[type="checkbox"]').forEach((box)=>box.checked=false));</script>`
    return sendHtml(response, dashboardFrame(admin, "features", "Client controls", "Admin configuration", content))
  }
  if (pathname === "/admin/settings" && request.method === "GET") {
    const content = `<section class="panel"><div class="eyebrow">Platform configuration</div><h2>Settings dashboard</h2><p>Use <a href="/admin/features">Client controls</a> to decide which Settings functions are visible to clients. The existing settings page is displayed below with its client-side handlers and local preferences unchanged.</p><iframe class="settings-frame" src="/settings" title="Existing AitvarasTV settings"></iframe></section>`
    return sendHtml(response, dashboardFrame(admin, "settings", "Settings", "Admin configuration", content))
  }
  if (pathname === "/admin/security" && request.method === "GET") {
    const force = url.searchParams.get("force")
    const content = `${force ? `<div class="notice">Your bootstrap password is temporary. Change it now.</div>` : ""}<section class="panel"><div class="eyebrow">Account protection</div><h2>Change admin password</h2><p>Passwords are stored with Node scrypt hashes. The admin account is independent from the public playlist account.</p><form class="form" method="post" action="/admin/security"><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>New password<input name="newPassword" type="password" minlength="12" autocomplete="new-password" required></label><label>Repeat new password<input name="newPassword2" type="password" minlength="12" autocomplete="new-password" required></label><button class="primary" type="submit">Update password</button></form></section>`
    return sendHtml(response, dashboardFrame(admin, "security", "Security", "Admin account", content))
  }
  if (pathname === "/admin/security" && request.method === "POST") {
    const body = await parseBody(request)
    const valid = await verifyPassword(String(body.currentPassword || ""), admin.password_salt, admin.password_hash)
    if (!valid || String(body.newPassword || "") !== String(body.newPassword2 || "") || String(body.newPassword || "").length < 12) return sendHtml(response, dashboardFrame(admin, "security", "Security", "Admin account", `<div class="notice error">Current password is invalid, or the new passwords do not match / are shorter than 12 characters.</div>`), 400)
    const credentials = await passwordHash(String(body.newPassword))
    db.prepare("UPDATE admin_users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?").run(credentials.hash, credentials.salt, now(), admin.id)
    db.prepare("DELETE FROM admin_sessions WHERE user_id = ?").run(admin.id)
    clearCookie(response); redirect(response, "/admin/login?changed=1"); return
  }
  return sendHtml(response, "Not found", 404)
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, APP_ORIGIN)
    if (url.pathname === "/api/webhooks/stripe" && request.method === "POST") {
      const rawBody = await readRawBody(request)
      if (!verifyStripeSignature(rawBody, request.headers["stripe-signature"])) return sendJson(response, { error: "Invalid Stripe signature." }, 400)
      let event
      try { event = JSON.parse(rawBody) } catch { return sendJson(response, { error: "Invalid webhook JSON." }, 400) }
      applyStripeCheckoutEvent(event)
      return sendJson(response, { received: true })
    }
    if (url.pathname === "/api/settings-policy" && request.method === "GET") return sendJson(response, readSettingsPolicy())
    if (url.pathname === "/api/guest-preview-policy" && request.method === "GET") return sendJson(response, readGuestPreviewPolicy())
    if (url.pathname === "/api/plans" && request.method === "GET") return sendJson(response, { plans: listSubscriptionPlans(true) })
    if (url.pathname === "/api/auth/me" && request.method === "GET") return sendJson(response, viewerAccess(request))
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      const body = await parseBody(request)
      const email = normalizeEmail(body.email)
      const password = String(body.password || "")
      const planSlug = String(body.planSlug || "").trim().toLowerCase()
      if (!validEmail(email)) return sendJson(response, { error: "Enter a valid email address." }, 400)
      if (password.length < 8) return sendJson(response, { error: "Password must be at least 8 characters." }, 400)
      if (!planSlug) return sendJson(response, { error: "Choose a plan before creating your account." }, 400)
      const plan = db.prepare("SELECT * FROM subscription_plans WHERE slug = ? AND active = 1").get(planSlug)
      if (!plan) return sendJson(response, { error: "That plan is no longer available. Refresh and choose another plan." }, 400)
      if (db.prepare("SELECT id FROM client_users WHERE email = ?").get(email)) return sendJson(response, { error: "An account with that email already exists. Sign in instead." }, 409)
      const credentials = await passwordHash(password)
      const result = db.prepare("INSERT INTO client_users (email, display_name, password_hash, password_salt, plan_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'client', ?, ?)").run(email, String(body.displayName || "").trim().slice(0, 80), credentials.hash, credentials.salt, plan.id, now(), now())
      createClientSession(Number(result.lastInsertRowid), response)
      const created = db.prepare("SELECT u.*, p.slug AS plan_slug, p.name AS plan_name, p.category AS plan_category, p.bouquet_ids AS plan_bouquet_ids, p.account_type AS plan_account_type, p.duration_days AS plan_duration_days, p.max_connections AS plan_max_connections FROM client_users u LEFT JOIN subscription_plans p ON p.id = u.plan_id WHERE u.id = ?").get(Number(result.lastInsertRowid))
      return sendJson(response, { ok: true, access: clientAccessFromUserWithBilling(created) }, 201)
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await parseBody(request)
      const email = normalizeEmail(body.email)
      const user = db.prepare("SELECT * FROM client_users WHERE email = ?").get(email)
      if (!user || !(await verifyPassword(String(body.password || ""), user.password_salt, user.password_hash))) return sendJson(response, { error: "Invalid email or password." }, 401)
      createClientSession(user.id, response)
      const accessUser = db.prepare("SELECT u.*, p.slug AS plan_slug, p.name AS plan_name, p.category AS plan_category, p.bouquet_ids AS plan_bouquet_ids, p.account_type AS plan_account_type, p.duration_days AS plan_duration_days, p.max_connections AS plan_max_connections FROM client_users u LEFT JOIN subscription_plans p ON p.id = u.plan_id WHERE u.id = ?").get(user.id)
      return sendJson(response, { ok: true, access: clientAccessFromUserWithBilling(accessUser) })
    }
    if (url.pathname === "/api/auth/select-plan" && request.method === "POST") {
      const user = readClientUser(request)
      if (!user) return sendJson(response, { error: "Sign in before choosing a plan." }, 401)
      const body = await parseBody(request)
      const planSlug = String(body.planSlug || "").trim().toLowerCase()
      const plan = db.prepare("SELECT * FROM subscription_plans WHERE slug = ? AND active = 1").get(planSlug)
      if (!plan) return sendJson(response, { error: "That plan is no longer available." }, 400)
      db.prepare("UPDATE client_users SET plan_id = ?, updated_at = ? WHERE id = ?").run(plan.id, now(), user.id)
      return sendJson(response, { ok: true, access: viewerAccess(request) })
    }
    if (url.pathname === "/api/auth/password" && request.method === "POST") {
      const user = readClientUser(request)
      if (!user) return sendJson(response, { error: "Sign in before changing your password." }, 401)
      const body = await parseBody(request)
      const currentPassword = String(body.currentPassword || "")
      const newPassword = String(body.newPassword || "")
      if (!(await verifyPassword(currentPassword, user.password_salt, user.password_hash)) || newPassword.length < 8 || newPassword !== String(body.newPassword2 || "")) return sendJson(response, { error: "Current password is invalid, or the new passwords do not match / are shorter than 8 characters." }, 400)
      const credentials = await passwordHash(newPassword)
      db.prepare("UPDATE client_users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?").run(credentials.hash, credentials.salt, now(), user.id)
      db.prepare("DELETE FROM client_sessions WHERE user_id = ? AND token_hash != ?").run(user.id, hashToken(parseCookies(request.headers.cookie || "")[CLIENT_COOKIE_NAME] || ""))
      return sendJson(response, { ok: true })
    }
    if (url.pathname === "/api/billing/checkout" && request.method === "POST") {
      const user = readClientUser(request)
      if (!user) return sendJson(response, { error: "Sign in before starting checkout." }, 401)
      const body = await parseBody(request)
      const planSlug = String(body.planSlug || "").trim().toLowerCase()
      const plan = db.prepare("SELECT * FROM subscription_plans WHERE slug = ? AND active = 1").get(planSlug)
      if (!plan) return sendJson(response, { error: "That plan is no longer available." }, 400)
      try {
        const session = await createStripeCheckoutSession(user, plan)
        db.prepare("INSERT INTO client_subscriptions (client_user_id, plan_id, provider, provider_payment_id, status, created_at, updated_at) VALUES (?, ?, 'stripe', ?, 'pending', ?, ?)").run(user.id, plan.id, String(session.id || ""), now(), now())
        return sendJson(response, { ok: true, provider: "stripe", url: session.url, sessionId: session.id })
      } catch (error) {
        return sendJson(response, { error: error instanceof Error ? error.message : "Checkout is unavailable." }, 503)
      }
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const raw = parseCookies(request.headers.cookie || "")[CLIENT_COOKIE_NAME]
      if (raw) db.prepare("DELETE FROM client_sessions WHERE token_hash = ?").run(hashToken(raw))
      clearClientCookie(response)
      return sendJson(response, { ok: true })
    }
    if ((url.pathname === "/register" || url.pathname === "/signup") && request.method === "GET") {
      redirect(response, `/auth?mode=register&next=${encodeURIComponent(safeNextPath(url.searchParams.get("next") || "/"))}`)
      return
    }
    if (url.pathname.startsWith("/admin")) return await router(request, response, url)
    if (clientAccessRedirect(request, response, url)) return
    const filePath = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, ""))
    const safePath = path.resolve(filePath)
    if (!safePath.startsWith(path.resolve(DIST))) return sendHtml(response, "Forbidden", 403)
    let actual = safePath
    if (!fs.existsSync(actual) || fs.statSync(actual).isDirectory()) actual = path.join(actual, "index.html")
    if (!fs.existsSync(actual)) return sendHtml(response, "Not found", 404)
    const ext = path.extname(actual)
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" }
    response.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable" })
    fs.createReadStream(actual).pipe(response)
  } catch (error) { console.error(error); sendHtml(response, "Internal server error", 500) }
})
server.listen(PORT, HOST, () => console.log(`AitvarasTV server listening on ${APP_ORIGIN} (admin: /admin/login)`))

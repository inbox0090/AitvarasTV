# Admin dashboard setup

The existing Astro app remains the public frontend. The optional Node server in `server/index.mjs` serves the built `dist/` directory and exposes an independent admin surface at `/admin/login`. The admin surface also includes `/admin/features`, where client-visible Settings areas can be enabled or disabled without changing the existing IPTV APIs, playlist logic, playback handlers, or provider routes.

## Local run

```bash
pnpm run build
cp .env.admin.example .env.admin
# Edit .env.admin before enabling password recovery.
set -a; . ./.env.admin; set +a
pnpm run admin:server
```

Open `http://127.0.0.1:4321/admin/login`. The bootstrap account is `admin` / `admin` only when the database is created for the first time. The first successful login redirects to Security and requires a new password of at least 12 characters. Passwords are stored as Node `scrypt` hashes; the plain password is never stored.

## Ubuntu Server

Build the frontend and copy the project to the server. Then install Node.js 22+, create the data directory and configure the environment outside the repository:

```bash
sudo mkdir -p /var/lib/extreme-infinitv /etc/extreme-infinitv
sudo cp .env.admin.example /etc/extreme-infinitv/admin.env
sudo nano /etc/extreme-infinitv/admin.env
sudo chown -R www-data:www-data /var/lib/extreme-infinitv
```

Set `ADMIN_DB_PATH=/var/lib/extreme-infinitv/admin.sqlite`, a real `APP_ORIGIN`, and SMTP values in `/etc/extreme-infinitv/admin.env`. Keep the file readable only by root and the service user:

```bash
sudo chmod 640 /etc/extreme-infinitv/admin.env
sudo chown root:www-data /etc/extreme-infinitv/admin.env
```

Create `/etc/systemd/system/extreme-infinitv.service`:

```ini
[Unit]
Description=Extreme InfiniTV public frontend and admin dashboard
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/extreme-infinitv
EnvironmentFile=/etc/extreme-infinitv/admin.env
ExecStart=/usr/bin/node /opt/extreme-infinitv/server/index.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/extreme-infinitv

[Install]
WantedBy=multi-user.target
```

Enable it with:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now extreme-infinitv
sudo systemctl status extreme-infinitv
```

Put Nginx or another TLS reverse proxy in front of `127.0.0.1:4321`. Use HTTPS in `APP_ORIGIN`; the session cookie automatically receives the `Secure` flag in production. Do not expose the Node port directly to the public internet.

## Client Settings controls

After signing in, open **Client controls** or visit `/admin/features`. The master switch named **Enable client Settings page** controls whether clients can open Settings at all. When it is disabled, the Settings entry disappears from the Account menu and the public `/settings` route shows an administrator-unavailable message; playlists and playback remain available.

The same page provides separate switches for Playlists, Appearance, Watching, Network, Library, Data, About, Help & feedback, and Danger zone. Use **Toggle group** for a category or **Enable all / Disable all** for a quick policy change, then press **Save client controls**. The policy is stored in the admin SQLite database and is returned to the public frontend through the same-origin `GET /api/settings-policy` endpoint. If that endpoint is unavailable, the frontend fails open and preserves the original Settings behaviour.

## Recovery email

The Forgot password form is designed to avoid account enumeration. When `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` and `ADMIN_EMAIL` are configured, it creates a single-use reset token that expires after 30 minutes and sends the link by email. SMTP credentials belong only in `/etc/extreme-infinitv/admin.env`.

If SMTP is not configured, the UI shows a setup message rather than pretending that a reset email was sent. Existing platform settings are shown inside the authenticated `/admin/settings` shell; their client-side handlers and the IPTV backend remain separate and unchanged. The new Client controls only changes visibility at the public UI layer; it does not delete settings data or remove any existing frontend handlers.


## Plans and pricing

After signing in, open **Plans & pricing** or visit `/admin/plans`. The dashboard seeds Basic, Standard, and Premium as editable catalogue offers. You can add or edit any number of plans and configure the public name, slug, playlist category / bouquet group, XUI account type, XUI bouquet IDs, duration in days, maximum simultaneous connections, price, currency, billing label, feature list, sort order, public visibility, featured badge, and the existing `/login` or external checkout URL.

The XUI fields are intentionally stored as a plan-to-provider mapping. The current project does not invent an XUI endpoint or provider credentials and does not automatically create lines, renewals, or reseller accounts. Enter the bouquet IDs and account type that match the account/package setup in your own XUI One panel; the plan then describes those limits to customers while the existing playlist and Xtream connection handlers remain unchanged.

The public Home page calls `GET /api/plans` and shows active plans only. Prices greater than zero are formatted with the configured currency; a zero price keeps the safe `Provider pricing` fallback until an administrator enters a real price. The checkout CTA remains `/login` unless you explicitly configure an allowed same-origin path or HTTPS URL.


## Client registration, login, and plan access

The Node server now exposes `/auth` as the client account page. A guest request to the Home page or any public application page is redirected to `/auth` with a safe `next` path. The Create account tab requires an email, an eight-character minimum password, a matching repeat password, and one active plan. The selected plan is stored on the client account and the user is then returned to the requested page.

The existing `/login` route remains the playlist onboarding surface, but it is now available only after client authentication. This preserves the original playlist form and its provider handlers while preventing anonymous access to the application pages. A client session is stored in the separate `client_sessions` table and uses an HttpOnly, SameSite cookie with a 30-day lifetime.

Live TV applies the selected plan before the existing category picker, search, sort, EPG, and virtual list code. The plan's category and comma-separated XUI bouquet IDs are matched against channel category and bouquet fields. Plans configured with `General` or `All` remain catch-all until the administrator maps them to a concrete category or bouquet. The separate admin session is checked first, so the admin dashboard account can open `/livetv` and see all channels without a client plan or payment.

This release does not process payments. Selecting a plan grants the configured catalogue access in the application; payment provisioning can be connected later using each plan's checkout URL and a separate payment/provider integration.


## Guest preview limit

Open `/admin/guest-preview` to control the unauthenticated media preview. The default policy allows 30 seconds. Change `Preview duration (seconds)` to any whole number from 0 to 86,400 and save. A value of `0` stops guest playback immediately when media starts. Clearing `Allow guest preview` also stops guest playback immediately.

The guest timer is mounted globally from `Layout.astro` and listens to the existing HTML media elements used by Live TV, Movies, TV Shows, and Series. It does not replace the existing player, provider, playlist, or playback handlers. When the limit expires, the current media is paused and unloaded, then a plan-selection modal links to `/auth?mode=register` and the sign-in flow. Authenticated client sessions and the separate admin session are not timed by this policy; the admin role has unrestricted preview access.


## Billing analytics and Stripe Checkout

The admin navigation now includes `/admin/billing`. It shows the number of active client subscribers, verified successful payment events, recorded revenue, provider setup status, and a per-plan table. Revenue is counted only from accepted Stripe webhook events; creating a pending checkout session does not count as income.

The current implementation uses Stripe Checkout with one-time payments based on the plan price and duration configured under `/admin/plans`. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to the private server environment. Configure the Stripe webhook endpoint as `https://your-domain.example/api/webhooks/stripe` and subscribe it to `checkout.session.completed`. The webhook signature is checked server-side before the event is processed. On a paid completion, the system records the event, activates or extends the selected plan, updates the client plan, and makes the access period visible in `/account`.

Two viable payment approaches are supported at the product-design level:

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---|---|
| Stripe Checkout (implemented) | Hosted checkout, server webhook confirmation, simple one-time plan payments; requires Stripe keys and webhook configuration. | Stripe processing fees apply; no card data is stored in this project. | Medium |
| PayPal Checkout | Familiar PayPal wallet experience and an alternative payment provider; would require PayPal client credentials, order capture, webhook verification, and a separate provider adapter. | PayPal processing fees apply; provider configuration is separate from Stripe. | Medium to high |

Stripe is implemented first because it fits the existing plan-price catalog and gives the server a direct verified checkout completion event. PayPal can be added later behind the same `/api/billing/checkout` abstraction without changing client plan or channel filtering logic.

## Client Account settings

Authenticated clients can open `/account` from the Account menu. The page displays the current plan, category, duration, connection limit, and payment status. A client can select a different plan, start Stripe Checkout for a paid plan, extend access with the same plan, and change the account password. Password changes use the existing scrypt hashing approach and invalidate other client sessions.

## Guest header state

The global header now shows `Sign in` and `Register` for guest visitors. After `/api/auth/me` confirms a client or admin session, those links are replaced by the existing Account dropdown. Admin users continue to receive full channel access and are not charged or filtered by client plan rules.


## Greitas viso projekto įdiegimas Ubuntu serveryje

Išskleiskite vieną projekto ZIP failą serveryje, pereikite į projekto katalogą ir paleiskite installerį kaip root. Jei serveryje nėra Node.js 22, installeris jį įdiegs automatiškai kartu su Nginx ir reikalingais paketais:

```bash
sudo bash deploy/install-ubuntu.sh tv.jusu-domenas.lt
```

Jei domenas dar nenukreiptas į serverį, laikinam vietiniam paleidimui naudokite:

```bash
sudo bash deploy/install-ubuntu.sh _
```

Installeris nukopijuoja projektą į `/opt/extreme-infinitv`, sukuria SQLite duomenų katalogą `/var/lib/extreme-infinitv`, sukuria systemd servisą, paleidžia Node serverį ir prijungia Nginx reverse proxy. Pirmą kartą atidarykite `/admin/login`, prisijunkite su pradiniu `admin / admin` ir iškart pakeiskite slaptažodį.

Po diegimo, jei reikia įjungti slaptažodžio atkūrimą arba mokėjimus, redaguokite privačią aplinką ir paleiskite servisą iš naujo:

```bash
sudo nano /etc/extreme-infinitv/admin.env
sudo systemctl restart extreme-infinitv
```

Domenui su HTTPS galima naudoti Certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tv.jusu-domenas.lt
```

Installeris pats nesukuria Stripe ar SMTP raktų. Jie turi būti įrašyti tik į `/etc/extreme-infinitv/admin.env`; tikrų raktų negalima dėti į frontend failus, ZIP archyvą ar GitHub.

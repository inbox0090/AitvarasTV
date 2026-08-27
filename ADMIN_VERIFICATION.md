# Admin dashboard verification

Local verification completed on 2026-08-27.

- `node --check server/index.mjs`: passed.
- `bash -n deploy/install-ubuntu.sh`: passed.
- `pnpm run build`: passed; Astro built 16 pages.
- Fresh SQLite bootstrap with `admin/admin`: login returned a redirect to `/admin/security?force=1`.
- Protected `/admin`, `/admin/settings`, and `/admin/security` routes returned HTTP 200 after login.
- Password change test on an isolated temporary database returned HTTP 303; the new password logged in successfully and the old password returned HTTP 401.
- Visual browser verification confirmed the separate dark admin login and security dashboard surfaces, with Overview, Settings, Security, Open platform, Sign out, and password-change controls.
- Forgot-password page is available at `/admin/forgot`; SMTP reset delivery remains disabled until `ADMIN_EMAIL` and `SMTP_*` values are configured in the deployment environment.

Screenshot paths from the browser verification:
- `/home/ubuntu/screenshots/127_0_0_1_2026-08-27_18-14-20_2211.webp` — admin login.
- `/home/ubuntu/screenshots/127_0_0_1_2026-08-27_18-14-33_5482.webp` — security dashboard.


The final browser pass also confirmed the public home surface at `/`: top navigation contains Home, Movies, Live TV, Series, Favorites, Search, and Account; the hero presents Play and More info actions; the home search field is present; the subscription comparison exposes Basic, Standard, and Premium cards; and the legacy account controls remain available from the Account menu rather than a left sidebar.

Additional screenshot path:
- `/home/ubuntu/screenshots/127_0_0_1_2026-08-27_18-15-12_9288.webp` — home page after closing the update modal.


## Client controls verification

The admin dashboard now includes a separate `Client controls` page at `/admin/features`. The browser check confirmed the master **Enable client Settings page** switch, **Enable all**, **Disable all**, group toggles, individual visibility checkboxes for all Settings areas, and **Save client controls**. The policy API returns enabled state plus per-feature flags. An isolated HTTP test confirmed that saving one disabled feature returns HTTP 303 and persists the flag, disabling the master returns HTTP 303 with `enabled: false`, and a subsequent restore returns HTTP 303.


## End-to-end client lock verification

Using the browser, the admin **Disable all** action was saved successfully at `/admin/features?saved=1`. The public `/settings` route then showed **Settings are currently unavailable**, hid the Settings controls and Settings shortcut from the Account menu, and kept the public Home, Movies, Live TV, Series, Favorites, playlist, and playback navigation available. The temporary policy was restored to all enabled afterward through the isolated server test database.


## Plans & pricing verification

The protected `/admin/plans` screen was checked in the browser. It shows the seeded Basic, Standard, and Premium plans plus the saved Sports Plus test plan. Each editor exposes plan name, slug, playlist category / bouquet group, XUI account type (line, trial, reseller package, or custom), XUI bouquet IDs, duration days, max simultaneous connections, price, currency, billing label, sort order, description, public checkout URL, active visibility, and featured status. The page also exposes Add plan, Save plan, Delete, and responsive dashboard navigation.

The test API returned active plans only through `GET /api/plans`; a protected plan save returned HTTP 303 and persisted Sports Plus with category `Sports`, bouquet IDs `12,14,19`, 90 days, 3 connections, EUR 14.99, and a `/login?plan=sports-plus` CTA.


## Plans and pricing end-to-end verification

The plan catalogue was tested with a fresh SQLite database. Bootstrap login created the admin session, the seeded Basic, Standard, and Premium plans were returned by `GET /api/plans`, and the protected `/admin/plans/save` action returned HTTP 303 while persisting a Sports Plus plan. The public Home page then rendered the active Sports Plus card with its configured `€14.99` price, `Sports` category, `3 connections`, `90 days`, and `/login?plan=sports-plus` CTA alongside the other active plans. Existing public navigation and the original `/login` onboarding route remained available.


## Client auth visual verification

The guest request to `/` redirected to `/auth?next=%2F`. The new account-access page rendered Sign in and Create account tabs, email/password fields, the plan picker surface, and links back to the public home and separate admin login. The previous global header/footer remained mounted around the auth page. A separate browser view confirmed the page loaded after the splash screen; the existing What's new dialog can still appear according to the app's normal first-run behavior.


## Register and plan selection verification

The `/auth?mode=register&next=%2F` view rendered Display name, Email, Password, Repeat password, and Basic/Standard/Premium plan choices. Selecting Standard updated the page status to `Standard selected.` and kept the Create account action available. The server-side register test already confirmed that the selected plan is persisted on the new client user session.


## Client auth regression verification

A fresh server test confirmed that an anonymous `/` request redirects to `/auth?next=%2F` and an anonymous `/livetv` request redirects to `/auth?next=%2Flivetv`. Registration with `viewer@example.com`, password `viewerpass123`, and the Standard plan returned HTTP 201 and created an HttpOnly client session; `/api/auth/me` reported role `client` and the selected Standard plan. Wrong client credentials returned HTTP 401, and client logout removed access so later protected page requests redirected back to auth. The separate bootstrap admin session returned role `admin` with `allChannels: true`, and both `/` and `/livetv` returned HTTP 200 without a client plan.

The deterministic `auth-access` module test passed: Sports category/bouquet matches were allowed, unrelated News was denied, and the admin bypass returned all test channels.


## Guest preview admin verification

The new protected navigation item `Guest preview` appears in the admin shell. The policy defaults to `enabled: true` and `durationSeconds: 30`; an authenticated admin POST changed the temporary test database value to 45 seconds, and the public `/api/guest-preview-policy` returned the updated value. The bootstrap admin still reports `allChannels: true`.


## Guest preview timer verification

The public `/` and `/livetv` content routes return HTTP 200 for an unauthenticated visitor so the visitor can start a limited preview. The public `/api/guest-preview-policy` endpoint seeded `enabled: true` and `durationSeconds: 30`. An authenticated admin changed the test value to 45 seconds, then saved a disabled policy and restored the enabled 30-second configuration. The admin page displayed the enabled switch and numeric seconds field. The global runtime stops and unloads all current video/audio elements when the guest duration expires; disabling the policy triggers the same stop immediately on the next guest play event. Authenticated clients and the admin role are excluded from this timer.


## Auth onboarding redesign verification

The `/auth?mode=register` screen now renders as a full two-panel streaming onboarding experience rather than unstyled text. The left panel contains the cinematic brand message, feature steps, and visual poster stack; the right panel contains the register form, plan picker, CTA, secure-access note, and existing auth controls. Switching to Sign in removes register-only fields and the plan picker while preserving the same visual hierarchy and all existing API handlers.


## Billing, account and guest navigation verification

The guest Home header now exposes Sign in and Register links after `/api/auth/me` returns a guest role. The member/admin Account menu remains available after an authenticated client or admin response. The Account settings page is built as a protected route with plan status, plan switching, Stripe checkout CTA, and password-change form. Billing analytics is available at `/admin/billing` and uses verified payment event records rather than pending checkout rows.


## AitvarasTV branding and What's new removal verification

The rebuilt Home page title and visible brand text use AitvarasTV. The guest header shows Sign in and Register. The automatic What's new v1.8.0 dialog and Got it action are absent from the rendered page after the splash transition.

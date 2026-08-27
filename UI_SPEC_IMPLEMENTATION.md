# Extreme InfiniTV UI/UX specifikacijos pritaikymas

Šis dokumentas susieja `pasted_content.txt` reikalavimus su realia projekto struktūra. Pritaikymas atliekamas tik frontend sluoksnyje: esami API kvietimai, lokalių duomenų talpyklos, maršrutai, grotuvo integracijos, naudotojo leidimai ir verslo logika paliekami nepakeisti.

## Įgyvendintas komponentų medis

```text
Layout.astro
├── TopNav.astro
│   ├── Primary navigation: Home / Movies / Live TV / Series / Favorites
│   ├── Search route: /search
│   └── AccountMenu.astro
│       ├── Existing playlist switcher and playlist state hooks
│       ├── Browse links: Live TV / Movies / Series / Favorites / Watch later
│       ├── EPG / Downloads / Settings
│       ├── Existing locale selector
│       └── Existing login / playlist actions
├── Page content slot
│   ├── Home: featured hero + browse tiles + HubStrips + membership plans
│   ├── Movies: filters + shared dynamic poster-card builder
│   ├── Series: filters + season/episode detail routes
│   ├── Live TV: channel list + player + EPG panel
│   ├── Search and discovery
│   └── Existing details, favorites, downloads, settings and EPG routes
└── CinemaFooter.astro
```

## Specifikacijos ir esamo kodo atitikimas

| Prisegto brief'o reikalavimas | Pritaikyta vieta | Apsaugota funkcija |
| --- | --- | --- |
| Dark Mode by default, juoda/pilka paletė ir akcentas | `src/styles/global.css`, `src/layouts/Layout.astro` | Temos pasirinkimas bei išsaugotos naudotojo preferencijos |
| Play, Info, Watchlist, Live indikatoriai | `index.astro`, `entry-card.ts`, `livetv.astro`, esami `status-badge` stiliai | Tie patys `href`, `data-role`, `aria-*` ir click handleriai |
| HD / kalbos / reitingo / watched badge | `entry-card.ts` (`buildLanguageChips`, rating badge, watched badge) | Esami mėgstamiausių ir watchlist būsenų patikrinimai |
| Search input | Esami `SearchInput.astro`, `/search` ir katalogo puslapių skriptai | Esami URL parametrai ir paieškos įvykiai |
| Skeleton / loading states | `global.css` (`logo-skel`) ir esami poster image lifecycle callback'ai | Esami `mountCachedImage` ir image fallback mechanizmai |
| Movie / Series kortelės su hover | `entry-card.ts` ir `.movie-card` CSS | `detailHref`, kontekstinis meniu, favorite/watchlist toggle |
| Live TV channel cards, EPG progress | `livetv.astro`, `ContinueWatching.svelte`, `epg-data` skriptai | Esami kanalo, EPG ir grotuvo DOM ID bei runtime įvykiai |
| Netflix tipo hero | Home `#featured-hero` ir esamas katalogo cache skaitymas | Hero tik skaito esamą VOD cache ir naudoja esamą movie detail route |
| Horizontalios turinio eilės | `HubStrips.svelte`, `ContinueWatching.svelte`, `FavoritesStrip.svelte` | Tie patys cache, preferences ir `xt:*` įvykiai |
| Video player karkasas | Esamas Live TV player, Video.js / Artplayer / Shaka runtime | Player initialization, playback, subtitles ir channel switching neliečiami |
| Responsive mobile / tablet / desktop | `global.css` media queries, esami `landscape` breakpoint'ai | Mobilus turinys, EPG collapse ir paskyros meniu išlieka pasiekiami |

## Dizaino tokenai

Pagrindinė vizualinė sistema naudoja esamus CSS kintamuosius, todėl spalvos keičiamos vienoje vietoje ir neįterpiamos į funkcinius skriptus.

```css
:root {
  --color-bg: #0f0f11;
  --color-surface: #17171b;
  --color-surface-2: #202026;
  --color-fg: #f7f7f8;
  --color-fg-2: #b4b4bd;
  --color-fg-3: #777782;
  --color-accent: #e50914;
  --color-accent-soft: color-mix(in oklch, var(--color-accent) 16%, transparent);
}
```

Katalogo kortelių hover sluoksnis naudoja tik CSS `transform`, `box-shadow` ir esamą `group-hover` būseną. Todėl jokie dinaminiai duomenys ar paspaudimų handleriai neperrašomi.

## Backend ir runtime apsauga

Ši specifikacija neprideda naujų API endpoint'ų ir nekeičia backend sutarties. Frontend ir toliau naudoja esamus `getCached`, `hydrateCache`, `getEntries`, `getActiveEntry`, `preferences`, `epg-data` ir grotuvo runtime modulius. Nauji vizualiniai elementai turi tik esamus DOM identifikatorius arba naujus dekoratyvinius wrapper'ius; jų veiksmus valdo ankstesni skriptai.

Ypač svarbūs išsaugoti kabliukai yra `#player`, `#list`, `#viewport`, `#epg`, `#featured-play`, `#featured-more`, `#account-menu-downloads`, `#ps-trigger`, `DOWNLOADS_LIST_EVENT`, `DOWNLOAD_PROGRESS_EVENT`, `xt:entries-updated` ir `xt:active-changed`.

## Patikrinimo planas

```bash
pnpm run build
pnpm test -- --run
git diff --check
```

Tikėtinas produkcinis rezultatas yra statinis Astro `dist/` katalogas. Ubuntu Server diegimui naudokite kartu pridėtą `deploy/install-ubuntu.sh` ir `UBUNTU_SERVER_INSTALL.md`; tai tik publikuoja esamą produkcinį frontend per Nginx ir nereikalauja backend logikos pakeitimo.

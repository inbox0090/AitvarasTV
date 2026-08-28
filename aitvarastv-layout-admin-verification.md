# AitvarasTV layout ir admin patikra

Patikra atlikta su lokaliu produkciniu Node serveriu `http://127.0.0.1:4323` po `pnpm run build`.

## Rezultatai

- `/movies` grąžina HTTP 200, turi `cinema-footer`, `movie-grid` ir AitvarasTV brandingą.
- `/admin/login` atsidaro kaip atskiras tamsus admin login paviršius su Username, Password ir Forgot admin password laukais.
- Serverio HTTP patikroje nauja SQLite bazė sukuria bootstrap `admin/admin`; POST `/admin/login` grąžina 303 į `/admin/security?force=1`.
- Astro build sugeneravo 18 puslapių.

## Pataisymai

Movies ir Series katalogų gridai nebeturi vidinio `flex-1 min-h-0 overflow-auto` viewport režimo; jų turinys teka kartu su dokumentu. Live TV išoriniai wrapperiai nebeužrakina viso puslapio į vieną viewport aukštį, o kanalų sąrašas lieka ribotu vidiniu scroll regionu. Bendras app shell ir CinemaFooter palikti normalioje dokumento tėkmėje su aiškiu viršutiniu tarpu.

Ubuntu diegimo vadovas pataisytas taip, kad naudotų `node server/index.mjs` per systemd ir Nginx reverse proxy; vien tik statinis Nginx `dist/` režimas admin route'ų neaptarnauja.

## DOM geometrinė patikra

Lokaliame Movies puslapyje computed stiliai parodė `app-content-shell` ir pagrindiniam `main` `overflow-y: visible`, `#movie-grid` `overflow-y: visible` bei `min-height: 224px`, o CinemaFooter `position: static`. Footer apatinė geometrija prasideda po gridu (`footerAfterGrid: true`), todėl jis neuždengia paskutinių filmų eilučių.

Series DOM patikra davė tokius pačius rezultatus kaip Movies: `shellOverflow`, `mainOverflow` ir `gridOverflow` yra `visible`, grid minimalus aukštis yra 224 px, footer `position` yra `static`, o `footerAfterGrid` yra `true`.

Live TV DOM patikra: `#livetv-page-main` overflow yra `visible`, jo aukštis 655 px, footer yra `position: static` ir prasideda po pagrindinio Live TV turinio (`footerAfterMain: true`). Vienintelis numatytas vidinis scrollas liko `#list` kanalo sąrašui (`overflowY: auto`, max-height 672 px); EPG ir išoriniai wrapperiai nebesukuria papildomo viewport apribojimo.

## Izoliuotas M3U Live TV testas

Frontend puslapis sėkmingai perskaitė testinio playlist įrašą iš `localStorage`, atidarė Live TV kanalų UI ir parodė provider klaidos būseną `Can't reach Local Live Fixture`. Pirmasis fixture serveris neturėjo `Access-Control-Allow-Origin` antraštės, todėl naršyklė blokavo cross-origin M3U užklausą dar prieš parserį. Tai patvirtino, kad klaidos UI ir retry kelias veikia; testas pakartojamas su CORS antraštę grąžinančiu vietiniu fixture serveriu.

## Live TV filtro pataisa ir sėkmingas M3U testas

Nustatyta priežastis: `auth-access.js` anksčiau grąžino `false` kiekvienam svečio kanalui, todėl kanalų sąrašas buvo tuščias dar prieš playback. Tai prieštaravo sukonfigūruotam 30 sekundžių guest preview režimui. Pataisyta taip, kad svečias matytų katalogą, o `guest-preview.js` toliau kontroliuotų atkūrimo trukmę; autentifikuoti klientai be plano vis dar negauna kanalų, o admin išlieka full-access.

Su lokaliu CORS M3U fixture po pataisos Live TV DOM patikra parodė `channelRows: 3`, `status: 3 of 3 channels`, aktyvų playlist įrašą, `mainOverflow: visible`, footer `position: static` ir `footerAfterMain: true`. Taigi parse, filtro, virtualaus sąrašo ir footer išdėstymo grandinė veikia.

## Pilnas frontend auditas

36 route/viewport kombinacijų (18 viešų route'ų desktop ir phone dydžiais) auditą atlikus prieš pataisas buvo rasta viena pasikartojanti web režimo konsolės klaida: `Could not get app version: ... reading 'invoke'`. Ji kilo todėl, kad `version.js` naršyklėje kvietė Tauri `getVersion/getName`. Dabar web režimas naudoja `x-app-version` meta reikšmę, o Tauri kvietimai vykdomi tik desktop runtime'e.

E2E scenarijus taip pat buvo pasenęs: jis bandė tiesiogiai atidaryti `/login`, nors dabartinis serveris tą route apsaugo ir reikalauja kliento sesijos. Testas dabar pirmiausia sukuria testinį klientą per `/auth`, o EPG navigacija vykdoma per galiojantį `/epg` route vietoje pašalinto sidebar selektoriaus.

Po pataisų: visos 36 route/viewport kombinacijos turi 0 page/console errors, 0 horizontal overflow atvejų ir 0 vietinių/GitHub request failure auditui; 18 e2e visual testų passed, 1 funkcinis e2e testas passed, o unit testų rinkinys išlieka 80 files / 1 755 tests passed.

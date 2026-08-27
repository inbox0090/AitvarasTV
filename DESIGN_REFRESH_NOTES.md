# Extreme InfiniTV — Streaming Platform UI Refresh

## Įgyvendinimo tikslas

Ši versija perstruktūruoja **tik vartotojo sąsają** į tamsią, aukštos klasės filmų ir serialų platformos patirtį. Išsaugotos esamos Tauri komandos, IPTV bei M3U tiekėjų užklausos, EPG, grotuvo integracijos, atsisiuntimai, maršrutai, formų identifikatoriai, lokalizacijos mechanizmas ir esami tekstai.

> Esama duomenų bei grojimo logika nebuvo perkeliama ar keičiama. Nauji komponentai tik naudoja jau esančius maršrutus ir vietinę katalogo talpyklą.

## Naujas vizualinis karkasas

| Sritis | Įgyvendinimas | Integracijos saugumas |
| --- | --- | --- |
| Viršutinė navigacija | `TopNav.astro` prideda viso pločio kino platformos navigaciją su logotipu, esamais Home, Movies, Series ir Favorites maršrutais, esama paieškos nuoroda, kalbos rinkikliu ir esamais grojaraščio įvedimo CTA. | Navigacija nenaudoja naujų endpointų ar formų. |
| Hero vitrinos zona | Pagrindiniame puslapyje pridėta dinamiška hero sekcija. Ji nuskaito tik jau talpykloje esančius VOD įrašus ir naudoja egzistuojantį `/movies/detail?id=…` maršrutą. | Nekeistos API užklausos, grotuvo komandos ar katalogo mapperiai. |
| Turinio eilės | Esamos Continue Watching, Favorites, Watchlist ir Recently Added horizontalios eilės vizualiai pertvarkytos į premium karuseles. | Esami Svelte komponentai, drag-scroll ir kortelių veiksmai palikti tokie patys. |
| Planų sekcija | `CinemaPlans.astro` prideda Basic, Standard ir Premium pateikimą. CTA sąmoningai veda į jau esantį `/login` prenumeratos/grojaraščio įvedimo kelią. | Projekte nėra įdiegtos kainodaros ar mokėjimo API, todėl kainos bei mokėjimo nuorodos nebuvo išgalvotos. Paruošti `data-plan-price` ir `data-plan-action` kabliukai būsimai esamai integracijai. |
| Poraštė | `CinemaFooter.astro` prideda kelių stulpelių pagalbos, programos, paskyros ir teisinių nuorodų struktūrą. | Nuorodos naudoja esamus vidinius maršrutus, projekto GitHub saugyklą ir licenciją. |
| Mobilusis vaizdas | Navigacija, hero, planai ir poraštė turi mažiems ekranams pritaikytus lūžio taškus. | Esama apatinė mobili navigacija išliko. |

## Pakeisti ir pridėti failai

| Failas | Paskirtis |
| --- | --- |
| `src/layouts/Layout.astro` | Prijungia globalią viršutinę navigaciją ir poraštę, nekeičiant turinio slot ar šoninės juostos. |
| `src/pages/index.astro` | Prideda hero vitrinos HTML ir saugų katalogo talpyklos duomenų atvaizdavimą. |
| `src/styles/global.css` | Papildo tamsios kino platformos dizaino sistemą ir responsyvius komponentų stilius. |
| `src/components/TopNav.astro` | Nauja viršutinė navigacija, naudojanti esamą lokalizaciją ir maršrutus. |
| `src/components/CinemaPlans.astro` | Nauja provider-neutral planų pateikimo sekcija. |
| `src/components/CinemaFooter.astro` | Nauja kelių stulpelių poraštė. |

## Kainodaros ir mokėjimų pastaba

Saugioje kodo peržiūroje **nebuvo rasta esama kainodaros, atsiskaitymo ar mokėjimo nuorodų integracija**. Todėl šiame atnaujinime nėra pridedama dirbtinių kainų, mokėjimo URL ar mokėjimo formų. Jei prie projekto prijungta atskira kainodaros tarnyba, ji gali užpildyti elementus su `data-plan-price`, o saugūs jau veikiantys CTA gali pakeisti `data-plan-action` nuorodas, neperrašant šio dizaino.

## Patikrinimas

| Patikrinimas | Rezultatas |
| --- | --- |
| `pnpm run build` | Sėkmingai sugeneruoti visi 16 statinių puslapių. |
| `pnpm test -- --run` | Sėkmingi 80 testų failų ir 1755 testai. |
| `git diff --check` | Nėra tarpų ar formato klaidų. |
| Vizualinė peržiūra | Vietinėje naršyklėje patikrinti Home, Movies ir demo prisijungimo ekranai. |
| Backend apsauga | `src-tauri/`, `src/scripts/`, `package.json` ir `pnpm-lock.yaml` nebuvo keičiami. |

## Paleidimas

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

Produkcinės sąsajos kompiliavimui:

```bash
pnpm run build
```


---

## Navigacijos pertvarkymas: viso pločio išdėstymas

Kairė išskleidžiama šoninė navigacija nebėra įtraukiama į bendrą programos išdėstymą. Pagrindinis slenkantis turinio paviršius (`app-content-shell`) dabar užima visą plotį po viršutine juosta.

| Reikalavimas | Įgyvendinimas |
| --- | --- |
| Pašalinti kairę navigaciją | `Layout.astro` nebeimportuoja ir neberenderina `Sidebar.astro`. Todėl neliko nei rail, nei išskleidimo mygtuko, nei apatinės mobilios navigacijos. |
| Perkelti visas nuorodas | Naujas `AccountMenu.astro` perkelia Home, Live TV, Movies, Series, Favorites, Watchlist, Recently added, EPG, Downloads ir Settings nuorodas su tais pačiais `href` maršrutais. |
| Perkelti paskyros valdiklius | Paskyros meniu išsaugo `PlaylistSwitcher`, kalbos pasirinkimą, paskyros galiojimo įspėjimo `data-account-expiration` kabliukus ir prisijungimo CTA. |
| Išsaugoti atsisiuntimų logiką | Atsisiuntimų eigos ženkliukas bei būsenos pranešimai perkelti į `AccountMenu.astro`; palikti tie patys `DOWNLOADS_LIST_EVENT` ir `DOWNLOAD_PROGRESS_EVENT` klausytojai. |
| Pašalinti rail priklausomybę | `PlaylistSwitcher.svelte` nebesišakoja pagal `data-sidebar-collapsed`; jis atidaro esamą grojaraščių sąrašą tiesiai paskyros meniu. |

### Papildomai pakeisti failai

- `src/components/AccountMenu.astro` — naujas viršutinės juostos paskyros meniu su perkelta navigacija ir ankstesniais kliento būsenų kabliukais.
- `src/components/TopNav.astro` — logotipas, esama paieškos nuoroda ir `AccountMenu`.
- `src/layouts/Layout.astro` — viso pločio pagrindinis turinio konteineris be `Sidebar`.
- `src/components/PlaylistSwitcher.svelte` — vizualiai ir elgsenos požiūriu atnaujintas naudoti paskyros meniu.
- `src/styles/global.css` — paskyros meniu, iššokančio grojaraščių sąrašo ir viso pločio išdėstymo stiliai.

### Patikrinimas po navigacijos pertvarkymo

| Patikrinimas | Rezultatas |
| --- | --- |
| Vizualinė peržiūra | Patvirtinta, kad kairė navigacija neberodoma, pagrindinis turinys užima visą plotį, o paskyros meniu atidaro visas perkeltas nuorodas. |
| `pnpm run build` | Sėkmingai sugeneruoti visi 16 statinių puslapių. |
| `pnpm test -- --run` | Sėkmingi 80 testų failų ir 1755 testai. |
| `git diff --check` | Nėra formato ar tarpų klaidų. |
| Backend apsauga | `src-tauri/`, `src/scripts/`, `package.json` ir `pnpm-lock.yaml` nebuvo keičiami. |


---

## Viršutinės juostos pagrindinė navigacija

Į `TopNav.astro` pridėtos tiesioginės **Home**, **Movies**, **Live TV**, **Series** ir **Favorites** nuorodos. Kiekviena nuoroda naudoja tą patį vidinį `href`, `data-i18n` raktą ir kelio atitikimo taisyklę kaip anksčiau naudota navigacija. Aktyvus puslapis pažymimas su `aria-current="page"`, įskaitant atitinkamus detalių puslapius, pavyzdžiui, `/movies/detail`.

Paskyros meniu lieka dešinėje viršutinės juostos pusėje ir toliau apima visas papildomas nuorodas, grojaraščio valdiklius, kalbos pasirinkimą bei nustatymus. Mažesniuose ekranuose pagrindinės nuorodos paslepiamos pagal jau esamus responsyvius viršutinės juostos lūžio taškus, o visa navigacija pasiekiama per paskyros meniu.

| Patikrinimas | Rezultatas |
| --- | --- |
| Viršutinės juostos nuorodos | Home, Movies, Live TV, Series ir Favorites rodomos nustatyta tvarka. |
| Aktyvi būsena | Patikrintos Home ir Movies būsenos; Movies nuoroda aktyvi `/movies` puslapyje. |
| Paskyros meniu | Išsaugotas dešinėje ir nepakeistas. |
| `pnpm run build` | Sėkmingai sugeneruoti visi 16 statinių puslapių. |
| `pnpm test -- --run` | Sėkmingi 80 testų failų ir 1755 testai. |


---

## GO3 įkvėpta streaming platformos hierarchija

Pagal viešai matomą `go3.lt` informacinę hierarchiją į pagrindinį puslapį įtraukta originali „Everything worth watching“ turinio atradimo sekcija. Ji naudoja televizijos platformoms būdingą kategorijų ritmą: Live TV, Movies, Series, TV Guide, Downloads ir My List. Tai nėra GO3 kodo, logotipo, vaizdų ar tekstų kopija; komponentas sukurtas savarankiškai su esamu Extreme InfiniTV vizualiniu identitetu.

| Naujas elementas | Esama integracija |
| --- | --- |
| `StreamingCollections.astro` | Dekoratyvinis ir navigacinis frontend komponentas, sudarytas iš paprastų nuorodų. |
| Live TV kortelė | Naudoja esamą `/livetv` maršrutą. |
| Movies kortelė | Naudoja esamą `/movies` maršrutą. |
| Series kortelė | Naudoja esamą `/series` maršrutą. |
| TV Guide kortelė | Naudoja esamą `/epg` maršrutą. |
| Downloads kortelė | Naudoja esamą `/downloads` maršrutą. |
| My List kortelė | Naudoja esamą `/favorites` maršrutą. |

Hero, dinaminės `HubStrips`, planų sekcija, paskyros meniu ir esamas turinio cache lieka savo vietose. Naujas modulis neprašo naujų API duomenų, nesaugo naujos būsenos ir nekeičia jokių backend funkcijų.


## Home containerių juostų patikra

Home puslapyje dekoratyvūs sekcijų containerių fonai, kraštinės ir šešėliai pašalinti. Hero liko kaip pagrindinė full-width kino scena, o filmų eilės rodomos atviru horizontalios juostos principu. `Live TV` puslapis tikrintas atskirai ir jo funkcinis welcome/container išliko nepakeistas, nes naujos CSS taisyklės apribotos `.movie-first-home` scope.


## Full-bleed Home hero

Galutiniame Home išdėstyme hero sekcija išplėsta per visą viewport plotį (`100vw`), panaikintas apvalus išorinis rėmas, border ir šešėlis. Home filmų sekcijos rodomos be dekoratyvinių containerių. Vieninteliai Home containeriai, kurie išlaiko rėmelio ir kortelės principą, yra individualūs Basic, Standard ir Premium planų blokai. Live TV atskiras puslapis ir jo funkciniai containeriai nebuvo modifikuoti.


## 16 puslapių naršyklės peržiūra

Home peržiūroje full-bleed hero išsiplėtė per visą viewport plotį, jo išorinis apvalus containeris pašalintas, o planų kortelės išlaikė savo rėmelius. Docs puslapis užsikrovė su nauju atviru išdėstymu ir neparodė dekoratyvinių kortelių rėmų; liko tik jo turinio loading būsena dėl atskiro dokumentacijos įkėlimo mechanizmo.


Peržiūros tęsinys: Downloads ir EPG puslapiai užsikrovė su atviru išdėstymu, o jų funkciniai valdikliai išliko prieinami. Ekrano nuotraukos: `localhost_2026-08-27_17-49-45_1105.webp` ir `localhost_2026-08-27_17-49-57_9592.webp`.


Favorites ir Live TV peržiūros: Favorites turi atvirą turinio išdėstymą be dekoratyvių kortelių rėmų; Live TV puslapis išlaiko savo funkcinį welcome/container karkasą kaip numatytą išimtį. Ekrano nuotraukos: `localhost_2026-08-27_17-50-18_6903.webp` ir `localhost_2026-08-27_17-50-28_2051.webp`.


Login ir Movies peržiūros: Login puslapio forma ir Movies katalogo filtrai rodomi be dekoratyvinių išorinių containerių, išlaikant tik funkcines interaktyvių elementų kraštines. Ekrano nuotraukos: `localhost_2026-08-27_17-50-47_1606.webp` ir `localhost_2026-08-27_17-51-02_4824.webp`.


Movie detail ir Playlist Editor peržiūros: abu puslapiai veikia ir turi atvirą išdėstymą be dekoratyvinių išorinių kortelių, išlaikant Play/favorites/watch-later bei Back to Settings funkcinius veiksmus. Ekrano nuotraukos: `localhost_2026-08-27_17-51-25_3129.webp` ir `localhost_2026-08-27_17-51-42_5932.webp`.


Recently Added ir Search peržiūros: abu puslapiai užsikrovė su atviru išdėstymu, išlaikant filtrus, paieškos įvestį ir klaviatūros valdymo tekstus. Ekrano nuotraukos: `localhost_2026-08-27_17-52-08_2999.webp` ir `localhost_2026-08-27_17-52-19_2271.webp`.


Series ir Series detail peržiūros: katalogo filtrai, paieška, serialo detalių grįžimas ir favorites/watch-later veiksmai išliko prieinami; dekoratyvinių išorinių containerių nebėra. Ekrano nuotraukos: `localhost_2026-08-27_17-52-44_6544.webp` ir `localhost_2026-08-27_17-52-54_1324.webp`.


Settings ir Watchlist peržiūros: nustatymų puslapis išlaikė savo navigaciją ir formų valdiklius be dekoratyvinių išorinių rėmų; Watchlist rodo atvirą tuščią būseną. Ekrano nuotraukos: `localhost_2026-08-27_17-53-20_3057.webp` ir `localhost_2026-08-27_17-53-40_7268.webp`.

Visi 16 puslapių patikrinti: dekoratyvinės kortelės ir containerių juostos pašalintos visur, išskyrus prenumeratos planus ir Live TV funkcinį karkasą.


## Footer spacing patikra

Home puslapio viršuje ir apačioje patikrinta, kad footer nėra `fixed`, nesidengia su turiniu ir yra stumiamas į apačią tik trumpuose puslapiuose. Ilgesniame Home sraute footer rodomas po planų sekcija su nuosekliu tarpu. Planų kortelės išlaiko rėmelius, o atviros Home sekcijos jų neturi. Nauja naršyklės peržiūra: `localhost_2026-08-27_18-02-03_6430.webp`.

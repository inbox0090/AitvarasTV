# AitvarasTV diegimas į Ubuntu Server

Šis paketas paruoštas paprastam diegimui į **Ubuntu Server 22.04 arba 24.04**. AitvarasTV produkcinį Astro build ir serverinį backendą aptarnauja Node.js procesas, o Nginx veikia kaip reverse proxy. Tai būtina, kad veiktų ne tik visi 18 viešų puslapių, bet ir serveriuje registruoti `/admin/*`, `/api/*`, auth, billing bei Stripe webhook maršrutai.

> Nginx neturi aptarnauti vien tik `dist/` katalogo. Jei paleidžiamas tik statinis buildas, `/admin` dashboard nebus pasiekiamas, nes jo route'ai yra `server/index.mjs` Node serveryje.

## Greitas diegimas

Išskleiskite vieną ZIP paketą serveryje, pereikite į projekto katalogą ir paleiskite vieną komandą. Vietoje `tv.example.com` įrašykite savo domeną. Jei diegiate per IP arba laikinai be domeno, naudokite `_`.

```bash
cd AitvarasTV
pnpm install --frozen-lockfile
pnpm run build
sudo bash deploy/install-ubuntu.sh tv.example.com
```

Installeris automatiškai:

1. įdiegia Nginx ir, jei reikia, Node.js 22;
2. nukopijuoja visą projektą, įskaitant `dist/` ir `server/index.mjs`, į `/opt/extreme-infinitv`;
3. sukuria atskirą duomenų katalogą `/var/lib/extreme-infinitv`;
4. sukuria systemd paslaugą, kuri paleidžia `node server/index.mjs`;
5. sukonfigūruoja Nginx reverse proxy į Node serverį;
6. patikrina `/admin/login` prieš užbaigdamas diegimą.

## Admin dashboard

Po diegimo admin dashboard pasiekiamas adresu:

```text
https://tv.example.com/admin/login
```

Pirmoje naujos duomenų bazės instaliacijoje naudojami bootstrap duomenys:

```text
Username: admin
Password: admin
```

Pirmo prisijungimo metu sistema nukreipia į `/admin/security?force=1` ir reikalauja pakeisti laikiną slaptažodį. Naujas admin slaptažodis turi būti ne trumpesnis kaip 12 simbolių. Admin paskyra yra atskira nuo klientų `/auth` paskyrų.

Admin skiltys:

| Adresas | Paskirtis |
| --- | --- |
| `/admin` | Dashboard apžvalga ir sistemos būsena |
| `/admin/billing` | Aktyvūs prenumeratoriai ir pajamos pagal planus |
| `/admin/plans` | Planų, kainų, kategorijų ir XUI bouquet ID valdymas |
| `/admin/features` | Klientams rodomų Settings funkcijų kontrolė |
| `/admin/guest-preview` | Neprisijungusių lankytojų peržiūros trukmė |
| `/admin/settings` | Esamų Settings funkcijų administravimo peržiūra |
| `/admin/security` | Admin slaptažodžio pakeitimas |

## Visi 18 vieši puslapiai

Astro build generuoja visus šiuos puslapius:

`/`, `/auth`, `/account`, `/docs`, `/downloads`, `/epg`, `/favorites`, `/livetv`, `/login`, `/movies`, `/movies/detail`, `/playlist-editor`, `/recently-added`, `/search`, `/series`, `/series/detail`, `/settings` ir `/watchlist`.

Tiesioginės nuorodos į katalogo puslapius turi būti aptarnaujamos per Node serverį, nes jis pirmiausia apdoroja auth ir API logiką, o tik tada pateikia atitinkamą Astro `dist/` failą.

## Paslaugos patikra ir žurnalai

| Poreikis | Komanda |
| --- | --- |
| Patikrinti AitvarasTV paslaugą | `sudo systemctl status extreme-infinitv` |
| Peržiūrėti Node serverio žurnalą | `sudo journalctl -u extreme-infinitv -f` |
| Patikrinti Nginx konfigūraciją | `sudo nginx -t` |
| Perkrauti AitvarasTV po `.env` pakeitimo | `sudo systemctl restart extreme-infinitv` |
| Perkrauti Nginx | `sudo systemctl reload nginx` |
| Patikrinti admin login route | `curl -I http://127.0.0.1:4321/admin/login` |
| Patikrinti viešą Home puslapį | `curl -I http://127.0.0.1:4321/` |

## Aplinkos failas

Installeris sukuria:

```text
/etc/extreme-infinitv/admin.env
```

Faile galima nustatyti `APP_ORIGIN`, `ADMIN_EMAIL`, SMTP reikšmes, `STRIPE_SECRET_KEY` ir `STRIPE_WEBHOOK_SECRET`. Šio failo negalima dėti į GitHub arba viešą ZIP paketą.

Po pakeitimų:

```bash
sudo nano /etc/extreme-infinitv/admin.env
sudo systemctl restart extreme-infinitv
```

## HTTPS

Nukreipkite domeno DNS A/AAAA į serverio IP adresą ir patikrinkite, kad 80 prievadas pasiekiamas. Tada paleiskite:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tv.example.com
```

Jei naudojate UFW:

```bash
sudo ufw allow 'Nginx Full'
```

## Atnaujinimas į naują leidimą

Išskleiskite naują ZIP paketą ir iš naujo paleiskite tą pačią komandą:

```bash
cd /kelias/iki/AitvarasTV
pnpm install --frozen-lockfile
pnpm run build
sudo bash deploy/install-ubuntu.sh tv.example.com
```

Installeris pakeičia programos failus, išsaugo atskirame `/var/lib/extreme-infinitv` kataloge esančią admin/client SQLite duomenų bazę ir iš naujo paleidžia systemd bei Nginx paslaugas.

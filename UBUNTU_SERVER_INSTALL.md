# Extreme InfiniTV diegimas į Ubuntu Server

Šis paketas paruoštas paprastam diegimui į **Ubuntu Server 22.04 arba 24.04**. Programos produkcinis build yra statinis, todėl diegimo scenarijus jį aptarnauja per Nginx paslaugą, kurią valdo `systemd`.

> Diegimo scenarijus nekeičia IPTV tiekėjo prisijungimų, grojaraščių, API užklausų, grotuvo, Tauri kodo ar naudotojo duomenų. Jis tik nukopijuoja esamą sukompiliuotą sąsają į Nginx web katalogą.

## Greitas diegimas

Išskleiskite gautą ZIP failą serveryje, pereikite į išskleistą projekto katalogą ir paleiskite vieną komandą. Vietoje `tv.example.com` įrašykite savo domeną. Jei diegiate tik per IP adresą, naudokite `_`.

```bash
cd extreme-infinitv-redesign
sudo bash deploy/install-ubuntu.sh tv.example.com
```

Scenarijus automatiškai įdiegs Nginx, nukopijuos šį projekto leidimą į `/opt/extreme-infinitv`, publikuos statinį build į `/var/www/extreme-infinitv`, sukurs Nginx svetainės konfigūraciją ir įjungs Nginx per `systemd`.

| Poreikis | Komanda |
| --- | --- |
| Patikrinti paslaugą | `sudo systemctl status nginx` |
| Peržiūrėti Nginx žurnalą | `sudo journalctl -u nginx -f` |
| Patikrinti Nginx konfigūraciją | `sudo nginx -t` |
| Perkrauti po nustatymų pakeitimo | `sudo systemctl reload nginx` |
| Rasti publikuotus failus | `sudo ls -la /var/www/extreme-infinitv` |

## HTTPS naudojant domeną

Prieš įjungdami HTTPS, nukreipkite savo domeno DNS A/AAAA įrašą į serverio IP adresą ir patikrinkite, kad 80 prievadas pasiekiamas iš interneto. Tada paleiskite:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tv.example.com
```

Jei naudojate aktyvų UFW, atverkite HTTP ir HTTPS:

```bash
sudo ufw allow 'Nginx Full'
```

## Atnaujinimas į naują leidimą

Įkelkite ir išskleiskite naują ZIP paketą, pereikite į naują katalogą ir dar kartą vykdykite tą pačią diegimo komandą. Scenarijus atomistiškai pakeičia publikuojamų failų katalogą ir iš naujo paleidžia Nginx.

```bash
cd /kelias/iki/naujo/extreme-infinitv-redesign
sudo bash deploy/install-ubuntu.sh tv.example.com
```

## Pastaba dėl serverinės logikos

Šis projektas turi `Astro` statinį produkcinį output (`dist/`). Todėl Ubuntu diegimui nereikia nuolat veikiančio Node.js proceso: Nginx pateikia sukompiliuotą sąsają. Visi jau esami programos klientiniai IPTV, grotuvo ir integracijų veiksmai išlieka tokie patys kaip projekto produkciniame build.

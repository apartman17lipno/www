# Provozní dokumentace – Apartmán Costa Plana

## Web a GitHub

- Web: [apartman17lipno.cz](https://apartman17lipno.cz)
- Repozitář: [github.com/apartman17lipno/www](https://github.com/apartman17lipno/www), hlavní větev `main`.
- Přihlášení do GitHubu: účet `apartman17lipno@gmail.com`; jeho uživatelské jméno/majitel repozitáře je `apartman17lipno`.
- Soubory v repozitáři:
  - `index.html` (veřejný web)
  - `admin.html` (administrace)
  - `rezervacni-a-storno-podminky.html` (podmínky rezervace a storna)
  - `google-apps-script/Code.gs` (zdrojový kód backendu v Google Apps Scriptu)
  - `google-apps-script/checkin.html` (šablona formuláře online check-inu hostů)
  - `google-apps-script/guestbook.html` (šablona pro generování PDF evidenční knihy ubytovaných)
  - `CNAME` (vlastní doména `apartman17lipno.cz`)
- Obě stránky (`index.html` i `admin.html`) používají stejné nasazení Apps Scriptu. Změny v HTML/JS se zapisují do větve `main`; automatické zveřejnění probíhá přes GitHub Pages.

## Google Apps Script

- Editor projektů: [script.google.com/home](https://script.google.com/home)
- Přihlášení: `apartman17lipno@gmail.com`.
- Nasazená webová aplikace: [otevřít Apps Script endpoint](https://script.google.com/macros/s/AKfycbxqNQdGvT4scxO_k0uNsjusx61ivbBodvtGSQCqQwsHtzOn6fPTu6IHN-PEZ7Qisspr9A/exec)
- Přihlášení do administrace je povolené účtům: `apartman17lipno@gmail.com`, `miloslav.filip@gmail.com` a `mona.viskova@gmail.com`.
- `Code.gs` obsluhuje veřejné požadavky na ceny, obsazenost a poptávky; administraci přes Google přihlášení, rezervace/blokace kalendáře, ukládání ceníku, online check-in a generování knihy hostů.
- Kopie zdrojových souborů v GitHubu: složka [`google-apps-script/`](https://github.com/apartman17lipno/www/tree/main/google-apps-script).
- **Struktura v editoru Apps Scriptu:** Projekt musí obsahovat soubor skriptu `Code.gs` a dva HTML soubory: `checkin` (obsah ze `checkin.html`) a `guestbook` (obsah z `guestbook.html`).
- **Po změně skriptu:**
  1. Vložte aktuální kód do editoru Apps Scriptu.
  2. Spusťte ručně funkci `authorize()` a schvalte požadovaná oprávnění (funkce zároveň nainstaluje potřebné denní triggery pro automatické výzvy).
  3. V **Nasadit → Spravovat nasazení → Upravit** vyberte **Nová verze → Nasadit**. Upravujte vždy stávající nasazení, aby zůstala zachována stálá URL webové aplikace.

## Google Cloud Console / OAuth

- Konzole: [Google Auth Platform – Clients](https://console.cloud.google.com/auth/clients)
- Přihlášení: `apartman17lipno@gmail.com`.
- OAuth Client ID pro web: `478585801571-svdcuhvao5ft4dpsblvkf36jg2751uqj.apps.googleusercontent.com` (Client ID není tajný údaj).
- Do **Authorized JavaScript origins** patří `https://apartman17lipno.cz` — pouze schéma a doména, bez cesty `/admin.html`.

## Bezpečnostní poznámka

Verze `Code.gs` v GitHubu ověřuje ID token přes Google `tokeninfo`. Google tento endpoint označuje za nástroj pro ladění a upozorňuje na možné omezení požadavků či výpadky; při opakovaných chybách přihlášení zkontrolujte běhy v Apps Scriptu a aktuální nasazení. [Dokumentace endpointu](https://developers.google.com/identity/openid-connect/reference#tokeninfo)

# Provozní dokumentace – Apartmán Costa Plana

## Web a GitHub

- Web: [apartman17lipno.cz](https://apartman17lipno.cz)
- Repozitář: [github.com/apartman17lipno/www](https://github.com/apartman17lipno/www), hlavní větev `main`.
- Přihlášení do GitHubu: účet `apartman17lipno@gmail.com`; jeho uživatelské jméno/majitel repozitáře je `apartman17lipno`.
- Soubory v kořeni repozitáře: `index.html` (veřejný web), `admin.html` (administrace), `Code.gs` (zdroj Google Apps Scriptu) a `CNAME` (vlastní doména `apartman17lipno.cz`).
- Obě stránky používají stejné nasazení Apps Scriptu. Změny v HTML se zapisují do `main`; automatické zveřejnění závisí na nastavení GitHub Pages.

## Google Apps Script

- Editor projektů: [script.google.com/home](https://script.google.com/home)
- Přihlášení: `apartman17lipno@gmail.com`.
- Nasazená webová aplikace: [otevřít Apps Script endpoint](https://script.google.com/macros/s/AKfycbxqNQdGvT4scxO_k0uNsjusx61ivbBodvtGSQCqQwsHtzOn6fPTu6IHN-PEZ7Qisspr9A/exec)
- Přihlášení do administrace je povolené účtům `apartman17lipno@gmail.com`, `miloslav.filip@gmail.com` a `mona.viskova@gmail.com`.
- `Code.gs` obsluhuje veřejné požadavky na ceny, obsazenost a poptávky; administraci přes Google přihlášení, rezervace/blokace kalendáře a ukládání ceníku.
- Kopie zdrojového souboru v GitHubu: [`Code.gs`](https://github.com/apartman17lipno/www/blob/main/Code.gs).
- Po změně skriptu: vložte aktuální `Code.gs` do projektu, spusťte `authorize()` a schvalte oprávnění. Pak v **Nasadit → Spravovat nasazení → Upravit** vyberte **Nová verze → Nasadit**. Upravujte stávající nasazení, aby zůstala výše uvedená URL.
- Stav z posledního ověření: přihlašovací tlačítko Google se zobrazovalo, ale server hlásil, že se token nepodařilo ověřit. Po nasazení nové verze přihlášení znovu ověřte.

## Google Cloud Console / OAuth

- Konzole: [Google Auth Platform – Clients](https://console.cloud.google.com/auth/clients)
- Přihlášení: `apartman17lipno@gmail.com`.
- OAuth Client ID pro web: `478585801571-svdcuhvao5ft4dpsblvkf36jg2751uqj.apps.googleusercontent.com` (Client ID není tajný údaj).
- Do **Authorized JavaScript origins** patří `https://apartman17lipno.cz` — pouze schéma a doména, bez cesty `/admin.html`.

## Bezpečnostní poznámka

Verze `Code.gs` v GitHubu ověřuje ID token přes Google `tokeninfo`. Google tento endpoint označuje za nástroj pro ladění a upozorňuje na možné omezení požadavků či výpadky; při opakovaných chybách přihlášení zkontrolujte běhy v Apps Scriptu a aktuální nasazení. [Dokumentace endpointu](https://developers.google.com/identity/openid-connect/reference#tokeninfo)
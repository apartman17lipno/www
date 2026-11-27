# Provozní dokumentace – Apartmán Costa Plana

## Přehled prostředí

| | PROD (ostrý provoz) | TEST |
|---|---|---|
| Web | [apartman17lipno.cz](https://apartman17lipno.cz) | [apartman17lipno.github.io/www-test](https://apartman17lipno.github.io/www-test/) |
| Administrace | [apartman17lipno.cz/admin.html](https://apartman17lipno.cz/admin.html) | [apartman17lipno.github.io/www-test/admin.html](https://apartman17lipno.github.io/www-test/admin.html) |
| Repozitář webu | [github.com/apartman17lipno/www](https://github.com/apartman17lipno/www), větev `main` | [github.com/apartman17lipno/www-test](https://github.com/apartman17lipno/www-test), větev `main` (jen zrcadlo, neupravuje se ručně) |
| Zdrojová větev | `main` | `DEVELOP` (repozitář `www`) |
| Backend | samostatný projekt Apps Scriptu (nasazení PROD) | samostatný projekt Apps Scriptu (nasazení TEST) |
| Kalendář | `apartman17lipno@gmail.com` | testovací kalendář (`TEST_CALENDAR_ID` v `Code.gs`) |
| Vlastní doména | `apartman17lipno.cz` (soubor `CNAME`) | žádná |

TEST a PROD používají stejný kód. Liší se výběrem backendu, kalendářem a nastavením ve Script Properties.

## Web a GitHub

- Přihlášení do GitHubu: účet `apartman17lipno@gmail.com`; uživatelské jméno/majitel repozitáře je `apartman17lipno`.
- Soubory v kořeni repozitáře `www`: `index.html` (veřejný web), `admin.html` (administrace), `rezervacni-a-storno-podminky.html`, `CNAME` (vlastní doména `apartman17lipno.cz`), složka `assets/` (`booking.js`, `gallery.js`, `site.css`, obrázky) a `AGENTS.md` (pravidla pro AI nástroje).
- Zdroj Google Apps Scriptu je ve složce `google-apps-script/` (`Code.gs`, `checkin.html`, `guestbook.html`).
- Změny v HTML se zapisují do větve `DEVELOP`. Do `main` se dostávají pouze přes pull request z `DEVELOP`.
- Automatické zveřejnění ostrého webu závisí na nastavení GitHub Pages v repozitáři `www`.

## Postup změn (DEVELOP → TEST → PROD)

1. Práce probíhá ve větvi `DEVELOP` (`git switch DEVELOP`, `git pull --rebase origin DEVELOP`). Pravidla pro AI nástroje (automatický pull a push do `DEVELOP`, zákaz pushe do `main` a zákaz `--force`) jsou v `AGENTS.md`.
2. Každý push do `DEVELOP` spustí GitHub Actions workflow `.github/workflows/mirror-test.yml` („Mirror DEVELOP to TEST"). Ten zkopíruje obsah do větve `main` repozitáře `www-test` (force push, repozitář je jen zrcadlo) a v kopii před tím odstraní soubor `CNAME`, aby TEST nezabíral ostrou doménu. Větev `DEVELOP` v `www` se tím nemění.
3. Změnu ověřte na testovacím webu.
4. Po ověření vytvořte pull request z `DEVELOP` do `main` a sloučte ho. Tím se změna dostane do ostrého webu.
5. Změny v `Code.gs` se do Apps Scriptu nenasazují automaticky; viz sekce Google Apps Script.

### Nastavení zrcadlení

- Workflow používá deploy key. Veřejný klíč je v repozitáři `www-test` (Settings → Deploy keys, s povoleným zápisem). Soukromý klíč je v repozitáři `www` jako **Repository secret** `TEST_DEPLOY_KEY` (Settings → Secrets and variables → Actions).
- Pokud zrcadlení selže, zkontrolujte běh v záložce Actions repozitáře `www`. Nejčastější příčiny: chybný obsah secretu `TEST_DEPLOY_KEY` (chybí první nebo poslední řádek klíče), deploy key bez práva zápisu, nebo změněný název repozitáře `www-test`.
- GitHub Pages v repozitáři `www-test`: Settings → Pages → Deploy from a branch → `main` / root, bez vlastní domény.

## Google Apps Script

- Editor projektů: [script.google.com/home](https://script.google.com/home)
- PROD a TEST jsou dva samostatné projekty Apps Scriptu se stejným `Code.gs`, každý s vlastním nasazením webové aplikace a vlastními Script Properties.
- Nasazená webová aplikace PROD: [otevřít Apps Script endpoint](https://script.google.com/macros/s/AKfycbxqNQdGvT4scxO_k0uNsjusx61ivbBodvtGSQCqQwsHtzOn6fPTu6IHN-PEZ7Qisspr9A/exec)
- Nasazená webová aplikace TEST: [otevřít Apps Script endpoint](https://script.google.com/macros/s/AKfycbyZViBGlJQ0I8rDSNPGJMOhPOv0Go2KEEsoSoqvS6wH9HP4es48nBq288caje392S2fYA/exec)
- Přihlášení do administrace je povolené účtům `apartman17lipno@gmail.com`, `miloslav.filip@gmail.com` a `mona.viskova@gmail.com` (v obou prostředích).
- `Code.gs` obsluhuje veřejné požadavky na ceny, obsazenost a poptávky; administraci přes Google přihlášení, rezervace/blokace kalendáře, životní cyklus rezervace (platby, online check-in, automatické e-maily), knihu hostů a ukládání ceníku.
- Kopie zdrojového souboru v GitHubu: [`google-apps-script/Code.gs`](https://github.com/apartman17lipno/www/blob/main/google-apps-script/Code.gs).
- Po změně skriptu (v každém ze dvou projektů zvlášť): vložte aktuální `Code.gs` (a případně `checkin.html`, `guestbook.html`) do projektu, spusťte `authorize()` a schvalte oprávnění. Pak v **Nasadit → Spravovat nasazení → Upravit** vyberte **Nová verze → Nasadit**. Upravujte stávající nasazení, aby zůstala stejná URL.
- Stav z posledního ověření: přihlašovací tlačítko Google se zobrazovalo, ale server hlásil, že se token nepodařilo ověřit. Po nasazení nové verze přihlášení znovu ověřte.

### Jak se rozlišuje prostředí

- **Frontend** (`assets/booking.js`, `admin.html`): obsahuje obě adresy backendu (`PROD_ENDPOINT`/`TEST_ENDPOINT`, resp. `PROD_EP`/`TEST_EP`). Ostrý backend se použije jen na hostech `apartman17lipno.cz` a `www.apartman17lipno.cz`; na všech ostatních adresách (včetně `github.io` a `localhost`) se použije testovací. Při změně adresy nasazení ji upravte v obou souborech.
- **Backend** (`Code.gs`): funkce `isTestEnvironment_()` pozná TEST podle adresy nasazení (`TEST_DEPLOYMENT_ID`) nebo podle vlastnosti `ENV=TEST` ve Script Properties. TEST používá kalendář `TEST_CALENDAR_ID`, PROD kalendář `PROD_CALENDAR_ID`. Funkce `getCal()` má pojistku: při pokusu TESTu o přístup k produkčnímu kalendáři skončí chybou.
- Prostředí lze v editoru Apps Scriptu nastavit spuštěním funkce `setEnvironmentTest()` nebo `setEnvironmentProd()`. V testovacím projektu musí být nastaveno `ENV=TEST`.
- Odkaz na administraci v e-mailech o nových poptávkách se bere z `getAdminPage_()`, takže v TESTu vede na testovací administraci.

### Omezení a rizika TESTu

- **E-maily se v TESTu posílají doopravdy.** Backend zatím nepřesměrovává e-maily z TESTu na vlastní adresu. V testovacích poptávkách proto zadávejte pouze vlastní e-mailové adresy, aby se zprávy (potvrzení, platební výzvy, check-in, přístupový kód) nedostaly skutečným hostům.
- Testovací data (poptávky, rezervace, blokace) vznikají jen v testovacím kalendáři. Po ověření se mohou v kalendáři smazat.
- Testovací projekt má vlastní Script Properties. Bankovní účet a přístupový kód v něm nastavte testovací, ne ostré.

## Google Cloud Console / OAuth

- Konzole: [Google Auth Platform – Clients](https://console.cloud.google.com/auth/clients)
- Přihlášení: `apartman17lipno@gmail.com`.
- OAuth Client ID pro web: `478585801571-svdcuhvao5ft4dpsblvkf36jg2751uqj.apps.googleusercontent.com` (Client ID není tajný údaj). PROD i TEST používají stejného klienta.
- Do **Authorized JavaScript origins** patří:
  - `https://apartman17lipno.cz` (PROD),
  - `https://apartman17lipno.github.io` (TEST).
  
  Zadává se pouze schéma a doména, bez cesty (např. bez `/www-test/admin.html`). Po uložení může trvat několik minut až hodin, než se změna projeví; do té doby se v konzoli prohlížeče zobrazuje chyba „The given origin is not allowed for the given client ID".
- Pokud je consent screen v režimu Testing, musí být přihlašovací účty vedené jako testovací uživatelé.

## Bezpečnostní poznámka

Verze `Code.gs` v GitHubu ověřuje ID token přes Google `tokeninfo`. Google tento endpoint označuje za nástroj pro ladění a upozorňuje na možné omezení požadavků či výpadky; při opakovaných chybách přihlášení zkontrolujte běhy v Apps Scriptu a aktuální nasazení. [Dokumentace endpointu](https://developers.google.com/identity/openid-connect/reference#tokeninfo)

Soukromé klíče, tokeny a hesla (včetně deploy key pro zrcadlení) se neukládají do repozitáře ani do dokumentace; patří do GitHub Secrets, případně do Script Properties.

// Costa Plana – poptávky, dostupnost, ceny a administrace (Google Apps Script)
//
// Jediné nasazení: Spustit jako: Já, přístup: Kdokoli.
// VEŘEJNÉ vstupy (doGet, pro index.html): obsazenost, ceny, odeslání poptávky.
// ADMINISTRACE (doPost, pro admin.html): přihlášení přes Google (ID token ověřený na serveru),
// serverová relace a všechny administrátorské operace. Vyžaduje běhové prostředí V8.

// ================= Nastavení =================
var OWNER = 'apartman17lipno@gmail.com';
var ADMINS = ['apartman17lipno@gmail.com', 'miloslav.filip@gmail.com', 'mona.viskova@gmail.com'];  // jen tyto účty smějí do administrace
var NOTIFY = ['apartman17lipno@gmail.com'];                         // kdo dostává e-maily o nových poptávkách
var ADMIN_PAGE = 'https://apartman17lipno.cz/admin.html';
var GOOGLE_CLIENT_ID = '478585801571-svdcuhvao5ft4dpsblvkf36jg2751uqj.apps.googleusercontent.com';  // OAuth Client ID (není tajný)
var SESSION_TTL_MS = 12 * 3600 * 1000;   // platnost relace: 12 hodin
var MAX_SESSIONS = 25;                   // nejvýš tolik současných relací
var DAYS_AHEAD = 540;                    // jak daleko dopředu se čte kalendář
var MAX_NIGHTS = 60;                     // nejdelší povolený pobyt

var DEFAULT_PRICES = {   // výchozí ceník; po prvním uložení v administraci platí uložený
  cleaning: 1000, perPersonNight: 40, defaultPrice: 1400,
  rules: [   // pozdější pravidlo přebíjí dřívější; datum MM-DD, od > do = přes konec roku
    { label: 'Leden', from: '01-01', to: '01-31', price: 1400 },
    { label: 'Únor', from: '02-01', to: '02-29', price: 2000 },
    { label: 'Březen – květen', from: '03-01', to: '05-31', price: 1400 },
    { label: 'Červen', from: '06-01', to: '06-30', price: 2000 },
    { label: 'Červenec – srpen', from: '07-01', to: '08-31', price: 2500 },
    { label: 'Září – prosinec', from: '09-01', to: '12-31', price: 1400 },
    { label: '21. 12. – 2. 1.', from: '12-21', to: '01-02', price: 2000 }
  ]
};

// ================= Vstupní body =================
// GET = jen veřejné operace. Žádná administrátorská funkce není přes GET dosažitelná.
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.action) return infoPage('Costa Plana', 'Administrace je na adrese ' + ADMIN_PAGE, ADMIN_PAGE, 'Otevřít administraci');
  var result;
  try {
    switch (p.action) {
      case 'submit': result = handleSubmit(JSON.parse(p.data || '{}')); break;
      case 'prices': result = { ok: true, prices: getPrices() }; break;
      case 'busy':   result = { ok: true, busy: Object.keys(busyNights()).sort() }; break;
      case 'config': result = { ok: true, clientId: GOOGLE_CLIENT_ID }; break;   // Client ID není tajný
      case 'nonce':  result = newNonce_(); break;
      default:       result = { ok: false, error: 'action' };
    }
  } catch (err) { result = { ok: false, error: 'server' }; }
  return out(result, p.callback);
}

// POST = přihlášení, odhlášení a administrátorské operace. Token relace putuje v těle, ne v URL.
function doPost(e) {
  var result;
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (d.action) {
      case 'login':  result = login_(d.credential); break;
      case 'logout': result = logout_(d.s); break;
      case 'admin':  result = adminCall_(d); break;
      default:       result = { ok: false, error: 'action' };
    }
  } catch (err) { result = { ok: false, error: 'server' }; }
  return out(result);
}

// ================= Přihlášení přes Google (ověření ID tokenu na serveru) =================
function newNonce_() {
  var cache = CacheService.getScriptCache(), n = Number(cache.get('noncecount') || 0);
  if (n >= 200) return { ok: false, error: 'limit' };
  cache.put('noncecount', String(n + 1), 3600);
  var nonce = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('nonce_' + nonce, '1', 600);
  return { ok: true, nonce: nonce };
}
function useNonce_(nonce) {
  var cache = CacheService.getScriptCache(), key = 'nonce_' + String(nonce || '');
  if (!nonce || !cache.get(key)) return false;
  cache.remove(key);                                  // nonce jde použít jen jednou
  return true;
}

function login_(credential) {
  if (String(GOOGLE_CLIENT_ID).indexOf('DOPLNTE') === 0) return { ok: false, error: 'config' };
  var res = verifyIdToken_(credential);
  if (!res.ok) return { ok: false, error: res.error };
  var cache = CacheService.getScriptCache(), key = 'lf_' + res.email, fails = Number(cache.get(key) || 0);
  if (fails >= 10) return { ok: false, error: 'limit' };
  if (!isAdminEmail_(res.email)) { cache.put(key, String(fails + 1), 3600); return { ok: false, error: 'forbidden' }; }
  console.log('Přihlášení správce: ' + res.email);
  return { ok: true, email: res.email, session: createSession_(res.email), expires: Date.now() + SESSION_TTL_MS };
}

function isAdminEmail_(email) {
  return ADMINS.map(function (a) { return a.toLowerCase(); }).indexOf(String(email).toLowerCase()) >= 0;
}

// Ověří podpis (RS256, veřejné klíče Googlu) a nároky ID tokenu. Nic z tokenu se nebere za pravdivé bez ověření podpisu.
function verifyIdToken_(jwt) {
  jwt = String(jwt || '');
  var parts = jwt.split('.');
  if (parts.length !== 3 || jwt.length > 4096) return { ok: false, error: 'token' };
  var payload;
  try { payload = JSON.parse(bytesToString_(b64urlToBytes_(parts[1]))); }
  catch (e) { return { ok: false, error: 'token' }; }

  var response;
  try {
    response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'post', payload: { id_token: jwt }, muteHttpExceptions: true
    });
  } catch (e) { return { ok: false, error: 'token' }; }
  if (response.getResponseCode() !== 200) return { ok: false, error: 'token' };

  var claims;
  try { claims = JSON.parse(response.getContentText()); }
  catch (e) { return { ok: false, error: 'token' }; }
  var now = Math.floor(Date.now() / 1000);
  if (claims.aud !== GOOGLE_CLIENT_ID) return { ok: false, error: 'aud' };
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return { ok: false, error: 'iss' };
  if (!Number(claims.exp) || Number(claims.exp) <= now) return { ok: false, error: 'expired' };
  if (Number(claims.iat) > now + 300) return { ok: false, error: 'token' };
  if (claims.email_verified !== true && claims.email_verified !== 'true') return { ok: false, error: 'email_unverified' };
  if (!claims.email || String(claims.email).toLowerCase() !== String(payload.email || '').toLowerCase()) return { ok: false, error: 'token' };
  // Google verifies the JWT signature; use the nonce claim from that verified payload.
  if (!useNonce_(payload.nonce)) return { ok: false, error: 'nonce' };
  return { ok: true, email: String(claims.email).toLowerCase() };
}
function b64urlToBytes_(s) {
  s = String(s); while (s.length % 4) s += '=';
  return Utilities.base64DecodeWebSafe(s).map(function (b) { return b & 255; });
}
function bytesToString_(bytes) { return Utilities.newBlob(bytes).getDataAsString(); }
function toHex_(bytes) {
  var h = '';
  for (var i = 0; i < bytes.length; i++) { var b = bytes[i] & 255; h += (b < 16 ? '0' : '') + b.toString(16); }
  return h;
}
function digestHex_(s) { return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }

// ================= Serverové relace =================
// Do ScriptProperties se ukládá jen SHA-256 otisk tokenu, takže únik úložiště tokeny nevyzradí.
function createSession_(email) {
  var props = PropertiesService.getScriptProperties();
  purgeSessions_();
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty('sess_' + digestHex_(token), JSON.stringify({ e: email, x: Date.now() + SESSION_TTL_MS }));
  return token;
}
function checkSession_(token) {
  token = String(token || '');
  if (token.length < 40 || token.length > 100) return null;
  var props = PropertiesService.getScriptProperties(), key = 'sess_' + digestHex_(token), raw = props.getProperty(key);
  if (!raw) return null;
  var s;
  try { s = JSON.parse(raw); } catch (e) { props.deleteProperty(key); return null; }
  if (s.x < Date.now() || !isAdminEmail_(s.e)) { props.deleteProperty(key); return null; }
  return s.e;
}
function logout_(token) {
  token = String(token || '');
  if (token.length >= 40 && token.length <= 100) PropertiesService.getScriptProperties().deleteProperty('sess_' + digestHex_(token));
  return { ok: true };
}
function purgeSessions_() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties(), live = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess_') !== 0) return;
    var s; try { s = JSON.parse(all[k]); } catch (e) { s = null; }
    if (!s || s.x < Date.now()) props.deleteProperty(k); else live.push({ k: k, x: s.x });
  });
  live.sort(function (a, b) { return a.x - b.x; });
  while (live.length >= MAX_SESSIONS) props.deleteProperty(live.shift().k);   // uvolní místo nejstarším
}
// Spusťte ručně v editoru: zneplatní všechny relace (např. při ztrátě zařízení)
function revokeAllSessions() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('sess_') === 0) props.deleteProperty(k); });
}
// Spusťte jednou ručně po vložení kódu: vyvolá žádost o povolení (kalendář, e-mail, UrlFetch)
function authorize() {
  getCal(); MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs');
  CacheService.getScriptCache(); PropertiesService.getScriptProperties();
}

// Jediná brána k administrátorským funkcím: vždy ověří relaci na serveru
function adminCall_(d) {
  var email = checkSession_(d.s);
  if (!email) return { ok: false, error: 'auth' };
  var funcs = { adminList: adminList_, adminConfirm: adminConfirm_, adminReject: adminReject_,
                adminDelete: adminDelete_, adminAdd: adminAdd_, adminSavePrices: adminSavePrices_ };
  var name = String(d.fn || '');
  if (!Object.prototype.hasOwnProperty.call(funcs, name)) return { ok: false, error: 'fn' };
  console.log('Správce ' + email + ': ' + name);
  return funcs[name].apply(null, Array.isArray(d.args) ? d.args : []);
}

// ================= Kalendář =================
function getCal() {
  var cal = CalendarApp.getCalendarById(OWNER);
  if (!cal) throw new Error('Kalendář ' + OWNER + ' nebyl nalezen.');
  return cal;
}

// ================= Poptávka z webu (veřejné) =================
function handleSubmit(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (d.web) return { ok: true };                    // ochrana proti robotům
    var email = String(d.email || '').slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'email' };
    var from = parseDate(d.from), to = parseDate(d.to);
    if (!from || !to || to <= from || (to - from) / 86400000 > MAX_NIGHTS) return { ok: false, error: 'dates' };
    var adults, children;
    if (d.adults == null && d.children == null) {
      adults = parseInt(String(d.guests || ''), 10) || 1;
      children = 0;
    } else {
      adults = Number(d.adults);
      children = Number(d.children);
    }
    if (!isFinite(adults) || Math.floor(adults) !== adults || adults < 1 || adults > 4 ||
        !isFinite(children) || Math.floor(children) !== children || children < 0 || children > 3 ||
        adults + children > 4) return { ok: false, error: 'people' };
    if (anyBusy(from, to)) return { ok: false, error: 'busy' };

    var guests = peopleText_(adults, children);
    var message = String(d.message || '').slice(0, 2000);
    var extras = [];
    if (d.cot === true) extras.push('dětská postýlka');
    if (d.chair === true) extras.push('dětská židlička');
    var extrasText = extras.length ? extras.join(', ') : 'nic';
    var stay = calcStay(from, to, adults);
    var price = money(stay.total);

    var ev = getCal().createAllDayEvent('Poptávka: ' + email, from, to, { description:
      'E-mail: ' + email + '\nHosté: ' + guests + '\nDospělí: ' + adults + '\nPočet dětí: ' + children +
      '\nPro děti: ' + extrasText + '\nCena: ' + price + '\nMístní poplatek: ' + money(stay.localFee) +
      '\n\n' + message });
    ev.setColor(CalendarApp.EventColor.YELLOW);

    MailApp.sendEmail({
      to: NOTIFY.join(','), replyTo: email, subject: 'Poptávka termínu – Costa Plana',
      body: 'Nová poptávka z webu.\n\nPříjezd: ' + czDate(d.from) + '\nOdjezd: ' + czDate(d.to) +
            '\nHosté: ' + guests + '\nPro děti: ' + extrasText +
            '\nCena za ubytování: ' + money(stay.accommodation) + '\nÚklid: ' + money(stay.cleaning) +
            '\nMístní poplatek (' + adults + ' dospělí, děti bez poplatku): ' + money(stay.localFee) +
            '\nCena celkem: ' + price +
            '\nE-mail hosta: ' + email + '\n\nZpráva:\n' + message +
            '\n\nTermín je v kalendáři zapsán jako předběžný (žlutě).' +
            '\n\nPotvrzení nebo zamítnutí v administraci (nutné přihlášení): ' + ADMIN_PAGE
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ================= Obsazenost =================
function busyNights() {
  var cal = getCal();
  var tz = cal.getTimeZone();
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var end = new Date(start.getTime()); end.setDate(end.getDate() + DAYS_AHEAD);
  var map = {};
  cal.getEvents(start, end).forEach(function (ev) {
    var s = ev.getStartTime(), f = ev.getEndTime();
    var day = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    var last = ev.isAllDayEvent() ? new Date(f.getTime() - 1) : new Date(f.getTime() - 60000);
    var lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    for (; day <= lastDay; day.setDate(day.getDate() + 1)) {
      map[Utilities.formatDate(day, tz, 'yyyy-MM-dd')] = true;
    }
  });
  return map;
}

function anyBusy(from, to) {
  var tz = getCal().getTimeZone(), busy = busyNights();
  for (var t = new Date(from); t < to; t.setDate(t.getDate() + 1)) {
    if (busy[Utilities.formatDate(t, tz, 'yyyy-MM-dd')]) return true;
  }
  return false;
}

// ================= Ceny =================
function getPrices() {
  var raw = PropertiesService.getScriptProperties().getProperty('prices');
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return DEFAULT_PRICES;
}

function nightPrice(md, prices) {
  var price = prices.defaultPrice;
  prices.rules.forEach(function (r) {
    var hit = r.from <= r.to ? (md >= r.from && md <= r.to) : (md >= r.from || md <= r.to);
    if (hit) price = r.price;
  });
  return price;
}

// Výpočet používá kalendářní dny v UTC, aby časová pásma skriptu a kalendáře neposouvala noc.
function calcStay(from, to, adults) {
  var prices = getPrices(), sum = 0, nights = 0;
  var d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  var end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  while (d.getTime() < end) {
    var md = ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
    sum += nightPrice(md, prices);
    nights++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  var localFee = prices.perPersonNight * adults * nights;
  return { nights: nights, accommodation: sum, cleaning: prices.cleaning, localFee: localFee,
           total: sum + prices.cleaning + localFee };
}

function validatePrices(p) {
  function num(x) { x = Number(x); return isFinite(x) && x >= 0 && x <= 1000000 ? Math.round(x) : null; }
  var md = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (!p || !Array.isArray(p.rules) || p.rules.length > 40) return null;
  var o = { cleaning: num(p.cleaning), perPersonNight: num(p.perPersonNight), defaultPrice: num(p.defaultPrice), rules: [] };
  if (o.cleaning === null || o.perPersonNight === null || o.defaultPrice === null) return null;
  for (var i = 0; i < p.rules.length; i++) {
    var r = p.rules[i], price = num(r.price);
    if (price === null || !md.test(String(r.from)) || !md.test(String(r.to))) return null;
    o.rules.push({ label: String(r.label || '').slice(0, 80), from: r.from, to: r.to, price: price });
  }
  return o;
}

// ================= Události (interní, voláno jen z administrace) =================
function peopleText_(adults, children) {
  return adults + (adults === 1 ? ' dospělá osoba' : ' dospělé osoby') + ', ' +
         children + (children === 1 ? ' dítě' : ' děti');
}

function eventInfo(ev) {
  var tz = getCal().getTimeZone();
  var d = ev.getDescription() || '', t = ev.getTitle();
  function get(label) { var m = new RegExp('^' + label + ': (.*)$', 'm').exec(d); return m ? m[1] : ''; }
  var type = t.indexOf('Poptávka') === 0 ? 'inquiry' : t.indexOf('Rezervace') === 0 ? 'booked' :
             t.indexOf('Blokace') === 0 ? 'block' : 'other';
  return {
    id: ev.getId(), type: type, title: t,
    from: Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd'),
    to: Utilities.formatDate(ev.getEndTime(), tz, 'yyyy-MM-dd'),
    email: get('E-mail'), guests: get('Hosté'), adults: get('Dospělí'), children: get('Počet dětí'),
    kids: get('Pro děti'), price: get('Cena'), localFee: get('Místní poplatek'),
    message: d.split('\n\n').slice(1).join('\n\n')
  };
}

function confirmEvent_(ev, sendMail) {
  var i = eventInfo(ev);
  ev.setTitle('Rezervace: ' + (i.email || 'host'));
  ev.setColor(CalendarApp.EventColor.GREEN);
  if (sendMail && i.email) {
    MailApp.sendEmail({ to: i.email, replyTo: OWNER, name: 'Apartmán Costa Plana',
      subject: 'Potvrzení rezervace – apartmán Costa Plana',
      body: 'Dobrý den,\n\nrádi potvrzujeme rezervaci apartmánu Costa Plana (Černá v Pošumaví, Lipno).\n\n' +
            'Příjezd: ' + czDate(i.from) + '\nOdjezd: ' + czDate(i.to) + '\nHosté: ' + i.guests +
            (i.adults ? '\nDospělí: ' + i.adults : '') +
            (i.children !== '' ? '\nDěti: ' + i.children + ' (bez místního poplatku)' : '') +
            (i.localFee ? '\nMístní poplatek: ' + i.localFee : '') +
            (i.price ? '\nCena za pobyt: ' + i.price : '') +
            '\n\nS dotazy nebo upřesněním příjezdu odpovězte prosím na tento e-mail.\n\nS pozdravem\nApartmán Costa Plana' });
  }
}

function rejectEvent_(ev, sendMail) {
  var i = eventInfo(ev);
  if (sendMail && i.email) {
    MailApp.sendEmail({ to: i.email, replyTo: OWNER, name: 'Apartmán Costa Plana',
      subject: 'Poptávka termínu – apartmán Costa Plana',
      body: 'Dobrý den,\n\nděkujeme za zájem o apartmán Costa Plana. Bohužel vám v požadovaném termínu (' +
            czDate(i.from) + ' – ' + czDate(i.to) + ') nemůžeme apartmán potvrdit.\n\n' +
            'Rádi vám navrhneme jiný termín, stačí odpovědět na tento e-mail.\n\nS pozdravem\nApartmán Costa Plana' });
  }
  ev.deleteEvent();
}

function findInquiry_(id) {
  var ev = getCal().getEventById(String(id || ''));
  return ev && ev.getTitle().indexOf('Poptávka') === 0 ? ev : null;
}

// ================= Administrátorské funkce (dosažitelné jen přes adminCall_) =================
function adminList_() {
  var cal = getCal();
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var end = new Date(start.getTime()); end.setDate(end.getDate() + DAYS_AHEAD);
  var list = cal.getEvents(start, end).map(eventInfo).sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
  return { ok: true, events: list, prices: getPrices() };
}

function adminConfirm_(id, sendMail) {
  var ev = findInquiry_(id); if (!ev) return { ok: false, error: 'notfound' };
  confirmEvent_(ev, sendMail === true); return { ok: true };
}

function adminReject_(id, sendMail) {
  var ev = findInquiry_(id); if (!ev) return { ok: false, error: 'notfound' };
  rejectEvent_(ev, sendMail === true); return { ok: true };
}

function adminDelete_(id) {
  var ev = getCal().getEventById(String(id || ''));
  if (!ev) return { ok: false, error: 'notfound' };
  var t = ev.getTitle();
  if (t.indexOf('Blokace') !== 0 && t.indexOf('Rezervace') !== 0 && t.indexOf('Poptávka') !== 0) return { ok: false, error: 'notfound' };
  ev.deleteEvent(); return { ok: true };
}

function adminAdd_(o) {
  o = o || {};
  var from = parseDate(o.from), to = parseDate(o.to);
  if (!from || !to || to <= from) return { ok: false, error: 'dates' };
  if (anyBusy(from, to)) return { ok: false, error: 'busy' };
  var booked = o.type === 'booked', note = String(o.note || '').slice(0, 100) || 'ručně';
  var ev = getCal().createAllDayEvent((booked ? 'Rezervace: ' : 'Blokace: ') + note, from, to);
  ev.setColor(booked ? CalendarApp.EventColor.GREEN : CalendarApp.EventColor.GRAY);
  return { ok: true };
}

function adminSavePrices_(p) {
  var clean = validatePrices(p); if (!clean) return { ok: false, error: 'invalid' };
  PropertiesService.getScriptProperties().setProperty('prices', JSON.stringify(clean));
  return { ok: true };
}

// ================= Pomocné =================
function infoPage(title, text, url, btn) {
  var h = '<div style="font:16px/1.5 sans-serif;max-width:480px;margin:40px auto;padding:0 20px"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' +
    (url ? '<p><a target="_top" href="' + esc(url) + '" style="display:inline-block;background:#1f6f78;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none">' + esc(btn) + '</a></p>' : '') + '</div>';
  return HtmlService.createHtmlOutput(h).setTitle('Costa Plana');
}
function parseDate(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  var year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  var date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}
function czDate(iso) { var a = String(iso).split('-'); return a.length === 3 ? Number(a[2]) + '. ' + Number(a[1]) + '. ' + a[0] : iso; }
function money(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Kč'; }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

// Odpověď: JSON, nebo (s parametrem callback, jen veřejné GET operace) JavaScript volání funkce
function out(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback && /^[A-Za-z0-9_]+$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}


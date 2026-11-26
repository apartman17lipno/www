// Costa Plana – poptávky, dostupnost, ceny a administrace (Google Apps Script)
//
// Jediné nasazení: Spustit jako: Já, přístup: Kdokoli.
// VEŘEJNÉ vstupy (doGet, pro index.html): obsazenost, ceny, odeslání poptávky.
// ADMINISTRACE (doPost, pro admin.html): přihlášení přes Google (ID token ověřený na serveru),
// serverová relace a všechny administrátorské operace. Vyžaduje běhové prostředí V8.

// ================= Nastavení =================
var OWNER = 'apartman17lipno@gmail.com';
var CALENDAR_ID = '0fb67dccf9787e1dc5ed00dee95e95304302de42e63d1e376b9a3be0cd48193e@group.calendar.google.com';  // Testovací kalendář
var ADMINS = ['apartman17lipno@gmail.com', 'miloslav.filip@gmail.com', 'mona.viskova@gmail.com'];  // jen tyto účty smějí do administrace
var NOTIFY = ['apartman17lipno@gmail.com'];                         // kdo dostává e-maily o nových poptávkách
var ADMIN_PAGE = 'https://apartman17lipno.github.io/www-test/admin.html';
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
  if (p.action === 'checkin') return checkinPage_(p.id, p.token);
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
      case 'submit': result = handleSubmit(d.data || d); break;
      case 'login':  result = login_(d.credential); break;
      case 'logout': result = logout_(d.s); break;
      case 'checkin': result = completeCheckin_(d.id, d.token, d.guests); break;
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
// Spusťte jednou ručně po vložení kódu: vyvolá oprávnění a bezpečně nainstaluje denní trigger.
function authorize() {
  getCal(); MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs');
  CacheService.getScriptCache(); PropertiesService.getScriptProperties();
  setupReservationAutomation();
}

// Jediná brána k administrátorským funkcím: vždy ověří relaci na serveru
function adminCall_(d) {
  var email = checkSession_(d.s);
  if (!email) return { ok: false, error: 'auth' };
  var name = String(d.fn || ''), args = Array.isArray(d.args) ? d.args : [];
  var funcs = {
    adminList: adminList_, adminConfirm: adminConfirm_, adminApprove: adminApprove_,
    adminReject: adminReject_, adminDelete: adminDelete_, adminCancel: adminCancel_,
    adminAdd: adminAdd_, adminSavePrices: adminSavePrices_,
    adminRecordPayment: adminRecordPayment_, adminResendEmail: adminResendEmail_,
    adminReschedule: adminReschedule_, adminSaveLifecycleSettings: adminSaveLifecycleSettings_,
    adminMigrateLegacy: adminMigrateLegacy_, adminGuestbookPdf: adminGuestbookPdf_
  };
  if (!Object.prototype.hasOwnProperty.call(funcs, name)) return { ok: false, error: 'fn' };
  console.log('Správce ' + email + ': ' + name);
  if (name === 'adminApprove') return adminApprove_(args[0], email);
  if (name === 'adminRecordPayment') return adminRecordPayment_(args[0], args[1], email);
  if (name === 'adminResendEmail') return adminResendEmail_(args[0], args[1], email);
  if (name === 'adminReschedule') return adminReschedule_(args[0], args[1], args[2], email);
  if (name === 'adminCancel') return adminCancel_(args[0], email);
  if (name === 'adminMigrateLegacy') return adminMigrateLegacy_(args[0], args[1], args[2], args[3], email);
  if (name === 'adminReject') return adminReject_(args[0], args[1], email);
  if (name === 'adminConfirm') return adminApprove_(args[0], email);
  if (name === 'adminGuestbookPdf') return adminGuestbookPdf_(args[0], args[1]);
  return funcs[name].apply(null, args);
}

// ================= Kalendář =================
function getCal() {
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error('Kalendář ' + CALENDAR_ID + ' nebyl nalezen.');
  return cal;
}

// Variabilní symbol je 10místné číselné číslo rezervace (YYMMDD + denní pořadí).
// Volá se z operací, které již drží ScriptLock.
function nextReservationNumber_() {
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), getCal().getTimeZone(), 'yyMMdd');
  var savedDay = props.getProperty('reservation_number_day') || '';
  var sequence = savedDay === day ? (parseInt(props.getProperty('reservation_number_sequence') || '0', 10) || 0) : 0;
  sequence++;
  if (sequence > 9999) throw new Error('Denní limit čísel rezervací byl překročen.');
  props.setProperty('reservation_number_day', day);
  props.setProperty('reservation_number_sequence', String(sequence));
  return day + ('0000' + sequence).slice(-4);
}
function ensureReservationNumber_(ev, meta) {
  if (!/^\d{10}$/.test(String(meta.reservationNumber || ''))) {
    meta.reservationNumber = nextReservationNumber_();
    saveReservationMeta_(ev, meta);
  }
  return meta.reservationNumber;
}

// ================= Poptávka z webu (veřejné) =================
function handleSubmit(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (d.web) return { ok: true };
    var email = String(d.email || '').slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'email' };
    var from = parseDate(d.from), to = parseDate(d.to);
    if (!from || !to || to <= from || (to - from) / 86400000 > MAX_NIGHTS) return { ok: false, error: 'dates' };
    var adults = Number(d.adults), children = Number(d.children);
    if (d.adults == null && d.children == null) { adults = parseInt(String(d.guests || ''), 10) || 1; children = 0; }
    if (!isFinite(adults) || Math.floor(adults) !== adults || adults < 1 || adults > 4 ||
        !isFinite(children) || Math.floor(children) !== children || children < 0 || children > 3 ||
        adults + children > 4) return { ok: false, error: 'people' };
    if (anyBusy(from, to)) return { ok: false, error: 'busy' };
    var guests = peopleText_(adults, children), message = String(d.message || '').slice(0, 2000);
    var extras = [];
    if (d.cot === true) extras.push('dětská postýlka');
    if (d.chair === true) extras.push('dětská židlička');
    var extrasText = extras.length ? extras.join(', ') : 'nic', stay = calcStay(from, to, adults);
    var pricing = { accommodation: stay.accommodation, accommodationAmount: stay.accommodation,
      cleaning: stay.cleaning, localFee: stay.localFee, total: stay.total,
      deposit: Math.round(stay.accommodation * 0.5), nights: stay.nights };
    var description = 'E-mail: ' + email + '\nHosté: ' + guests + '\nDospělí: ' + adults + '\nPočet dětí: ' + children +
      '\nPro děti: ' + extrasText + '\nCena: ' + money(stay.total) + '\nUbytování: ' + money(stay.accommodation) +
      '\nÚklid: ' + money(stay.cleaning) + '\nMístní poplatek: ' + money(stay.localFee) +
      '\n\nZpráva:\n' + message;
    var ev = getCal().createAllDayEvent('Poptávka: ' + email, from, to, { description: description });
    ev.setColor(CalendarApp.EventColor.YELLOW);
    var meta = { version: 1, reservationNumber: nextReservationNumber_(), status: 'Ke schválení', email: email, adults: adults, children: children,
      guests: guests, extras: extrasText, pricing: pricing, payments: [], notifications: {},
      createdAt: new Date().toISOString(), approvedAt: null, history: [], checkin: { completedAt: null, guestData: null } };
    addHistory_(meta, 'Vytvoření rezervace', 'host', { status: meta.status });
    saveReservationMeta_(ev, meta);
    MailApp.sendEmail({ to: NOTIFY.join(','), replyTo: email, subject: 'Nová rezervace ke schválení – Costa Plana',
      body: 'Nová rezervace čeká na schválení.\n\nČíslo rezervace / variabilní symbol: ' + meta.reservationNumber + '\nPříjezd: ' + czDate(d.from) + '\nOdjezd: ' + czDate(d.to) +
        '\nHosté: ' + guests + '\nPro děti: ' + extrasText + '\nCena za ubytování: ' + money(stay.accommodation) +
        '\nÚklid: ' + money(stay.cleaning) + '\nMístní poplatek: ' + money(stay.localFee) +
        '\nCena celkem: ' + money(stay.total) + '\nE-mail hosta: ' + email + '\n\nZpráva:\n' + message +
        '\n\nSchválení a další správa v administraci: ' + ADMIN_PAGE });
    return { ok: true };
  } finally { lock.releaseLock(); }
}
// ================= Obsazenost =================
function isBlockingEvent_(ev) {
  var title = String(ev.getTitle() || '');
  // A cancelled/rejected calendar event may predate its metadata; its explicit title still wins.
  if (/^(?:Zrušená|Zamítnutá)\s*:/i.test(title)) return false;
  var meta = readReservationMeta_(ev);
  return !(meta && (meta.status === 'Zamítnutá' || meta.status === 'Zrušená'));
}

function busyNights() {
  var cal = getCal();
  var tz = cal.getTimeZone();
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var end = new Date(start.getTime()); end.setDate(end.getDate() + DAYS_AHEAD);
  var map = {};
  cal.getEvents(start, end).forEach(function (ev) {
    if (!isBlockingEvent_(ev)) return;
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
  // Check exact overlapping events so the availability view and submission use the same rule.
  return getCal().getEvents(from, to).some(function (ev) {
    return isBlockingEvent_(ev);
  });
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
  var tz = getCal().getTimeZone(), d = ev.getDescription() || '', t = ev.getTitle();
  var meta = readReservationMeta_(ev), plain = descriptionWithoutMeta_(d);
  function get(label) { var m = new RegExp('^' + label + ': (.*)$', 'm').exec(plain); return m ? m[1] : ''; }
  var type = meta ? 'lifecycle' : t.indexOf('Poptávka') === 0 ? 'inquiry' : t.indexOf('Rezervace') === 0 ? 'booked' :
             t.indexOf('Blokace') === 0 ? 'block' : 'other';
  var paid = meta ? totalPaid_(meta) : 0;
  return {
    id: ev.getId(), type: type, title: t, reservationNumber: meta ? (meta.reservationNumber || '') : '',
    from: Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd'),
    to: Utilities.formatDate(ev.getEndTime(), tz, 'yyyy-MM-dd'),
    email: meta ? meta.email : get('E-mail'), guests: meta ? meta.guests : get('Hosté'),
    adults: meta ? String(meta.adults) : get('Dospělí'), children: meta ? String(meta.children) : get('Počet dětí'),
    kids: meta ? meta.extras : get('Pro děti'), price: meta ? money(meta.pricing.total) : get('Cena'),
    localFee: meta ? money(meta.pricing.localFee) : get('Místní poplatek'),
    message: plain.split('\n\nZpráva:\n').slice(1).join('\n\n'),
    lifecycle: !!meta, status: meta ? meta.status : '', approvedAt: meta ? meta.approvedAt : null,
    pricing: meta ? meta.pricing : null, payments: meta ? meta.payments : [],
    totalPaid: paid, remaining: meta ? Math.max(0, meta.pricing.total - paid) : null,
    notifications: meta ? meta.notifications : {}, checkin: meta ? meta.checkin : null,
    history: meta ? meta.history : []
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
            '\n\nS dotazy nebo upřesněním příjezdu odpovězte prosím na tento e-mail.\n\nS pozdravem\nApartmán 17 - Costa Plana' });
  }
}

function rejectEvent_(ev, sendMail) {
  var i = eventInfo(ev);
  if (sendMail && i.email) {
    MailApp.sendEmail({ to: i.email, replyTo: OWNER, name: 'Apartmán Costa Plana',
      subject: 'Poptávka termínu – apartmán Costa Plana',
      body: 'Dobrý den,\n\nděkujeme za zájem o apartmán Costa Plana. Bohužel vám v požadovaném termínu (' +
            czDate(i.from) + ' – ' + czDate(i.to) + ') nemůžeme apartmán potvrdit.\n\n' +
            'Rádi vám navrhneme jiný termín, stačí odpovědět na tento e-mail.\n\nS pozdravem\nApartmán 17 - Costa Plana' });
  }
  ev.deleteEvent();
}

function findInquiry_(id) {
  var ev = getCal().getEventById(String(id || ''));
  return ev && ev.getTitle().indexOf('Poptávka') === 0 ? ev : null;
}

// ================= Administrátorské funkce (dosažitelné jen přes adminCall_) =================
function adminList_() {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
  var cal = getCal();
  var start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - DAYS_AHEAD);
  var end = new Date(start.getTime()); end.setDate(end.getDate() + DAYS_AHEAD * 2);
  var todayKey = Utilities.formatDate(new Date(), cal.getTimeZone(), 'yyyy-MM-dd');
  var list = cal.getEvents(start, end).map(function (ev) {
    var meta = readReservationMeta_(ev);
    if (meta && !meta.reservationNumber) ensureReservationNumber_(ev, meta);
    return eventInfo(ev);
  }).sort(function (a, b) {
    var af = a.from >= todayKey, bf = b.from >= todayKey;
    if (af !== bf) return af ? -1 : 1;
    return af ? (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) : (a.from > b.from ? -1 : a.from < b.from ? 1 : 0);
  });
  var settings = lifecycleSettings_();
  return { ok: true, events: list, prices: getPrices(), settings: settings };
  } finally { lock.releaseLock(); }
}

// Vytvoří PDF evidenční knihy pouze z pobytů, které jsou uzavřené a mají dokončený check-in.
function adminGuestbookPdf_(fromValue, toValue) {
  var from = parseDate(fromValue), to = parseDate(toValue);
  if (!from || !to || from > to) return { ok: false, error: 'dates' };
  var today = parseDate(Utilities.formatDate(new Date(), getCal().getTimeZone(), 'yyyy-MM-dd'));
  if (to > today) return { ok: false, error: 'dates' };
  var spanDays = nightsBetween_(Utilities.formatDate(from, getCal().getTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(to, getCal().getTimeZone(), 'yyyy-MM-dd'));
  if (spanDays > 2190) return { ok: false, error: 'range' };

  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var cal = getCal(), tz = cal.getTimeZone(), endExclusive = new Date(to.getTime());
    endExclusive.setDate(endExclusive.getDate() + 1);
    var entries = [], incompleteGuests = 0;
    cal.getEvents(from, endExclusive).forEach(function (ev) {
      var meta = readReservationMeta_(ev);
      if (!meta || meta.status !== 'Pobyt ukončen' || !meta.checkin || !meta.checkin.completedAt ||
          !Array.isArray(meta.checkin.guestData)) return;
      var arrival = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
      if (arrival < fromValue || arrival > toValue) return;
      meta.checkin.guestData.forEach(function (guest) {
        guest = guest || {};
        var missing = [];
        if (!guest.firstName) missing.push('jméno');
        if (!guest.lastName) missing.push('příjmení');
        if (!guest.address) missing.push('adresa');
        if (!guest.birthDate) missing.push('datum narození');
        if (!guest.documentType || !guest.documentNumber) missing.push('doklad totožnosti');
        if (!guest.citizenship) missing.push('státní občanství');
        if (guest.feeAmount == null && !guest.feeExemption) missing.push('výše poplatku nebo důvod osvobození');
        if (missing.length) incompleteGuests++;
        entries.push({
          reservationNumber: meta.reservationNumber || '',
          from: arrival,
          to: Utilities.formatDate(ev.getEndTime(), tz, 'yyyy-MM-dd'),
          firstName: guest.firstName || '', lastName: guest.lastName || '',
          birthDate: guest.birthDate || '', address: guest.address || '',
          documentType: guest.documentType || '', documentNumber: guest.documentNumber || '',
          citizenship: guest.citizenship || '', feeAmount: Number(guest.feeAmount || 0),
          feeExemption: guest.feeExemption || '', missing: missing.join(', ')
        });
      });
    });
    entries.sort(function (a, b) {
      return a.from.localeCompare(b.from) || a.lastName.localeCompare(b.lastName, 'cs') || a.firstName.localeCompare(b.firstName, 'cs');
    });
    if (!entries.length) return { ok: false, error: 'empty' };

    var tpl = HtmlService.createTemplateFromFile('guestbook');
    tpl.entries = entries;
    tpl.periodFrom = czDate(fromValue); tpl.periodTo = czDate(toValue);
    tpl.generatedAt = Utilities.formatDate(new Date(), tz, 'd. M. yyyy HH:mm');
    tpl.incompleteGuests = incompleteGuests;
    var pdf = tpl.evaluate().getBlob().getAs(MimeType.PDF)
      .setName('evidencni-kniha-hostu-' + fromValue + '-az-' + toValue + '.pdf');
    return { ok: true, fileName: pdf.getName(), pdf: Utilities.base64Encode(pdf.getBytes()),
      entries: entries.length, incompleteGuests: incompleteGuests };
  } finally { lock.releaseLock(); }
}

function adminConfirm_(id, sendMail) { return adminApprove_(id, OWNER); }

function adminApprove_(id, actor) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ev = getCal().getEventById(String(id || '')), meta = ev && readReservationMeta_(ev);
    if (!ev || !meta || meta.status !== 'Ke schválení') return { ok: false, error: 'notfound' };
    if (!meta.pricing || !meta.pricing.total || !meta.pricing.accommodationAmount) return { ok: false, error: 'legacy' };
    ensureReservationNumber_(ev, meta);
    var settings = lifecycleSettings_();
    if (!settings.bankAccount) return { ok: false, error: 'settings' };
    var tz = getCal().getTimeZone();
    var arrival = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
    var paymentStage = daysUntil_(arrival, tz) <= 14 ? 'balance' : 'deposit';
    meta.approvedAt = new Date().toISOString(); meta.status = paymentStage === 'balance' ? 'Čeká na platbu' : 'Čeká na zálohu';
    addHistory_(meta, 'Schválení rezervace', actor, { status: meta.status, firstPaymentRequest: paymentStage });
    ev.setTitle('Rezervace: ' + (meta.email || 'host')); ev.setColor(CalendarApp.EventColor.GREEN);
    saveReservationMeta_(ev, meta);
    var sent = sendLifecycleEmail_(ev, meta, paymentStage, false, actor);
    if (!sent.ok) return sent;
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function legacyMeta_(ev) {
  var info = eventInfo(ev), total = parseMoney_(info.price), fee = parseMoney_(info.localFee);
  return { version: 1, status: 'Ke schválení', email: info.email, adults: Number(info.adults || 0),
    children: Number(info.children || 0), guests: info.guests || '', extras: info.kids || 'nic',
    pricing: { accommodationAmount: 0, cleaning: 0, localFee: fee, total: total, deposit: 0, nights: nightsBetween_(info.from, info.to) },
    payments: [], notifications: {}, createdAt: new Date().toISOString(), approvedAt: null,
    history: [{ at: new Date().toISOString(), action: 'Zpětné označení starší události', by: 'system', status: 'Ke schválení' }],
    checkin: { completedAt: null, guestData: null }, needsPriceReview: true, message: info.message };
}

function adminMigrateLegacy_(id, accommodation, cleaning, localFee, actor) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ev = findInquiry_(id); if (!ev) return { ok: false, error: 'notfound' };
    if (readReservationMeta_(ev)) return { ok: false, error: 'exists' };
    var a = validMoney_(accommodation), c = validMoney_(cleaning), f = validMoney_(localFee);
    if (a === null || c === null || f === null || a <= 0) return { ok: false, error: 'invalid' };
    var meta = legacyMeta_(ev);
    meta.reservationNumber = nextReservationNumber_();
    meta.pricing = { accommodationAmount: a, cleaning: c, localFee: f, total: a + c + f,
      deposit: Math.round(a * .5), nights: nightsBetween_(eventInfo(ev).from, eventInfo(ev).to) };
    meta.needsPriceReview = false;
    addHistory_(meta, 'Doplnění ceny starší rezervace', actor, { accommodation: a, cleaning: c, localFee: f });
    saveReservationMeta_(ev, meta);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function adminReject_(id, sendMail, actor) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ev = getCal().getEventById(String(id || ''));
    if (!ev || (ev.getTitle().indexOf('Poptávka') !== 0 && !readReservationMeta_(ev))) return { ok: false, error: 'notfound' };
    var meta = readReservationMeta_(ev) || legacyMeta_(ev);
    if (meta.status !== 'Ke schválení') return { ok: false, error: 'state' };
    meta.status = 'Zamítnutá'; meta.rejectedAt = new Date().toISOString();
    addHistory_(meta, 'Zamítnutí rezervace', actor, { status: meta.status });
    if (sendMail === true && meta.email) {
      MailApp.sendEmail({ to: meta.email, replyTo: OWNER, name: 'Apartmán Costa Plana',
        subject: 'Rezervace termínu – apartmán Costa Plana',
        body: 'Dobrý den,\n\nděkujeme za zájem o apartmán Costa Plana. Požadovaný termín ' +
          czDate(Utilities.formatDate(ev.getStartTime(), getCal().getTimeZone(), 'yyyy-MM-dd')) + ' – ' +
          czDate(Utilities.formatDate(ev.getEndTime(), getCal().getTimeZone(), 'yyyy-MM-dd')) +
          ' bohužel nemůžeme potvrdit.\n\nS pozdravem\nApartmán 17 - Costa Plana' });
    }
    ev.setTitle('Zamítnutá: ' + (meta.email || 'rezervace')); ev.setColor(CalendarApp.EventColor.GRAY);
    saveReservationMeta_(ev, meta); return { ok: true };
  } finally { lock.releaseLock(); }
}

function adminDelete_(id) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ev = getCal().getEventById(String(id || ''));
    if (!ev) return { ok: false, error: 'notfound' };
    var meta = readReservationMeta_(ev);
    // Managed reservations remain auditable; only rejected ones may be permanently removed.
    if (meta) {
      if (['Zamítnutá', 'Zrušená'].indexOf(meta.status) < 0) return { ok: false, error: 'managed' };
      ev.deleteEvent(); return { ok: true };
    }
    var t = ev.getTitle();
    if (t.indexOf('Blokace') !== 0 && t.indexOf('Rezervace') !== 0 && t.indexOf('Poptávka') !== 0) return { ok: false, error: 'notfound' };
    ev.deleteEvent(); return { ok: true };
  } finally { lock.releaseLock(); }
}

function adminCancel_(id, actor) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ev = getCal().getEventById(String(id || '')), meta = ev && readReservationMeta_(ev);
    if (!ev || !meta || meta.status === 'Online check-in dokončen' || meta.status === 'Pobyt ukončen' || meta.status === 'Zrušená' || meta.status === 'Zamítnutá')
      return { ok: false, error: 'notfound' };
    meta.status = 'Zrušená'; meta.cancelledAt = new Date().toISOString();
    addHistory_(meta, 'Zrušení rezervace', actor, { status: meta.status });
    ev.setTitle('Zrušená: ' + (meta.email || 'rezervace')); ev.setColor(CalendarApp.EventColor.GRAY);
    saveReservationMeta_(ev, meta); return { ok: true };
  } finally { lock.releaseLock(); }
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


/* ================= Životní cyklus rezervace =================
   Záznam rezervace i auditní stopa zůstávají u události Kalendáře.
   Přístupový kód a platební údaje jsou nastavení Script Properties.
*/
var RESERVATION_META_MARKER = '\n\n[CP_LIFECYCLE_V1]\n';

function descriptionWithoutMeta_(description) {
  var i = String(description || '').lastIndexOf(RESERVATION_META_MARKER);
  return i < 0 ? String(description || '') : String(description || '').substring(0, i);
}
function readReservationMeta_(ev) {
  var d = ev && ev.getDescription ? (ev.getDescription() || '') : '';
  var i = d.lastIndexOf(RESERVATION_META_MARKER);
  if (i < 0) return null;
  try {
    var m = JSON.parse(d.substring(i + RESERVATION_META_MARKER.length));
    if (!m || m.version !== 1 || !m.pricing) return null;
    // Compatibility: earlier lifecycle builds stored the lodging amount as `accommodation`.
    if (m.pricing.accommodationAmount == null && m.pricing.accommodation != null)
      m.pricing.accommodationAmount = Number(m.pricing.accommodation);
    if (m.pricing.accommodation == null && m.pricing.accommodationAmount != null)
      m.pricing.accommodation = Number(m.pricing.accommodationAmount);
    if (m.pricing.deposit == null && Number(m.pricing.accommodationAmount) > 0)
      m.pricing.deposit = Math.round(Number(m.pricing.accommodationAmount) * 0.5);
    return m;
  } catch (e) { return null; }
}
function saveReservationMeta_(ev, meta) {
  var d = ev.getDescription() || '', i = d.lastIndexOf(RESERVATION_META_MARKER);
  var base = i < 0 ? d : d.substring(0, i);
  ev.setDescription(base + RESERVATION_META_MARKER + JSON.stringify(meta));
}
function addHistory_(meta, action, by, details) {
  if (!Array.isArray(meta.history)) meta.history = [];
  meta.history.push({ at: new Date().toISOString(), action: action, by: String(by || 'system'), details: details || null });
}
function totalPaid_(meta) {
  return (meta.payments || []).reduce(function (sum, p) { return sum + Number(p.amount || 0); }, 0);
}
function validMoney_(v) {
  var n = Number(v);
  return isFinite(n) && n >= 0 && n <= 1000000 ? Math.round(n) : null;
}
function parseMoney_(v) {
  var digits = String(v || '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}
function nightsBetween_(from, to) {
  var a = String(from).split('-'), b = String(to).split('-');
  return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000);
}
function lifecycleSettings_() {
  var p = PropertiesService.getScriptProperties();
  return { bankAccount: p.getProperty('lifecycle_bank_account') || '',
    accountName: p.getProperty('lifecycle_account_name') || '',
    accessCode: p.getProperty('lifecycle_access_code') || '' };
}
function adminSaveLifecycleSettings_(settings) {
  settings = settings || {};
  var account = String(settings.bankAccount || '').trim().slice(0, 100);
  var accountName = String(settings.accountName || '').trim().slice(0, 100);
  var code = String(settings.accessCode || '').trim().slice(0, 100);
  var p = PropertiesService.getScriptProperties();
  p.setProperty('lifecycle_bank_account', account);
  p.setProperty('lifecycle_account_name', accountName);
  if (code) p.setProperty('lifecycle_access_code', code);
  return { ok: true };
}
function refreshReservationStatus_(meta) {
  if (meta.status === 'Zamítnutá' || meta.status === 'Zrušená' || meta.status === 'Pobyt ukončen') return;
  if (meta.checkin && meta.checkin.completedAt) { meta.status = 'Online check-in dokončen'; return; }
  if (meta.checkin && meta.checkin.invitedAt) { meta.status = 'Čeká na online check-in'; return; }
  var paid = totalPaid_(meta), total = Number(meta.pricing.total || 0);
  if (total > 0 && paid >= total) { meta.status = 'Zaplacená'; return; }
  if (meta.notifications && meta.notifications.balance && meta.notifications.balance.sentAt) {
    meta.status = 'Čeká na platbu'; return;
  }
  if (paid > 0) { meta.status = 'Zaplacená záloha'; return; }
  if (meta.approvedAt) { meta.status = 'Čeká na zálohu'; return; }
  meta.status = 'Ke schválení';
}
function daysUntil_(iso, tz) {
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return nightsBetween_(today, iso);
}
function setupReservationAutomation() {
  var triggers = ScriptApp.getProjectTriggers();
  var timezone = getCal().getTimeZone();
  var lifecycleExists = triggers.some(function (t) { return t.getHandlerFunction() === 'processReservationLifecycle'; });
  var checkoutExists = triggers.some(function (t) { return t.getHandlerFunction() === 'processCheckoutReminder'; });
  var stayEndExists = triggers.some(function (t) { return t.getHandlerFunction() === 'processStayEndNotifications'; });
  if (!lifecycleExists) ScriptApp.newTrigger('processReservationLifecycle').timeBased().everyDays(1).atHour(7).inTimezone(timezone).create();
  // Apps Script time triggers are approximate; this runs around 18:00 local time, after the prior-day reminder window begins.
  if (!checkoutExists) ScriptApp.newTrigger('processCheckoutReminder').timeBased().everyDays(1).atHour(18).nearMinute(15).inTimezone(timezone).create();
  // Keep this after 11:00 local time so the day-of-departure message is not sent early.
  if (!stayEndExists) ScriptApp.newTrigger('processStayEndNotifications').timeBased().everyDays(1).atHour(11).nearMinute(15).inTimezone(timezone).create();
  return { ok: true, installed: true, alreadyExisted: lifecycleExists, checkoutReminderInstalled: true,
    checkoutReminderAlreadyExisted: checkoutExists, stayEndNotificationInstalled: true, stayEndNotificationAlreadyExisted: stayEndExists };
}
function processReservationLifecycle() {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var cal = getCal(), tz = cal.getTimeZone();
    var today = parseDate(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
    var end = new Date(today.getTime()); end.setDate(end.getDate() + DAYS_AHEAD + 2);
    cal.getEvents(today, end).forEach(function (ev) {
      var meta = readReservationMeta_(ev);
      if (meta && !meta.reservationNumber) ensureReservationNumber_(ev, meta);
      if (!meta || !meta.approvedAt || meta.status === 'Zamítnutá' || meta.status === 'Zrušená' ||
          meta.status === 'Online check-in dokončen' || meta.status === 'Pobyt ukončen') return;
      var arrival = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
      var days = daysUntil_(arrival, tz);
      if (days > 0 && days <= 14 && totalPaid_(meta) < Number(meta.pricing.total || 0) &&
          !(meta.notifications && meta.notifications.balance)) {
        sendLifecycleEmail_(ev, meta, 'balance', false, 'automatizace');
        meta = readReservationMeta_(ev);
      }
      if (days > 0 && days <= 3 && totalPaid_(meta) >= Number(meta.pricing.total || 0) &&
          meta.status === 'Zaplacená' && !(meta.notifications && meta.notifications.checkin)) {
        sendLifecycleEmail_(ev, meta, 'checkin', false, 'automatizace');
      }
    });
  } finally { lock.releaseLock(); }
}
function processCheckoutReminder() {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var cal = getCal(), tz = cal.getTimeZone();
    var today = parseDate(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
    var departureDay = new Date(today.getTime()); departureDay.setDate(departureDay.getDate() + 1);
    var departure = Utilities.formatDate(departureDay, tz, 'yyyy-MM-dd');
    var scanStart = new Date(today.getTime()); scanStart.setDate(scanStart.getDate() - MAX_NIGHTS - 1);
    var scanEnd = new Date(departureDay.getTime()); scanEnd.setDate(scanEnd.getDate() + 1);
    cal.getEvents(scanStart, scanEnd).forEach(function (ev) {
      var meta = readReservationMeta_(ev);
      if (!meta || meta.status !== 'Online check-in dokončen' || !meta.checkin || !meta.checkin.completedAt ||
          Utilities.formatDate(ev.getEndTime(), tz, 'yyyy-MM-dd') !== departure ||
          (meta.notifications && meta.notifications.checkoutReminder)) return;
      if (!meta.notifications) meta.notifications = {};
      var attemptAt = new Date().toISOString();
      meta.notifications.checkoutReminder = { state: 'claimed', attemptAt: attemptAt, forDeparture: departure };
      addHistory_(meta, 'Připomínka přípravy apartmánu', 'automatizace', { departure: departure, state: 'claimed' });
      saveReservationMeta_(ev, meta);
      try {
        MailApp.sendEmail({
          to: NOTIFY.join(','),
          replyTo: OWNER,
          name: 'Apartmán Costa Plana',
          subject: 'Zítra končí pobyt – rezervace č. ' + meta.reservationNumber,
          body: 'Dobrý den,\n\npobyt z rezervace č. ' + meta.reservationNumber + ' končí zítra ' + czDate(departure) +
            '.\nPokud bude potřeba, je třeba apartmán uklidit a připravit na další pobyt.\n\nS pozdravem\nApartmán 17 - Costa Plana'
        });
        meta.notifications.checkoutReminder.state = 'sent';
        meta.notifications.checkoutReminder.sentAt = new Date().toISOString();
        addHistory_(meta, 'Připomínka přípravy apartmánu odeslána', 'automatizace', { departure: departure });
      } catch (err) {
        meta.notifications.checkoutReminder.state = 'error';
        meta.notifications.checkoutReminder.errorAt = new Date().toISOString();
        addHistory_(meta, 'Chyba při odesílání připomínky přípravy apartmánu', 'automatizace', { message: String(err).slice(0, 200) });
        console.error(err);
      }
      saveReservationMeta_(ev, meta);
    });
  } finally { lock.releaseLock(); }
}
function processStayEndNotifications() {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var cal = getCal(), tz = cal.getTimeZone();
    var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var today = parseDate(todayKey), scanStart = new Date(today.getTime()), scanEnd = new Date(today.getTime());
    scanStart.setDate(scanStart.getDate() - DAYS_AHEAD);
    scanEnd.setDate(scanEnd.getDate() + 1);
    cal.getEvents(scanStart, scanEnd).forEach(function (ev) {
      var meta = readReservationMeta_(ev);
      if (!meta || meta.status !== 'Online check-in dokončen' || !meta.checkin || !meta.checkin.completedAt) return;
      var departure = Utilities.formatDate(ev.getEndTime(), tz, 'yyyy-MM-dd');
      if (departure > todayKey || (meta.notifications && meta.notifications.stayEnded)) return;
      if (!meta.reservationNumber) ensureReservationNumber_(ev, meta);
      if (!meta.notifications) meta.notifications = {};
      var attemptAt = new Date().toISOString();
      meta.status = 'Pobyt ukončen';
      meta.stayEndedAt = attemptAt;
      meta.notifications.stayEnded = { state: 'claimed', attemptAt: attemptAt, forDeparture: departure };
      addHistory_(meta, 'Pobyt ukončen', 'automatizace', { departure: departure, state: 'claimed' });
      saveReservationMeta_(ev, meta);
      try {
        MailApp.sendEmail({
          to: NOTIFY.join(','),
          replyTo: OWNER,
          name: 'Apartmán 17 - Costa Plana',
          subject: 'Pobyt ukončen – rezervace č. ' + meta.reservationNumber,
          body: 'Dobrý den,\n\npobyt z rezervace č. ' + meta.reservationNumber + ' skončil ' +
            (departure === todayKey ? 'dnes ' : 'dne ') + czDate(departure) +
            '.\nStav rezervace byl změněn na „Pobyt ukončen“.\n\nS pozdravem\nApartmán 17 - Costa Plana'
        });
        meta.notifications.stayEnded.state = 'sent';
        meta.notifications.stayEnded.sentAt = new Date().toISOString();
        addHistory_(meta, 'E-mail o ukončení pobytu odeslán', 'automatizace', { departure: departure });
      } catch (err) {
        meta.notifications.stayEnded.state = 'error';
        meta.notifications.stayEnded.errorAt = new Date().toISOString();
        addHistory_(meta, 'Chyba při odesílání e-mailu o ukončení pobytu', 'automatizace', { message: String(err).slice(0, 200) });
        console.error(err);
      }
      saveReservationMeta_(ev, meta);
    });
  } finally { lock.releaseLock(); }
}
function lifecycleEmailBody_(ev, meta, stage) {
  var from = Utilities.formatDate(ev.getStartTime(), getCal().getTimeZone(), 'yyyy-MM-dd');
  var to = Utilities.formatDate(ev.getEndTime(), getCal().getTimeZone(), 'yyyy-MM-dd');
  var settings = lifecycleSettings_(), paid = totalPaid_(meta), remaining = Math.max(0, meta.pricing.total - paid);
  var greeting = 'Dobrý den,\n\n';
  if (stage === 'deposit') return { subject: 'Záloha k rezervaci – Costa Plana',
    body: greeting + 'vaše rezervace apartmánu Costa Plana je schválena.\n\nPříjezd: ' + czDate(from) +
      '\nOdjezd: ' + czDate(to) + '\nCena ubytování: ' + money(meta.pricing.accommodationAmount) +
      '\nZáloha (50 % ceny ubytování): ' + money(meta.pricing.deposit) +
      '\nK úhradě nyní: ' + money(Math.max(0, Number(meta.pricing.deposit || 0) - paid)) +
      '\nCelková cena rezervace: ' + money(meta.pricing.total) +
      '\n\nPlatbu prosím zašlete na účet: ' + settings.bankAccount +
      (settings.accountName ? ' (' + settings.accountName + ')' : '') +
      '\nVariabilní symbol: ' + meta.reservationNumber +
      '\n\nS pozdravem\nApartmán 17 - Costa Plana' };
  if (stage === 'balance') return { subject: (paid > 0 ? 'Doplatek rezervace – Costa Plana' : 'Platba rezervace – Costa Plana'),
    body: greeting + (paid > 0
      ? 'Blíží se váš pobyt v apartmánu Costa Plana. Prosíme o doplacení zbývající částky.'
      : 'Vzhledem k blížícímu se termínu pobytu prosíme o úhradu celé ceny rezervace.') + '\n\nPříjezd: ' +
      czDate(from) + '\nOdjezd: ' + czDate(to) + '\nCena celkem: ' + money(meta.pricing.total) +
      '\nDosud uhrazeno: ' + money(paid) + '\nZbývá uhradit: ' + money(remaining) +
      '\n\nÚčet: ' + settings.bankAccount + (settings.accountName ? ' (' + settings.accountName + ')' : '') +
      '\nVariabilní symbol: ' + meta.reservationNumber + '\n\nS pozdravem\nApartmán 17 - Costa Plana' };
  if (stage === 'code') return { subject: 'Přístupový kód k apartmánu Costa Plana', body: greeting + 'váš online check-in je dokončen. Přístupový kód: ' + settings.accessCode + '\n\nS pozdravem\nApartmán 17 - Costa Plana' };
  if (stage === 'checkin') return { subject: 'Online check-in před pobytem – Costa Plana',
    body: greeting + 'vaše rezervace je plně uhrazena. Vyplňte prosím online check-in před příjezdem:\n\n' +
      meta.checkin.url + '\n\nPříjezd: ' + czDate(from) + '\nOdjezd: ' + czDate(to) +
      '\n\nPo dokončení vám zašleme přístupový kód k apartmánu.\n\nS pozdravem\nApartmán 17 - Costa Plana' };
  return null;
}
function createPaymentQr_(account, amount, variableSymbol) {
  try {
    var raw = String(account || '').replace(/\s+/g, '').toUpperCase();
    var prefix = '', number = '', bank = '';
    if (/^CZ\d{22}$/.test(raw)) {
      bank = raw.substring(4, 8); prefix = String(Number(raw.substring(8, 14))); number = String(Number(raw.substring(14, 24)));
    } else {
      var m = raw.match(/^(?:(\d+)-)?(\d+)\/(\d{4})$/);
      if (!m) return null;
      prefix = m[1] || ''; number = m[2]; bank = m[3];
    }
    if (prefix === '0') prefix = '';
    if (number === '0' || !number || !bank || !isFinite(amount) || Number(amount) <= 0) return null;
    var params = { accountPrefix: prefix, accountNumber: number, bankCode: bank, amount: Number(amount).toFixed(2), currency: 'CZK', vs: String(variableSymbol || '').replace(/\D/g, '').slice(0, 10), message: 'Rezervace ' + String(variableSymbol || ''), size: '220' };
    var query = Object.keys(params).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var response = UrlFetchApp.fetch('https://api.paylibo.com/paylibo/generator/czech/image?' + query, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200 || !/^image\/png/i.test(response.getHeaders()['Content-Type'] || '')) return null;
    return response.getBlob().setName('qr-platba.png');
  } catch (err) { return null; }
}

function sendLifecycleEmail_(ev, meta, stage, manual, actor) {
  var settings = lifecycleSettings_();
  if (!meta.email) return { ok: false, error: 'email' };
  if (stage === 'code' && (!meta.checkin || !meta.checkin.completedAt || !settings.accessCode)) return { ok: false, error: 'state' };
  if ((stage === 'deposit' || stage === 'balance') && !settings.bankAccount) return { ok: false, error: 'settings' };
  if (stage === 'balance' && Number(meta.pricing.total || 0) - totalPaid_(meta) <= 0) return { ok: false, error: 'state' };
  if (stage === 'deposit' && Number(meta.pricing.deposit || 0) - totalPaid_(meta) <= 0) return { ok: false, error: 'state' };
  if (stage === 'deposit') {
    var stayTz = getCal().getTimeZone();
    var stayArrival = Utilities.formatDate(ev.getStartTime(), stayTz, 'yyyy-MM-dd');
    if (daysUntil_(stayArrival, stayTz) <= 14) return { ok: false, error: 'state' };
  }
  if (stage === 'checkin') {
    if (totalPaid_(meta) < Number(meta.pricing.total || 0) || meta.status === 'Online check-in dokončen')
      return { ok: false, error: 'state' };
    var now = Date.now();
    if (!meta.checkin) meta.checkin = { completedAt: null, guestData: null };
    if (!meta.checkin.tokenHash || !meta.checkin.expiresAt || Number(meta.checkin.expiresAt) <= now) {
      var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
      meta.checkin.tokenHash = digestHex_(token);
      var checkout = ev.getEndTime(), expires = new Date(checkout.getTime() + 86400000);
      meta.checkin.expiresAt = expires.getTime();
      meta.checkin.url = ScriptApp.getService().getUrl() + '?action=checkin&id=' +
        encodeURIComponent(ev.getId()) + '&token=' + encodeURIComponent(token);
    }
  }
  var notice = meta.notifications || (meta.notifications = {});
  if (!manual && notice[stage]) return { ok: false, error: 'already' };
  if (!manual) {
    notice[stage] = { state: 'claimed', attemptAt: new Date().toISOString(), forArrival: Utilities.formatDate(ev.getStartTime(), getCal().getTimeZone(), 'yyyy-MM-dd') };
    addHistory_(meta, 'Odeslání výzvy: ' + stage, actor, { state: 'claimed' });
    saveReservationMeta_(ev, meta);
  } else {
    addHistory_(meta, 'Ruční opakované odeslání: ' + stage, actor, {});
  }
  try {
    var mail = lifecycleEmailBody_(ev, meta, stage);
    if (!mail) return { ok: false, error: 'stage' };
    var qr = (stage === 'deposit' || stage === 'balance') ? createPaymentQr_(settings.bankAccount, stage === 'deposit' ? Math.max(0, Number(meta.pricing.deposit || 0) - totalPaid_(meta)) : Math.max(0, Number(meta.pricing.total || 0) - totalPaid_(meta)), meta.reservationNumber) : null;
    var emailOptions = { to: meta.email, replyTo: OWNER, name: 'Apartmán Costa Plana', subject: mail.subject, body: mail.body };
    if (qr) {
      var signature = '\n\nS pozdravem\nApartmán 17 - Costa Plana';
      var markerAt = mail.body.lastIndexOf(signature);
      var beforeSignature = markerAt >= 0 ? mail.body.slice(0, markerAt) : mail.body;
      var signatureHtml = markerAt >= 0 ? '<br><br>' + esc('S pozdravem\nApartmán 17 - Costa Plana') : '';
      emailOptions.htmlBody = '<div style="font-family:Arial,sans-serif;white-space:pre-line">' + esc(beforeSignature) +
        '<br><br><strong>QR platba</strong><br><img src="cid:paymentQr" alt="QR kód pro platbu" width="220" height="220">' +
        signatureHtml + '</div>';
      emailOptions.inlineImages = { paymentQr: qr };
    }
    MailApp.sendEmail(emailOptions);
    var sentAt = new Date().toISOString();
    if (!manual) { notice[stage].state = 'sent'; notice[stage].sentAt = sentAt; }
    if (stage === 'checkin') meta.checkin.invitedAt = sentAt;
    addHistory_(meta, 'E-mail odeslán: ' + stage, actor, { sentAt: sentAt, manual: !!manual });
    refreshReservationStatus_(meta);
    saveReservationMeta_(ev, meta);
    return { ok: true };
  } catch (err) {
    if (!manual && notice[stage]) { notice[stage].state = 'error'; notice[stage].errorAt = new Date().toISOString(); }
    addHistory_(meta, 'Chyba při odesílání e-mailu: ' + stage, actor, { message: String(err).slice(0, 200) });
    saveReservationMeta_(ev, meta);
    console.error(err);
    return { ok: false, error: 'mail' };
  }
}
function adminRecordPayment_(id, amount, actor) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ev = getCal().getEventById(String(id || '')), meta = ev && readReservationMeta_(ev);
    if (!ev || !meta || !meta.approvedAt || meta.status === 'Zamítnutá' || meta.status === 'Zrušená' || meta.status === 'Pobyt ukončen')
      return { ok: false, error: 'state' };
    var n = validMoney_(amount), remaining = Number(meta.pricing.total) - totalPaid_(meta);
    if (n === null || n <= 0 || n > remaining) return { ok: false, error: 'amount' };
    meta.payments.push({ amount: n, receivedAt: new Date().toISOString(), by: actor });
    addHistory_(meta, 'Přijata platba', actor, { amount: n });
    refreshReservationStatus_(meta); saveReservationMeta_(ev, meta);
    var tz = getCal().getTimeZone();
    var arrival = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
    var days = daysUntil_(arrival, tz);
    if (totalPaid_(meta) >= Number(meta.pricing.total || 0) && days >= 0 && days <= 3 &&
        !(meta.checkin && meta.checkin.completedAt) && !(meta.notifications && meta.notifications.checkin)) {
      var checkinEmail = sendLifecycleEmail_(ev, meta, 'checkin', false, actor);
      if (!checkinEmail.ok) return { ok: true, warning: 'checkinMail' };
    }
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function adminResendEmail_(id, stage, actor) {
  var ev = getCal().getEventById(String(id || '')), meta = ev && readReservationMeta_(ev);
  if (!ev || !meta || ['deposit', 'balance', 'checkin', 'code'].indexOf(String(stage)) < 0 ||
      meta.status === 'Zrušená' || meta.status === 'Zamítnutá' || meta.status === 'Pobyt ukončen') return { ok: false, error: 'state' };
  return sendLifecycleEmail_(ev, meta, String(stage), true, actor);
}
function adminReschedule_(id, fromValue, toValue, actor) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ev = getCal().getEventById(String(id || '')), meta = ev && readReservationMeta_(ev);
    var from = parseDate(fromValue), to = parseDate(toValue);
    if (!ev || !meta || !from || !to || to <= from || (to - from) / 86400000 > MAX_NIGHTS ||
        meta.status === 'Zamítnutá' || meta.status === 'Zrušená' || meta.status === 'Pobyt ukončen') return { ok: false, error: 'dates' };
    var cal = getCal(), conflicts = cal.getEvents(from, to).some(function (other) {
      if (other.getId() === ev.getId()) return false;
      var m = readReservationMeta_(other);
      return !(m && (m.status === 'Zamítnutá' || m.status === 'Zrušená'));
    });
    if (conflicts) return { ok: false, error: 'busy' };
    var tz = cal.getTimeZone(), oldFrom = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd'),
      oldTo = Utilities.formatDate(ev.getEndTime(), tz, 'yyyy-MM-dd'), oldPricing = meta.pricing;
    var stay = calcStay(from, to, Number(meta.adults));
    meta.pricing = { accommodationAmount: stay.accommodation, cleaning: stay.cleaning, localFee: stay.localFee,
      total: stay.total, deposit: Math.round(stay.accommodation * 0.5), nights: stay.nights };
    ev.setAllDayDates(from, to);
    if (meta.checkin && meta.checkin.tokenHash) meta.checkin.expiresAt = ev.getEndTime().getTime() + 86400000;
    refreshReservationStatus_(meta);
    addHistory_(meta, 'Změna termínu a přepočet ceny', actor, {
      from: oldFrom, to: oldTo, newFrom: fromValue, newTo: toValue,
      oldTotal: oldPricing.total, newTotal: meta.pricing.total
    });
    saveReservationMeta_(ev, meta);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function checkinPage_(id, token) {
  var ev = getCal().getEventById(String(id || '')), meta = ev && readReservationMeta_(ev);
  if (!ev || !meta || meta.status !== 'Čeká na online check-in' || meta.checkin.completedAt ||
      !token || digestHex_(String(token)) !== meta.checkin.tokenHash || Number(meta.checkin.expiresAt) <= Date.now())
    return infoPage('Odkaz není platný', 'Odkaz mohl být již použit nebo jeho platnost vypršela. Kontaktujte nás prosím e-mailem.', 'mailto:' + OWNER, 'Napsat e-mail');
  var adults = Number(meta.adults), children = Number(meta.children), guestCount = adults + children;
  if (!isFinite(adults) || Math.floor(adults) !== adults || adults < 1 ||
      !isFinite(children) || Math.floor(children) !== children || children < 0 || guestCount < 1 || guestCount > 4)
    return infoPage('Chybné údaje rezervace', 'Počet hostů v rezervaci nelze ověřit. Kontaktujte nás prosím e-mailem.', 'mailto:' + OWNER, 'Napsat e-mail');
  var tpl = HtmlService.createTemplateFromFile('checkin');
  tpl.reservationId = ev.getId(); tpl.token = String(token); tpl.adults = adults; tpl.children = children; tpl.guestCount = guestCount;
  return tpl.evaluate().setTitle('Online check-in – Costa Plana');
}

function submitOnlineCheckin(id, token, guests) { return completeCheckin_(id, token, guests); }
function completeCheckin_(id, token, guests) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ev = getCal().getEventById(String(id || '')), meta = ev && readReservationMeta_(ev);
    if (!ev || !meta || meta.status !== 'Čeká na online check-in' || meta.checkin.completedAt ||
        !token || digestHex_(String(token)) !== meta.checkin.tokenHash || Number(meta.checkin.expiresAt) <= Date.now())
      return { ok: false, error: 'token' };
    var settings = lifecycleSettings_();
    if (!settings.accessCode) return { ok: false, error: 'settings' };
    var adults = Number(meta.adults), children = Number(meta.children), expected = adults + children;
    if (!isFinite(adults) || Math.floor(adults) !== adults || adults < 1 ||
        !isFinite(children) || Math.floor(children) !== children || children < 0 || expected < 1 || expected > 4 ||
        !Array.isArray(guests) || guests.length !== expected) return { ok: false, error: 'guests' };
    var clean = [];
    for (var i = 0; i < guests.length; i++) {
      var g = guests[i] || {};
      var row = { firstName: String(g.firstName || '').trim().slice(0, 80),
        lastName: String(g.lastName || '').trim().slice(0, 80),
        birthDate: String(g.birthDate || ''), address: String(g.address || '').trim().slice(0, 250),
        documentType: String(g.documentType || '').trim().slice(0, 60),
        documentNumber: String(g.documentNumber || '').trim().slice(0, 80),
        citizenship: String(g.citizenship || '').trim().slice(0, 80),
        category: i < Number(meta.adults) ? 'dospělý' : 'dítě',
        feeAmount: i < Number(meta.adults) && Number(meta.adults) ? Math.round(Number(meta.pricing.localFee || 0) / Number(meta.adults)) : 0,
        feeExemption: i < Number(meta.adults) ? '' : 'osoba mladší 18 let' };
      var isChild = i >= Number(meta.adults);
      var noDocument = !row.documentType && !row.documentNumber;
      var completeDocument = !!row.documentType && !!row.documentNumber;
      if (!row.firstName || !row.lastName || !/^(?:\d{4})-(?:\d{2})-(?:\d{2})$/.test(row.birthDate) ||
          !parseDate(row.birthDate) || !row.address || !row.citizenship ||
          (!isChild && (!row.documentType || !row.documentNumber)))
        return { ok: false, error: 'fields' };
      clean.push(row);
    }
    meta.checkin.guestData = clean; meta.checkin.completedAt = new Date().toISOString();
    meta.checkin.tokenHash = ''; meta.checkin.url = '';
    meta.notifications.code = { state: 'claimed', attemptAt: new Date().toISOString() };
    addHistory_(meta, 'Online check-in dokončen', meta.email, { guests: clean.length });
    refreshReservationStatus_(meta); saveReservationMeta_(ev, meta);
    try {
      MailApp.sendEmail({ to: meta.email, replyTo: OWNER, name: 'Apartmán Costa Plana',
        subject: 'Online check-in dokončen – přístup do apartmánu',
        body: 'Dobrý den,\n\nonline check-in k rezervaci apartmánu Costa Plana je dokončen.\n\n' +
          'Váš přístupový kód k apartmánu: ' + settings.accessCode +
          '\n\nPříjezd: ' + czDate(Utilities.formatDate(ev.getStartTime(), getCal().getTimeZone(), 'yyyy-MM-dd')) +
          '\nOdjezd: ' + czDate(Utilities.formatDate(ev.getEndTime(), getCal().getTimeZone(), 'yyyy-MM-dd')) +
          '\n\nS pozdravem\nApartmán 17 - Costa Plana' });
      meta.notifications.code.state = 'sent'; meta.notifications.code.sentAt = new Date().toISOString();
      addHistory_(meta, 'E-mail s přístupovým kódem odeslán', 'system', {});
      saveReservationMeta_(ev, meta);
      return { ok: true };
    } catch (err) {
      meta.notifications.code.state = 'error'; meta.notifications.code.errorAt = new Date().toISOString();
      addHistory_(meta, 'Chyba při odesílání přístupového kódu', 'system', {});
      saveReservationMeta_(ev, meta);
      return { ok: true, warning: 'email' };
    }
  } finally { lock.releaseLock(); }
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



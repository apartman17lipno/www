// Costa Plana â€“ poptÃ¡vky, dostupnost, ceny a administrace (Google Apps Script)
//
// JedinÃ© nasazenÃ­: Spustit jako: JÃ¡, pÅ™Ã­stup: Kdokoli.
// VEÅ˜EJNÃ‰ vstupy (doGet, pro index.html): obsazenost, ceny, odeslÃ¡nÃ­ poptÃ¡vky.
// ADMINISTRACE (doPost, pro admin.html): pÅ™ihlÃ¡Å¡enÃ­ pÅ™es Google (ID token ovÄ›Å™enÃ½ na serveru),
// serverovÃ¡ relace a vÅ¡echny administrÃ¡torskÃ© operace. VyÅ¾aduje bÄ›hovÃ© prostÅ™edÃ­ V8.

// ================= NastavenÃ­ =================
var OWNER = 'apartman17lipno@gmail.com';
var ADMINS = ['apartman17lipno@gmail.com', 'miloslav.filip@gmail.com', 'mona.viskova@gmail.com'];  // jen tyto ÃºÄty smÄ›jÃ­ do administrace
var NOTIFY = ['apartman17lipno@gmail.com'];                         // kdo dostÃ¡vÃ¡ e-maily o novÃ½ch poptÃ¡vkÃ¡ch
var ADMIN_PAGE = 'https://apartman17lipno.cz/admin.html';
var GOOGLE_CLIENT_ID = '478585801571-svdcuhvao5ft4dpsblvkf36jg2751uqj.apps.googleusercontent.com';  // OAuth Client ID (nenÃ­ tajnÃ½)
var SESSION_TTL_MS = 12 * 3600 * 1000;   // platnost relace: 12 hodin
var MAX_SESSIONS = 25;                   // nejvÃ½Å¡ tolik souÄasnÃ½ch relacÃ­
var DAYS_AHEAD = 540;                    // jak daleko dopÅ™edu se Äte kalendÃ¡Å™
var MAX_NIGHTS = 60;                     // nejdelÅ¡Ã­ povolenÃ½ pobyt

var DEFAULT_PRICES = {   // vÃ½chozÃ­ cenÃ­k; po prvnÃ­m uloÅ¾enÃ­ v administraci platÃ­ uloÅ¾enÃ½
  cleaning: 1000, perPersonNight: 40, defaultPrice: 1400,
  rules: [   // pozdÄ›jÅ¡Ã­ pravidlo pÅ™ebÃ­jÃ­ dÅ™Ã­vÄ›jÅ¡Ã­; datum MM-DD, od > do = pÅ™es konec roku
    { label: 'Leden', from: '01-01', to: '01-31', price: 1400 },
    { label: 'Ãšnor', from: '02-01', to: '02-29', price: 2000 },
    { label: 'BÅ™ezen â€“ kvÄ›ten', from: '03-01', to: '05-31', price: 1400 },
    { label: 'ÄŒerven', from: '06-01', to: '06-30', price: 2000 },
    { label: 'ÄŒervenec â€“ srpen', from: '07-01', to: '08-31', price: 2500 },
    { label: 'ZÃ¡Å™Ã­ â€“ prosinec', from: '09-01', to: '12-31', price: 1400 },
    { label: '21. 12. â€“ 2. 1.', from: '12-21', to: '01-02', price: 2000 }
  ]
};

// ================= VstupnÃ­ body =================
// GET = jen veÅ™ejnÃ© operace. Å½Ã¡dnÃ¡ administrÃ¡torskÃ¡ funkce nenÃ­ pÅ™es GET dosaÅ¾itelnÃ¡.
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.action) return infoPage('Costa Plana', 'Administrace je na adrese ' + ADMIN_PAGE, ADMIN_PAGE, 'OtevÅ™Ã­t administraci');
  var result;
  try {
    switch (p.action) {
      case 'submit': result = handleSubmit(JSON.parse(p.data || '{}')); break;
      case 'prices': result = { ok: true, prices: getPrices() }; break;
      case 'busy':   result = { ok: true, busy: Object.keys(busyNights()).sort() }; break;
      case 'config': result = { ok: true, clientId: GOOGLE_CLIENT_ID }; break;   // Client ID nenÃ­ tajnÃ½
      case 'nonce':  result = newNonce_(); break;
      default:       result = { ok: false, error: 'action' };
    }
  } catch (err) { result = { ok: false, error: 'server' }; }
  return out(result, p.callback);
}

// POST = pÅ™ihlÃ¡Å¡enÃ­, odhlÃ¡Å¡enÃ­ a administrÃ¡torskÃ© operace. Token relace putuje v tÄ›le, ne v URL.
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

// ================= PÅ™ihlÃ¡Å¡enÃ­ pÅ™es Google (ovÄ›Å™enÃ­ ID tokenu na serveru) =================
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
  cache.remove(key);                                  // nonce jde pouÅ¾Ã­t jen jednou
  return true;
}

function login_(credential) {
  if (String(GOOGLE_CLIENT_ID).indexOf('DOPLNTE') === 0) return { ok: false, error: 'config' };
  var res = verifyIdToken_(credential);
  if (!res.ok) return { ok: false, error: res.error };
  var cache = CacheService.getScriptCache(), key = 'lf_' + res.email, fails = Number(cache.get(key) || 0);
  if (fails >= 10) return { ok: false, error: 'limit' };
  if (!isAdminEmail_(res.email)) { cache.put(key, String(fails + 1), 3600); return { ok: false, error: 'forbidden' }; }
  console.log('PÅ™ihlÃ¡Å¡enÃ­ sprÃ¡vce: ' + res.email);
  return { ok: true, email: res.email, session: createSession_(res.email), expires: Date.now() + SESSION_TTL_MS };
}

function isAdminEmail_(email) {
  return ADMINS.map(function (a) { return a.toLowerCase(); }).indexOf(String(email).toLowerCase()) >= 0;
}

// OvÄ›Å™Ã­ podpis (RS256, veÅ™ejnÃ© klÃ­Äe Googlu) a nÃ¡roky ID tokenu. Nic z tokenu se nebere za pravdivÃ© bez ovÄ›Å™enÃ­ podpisu.
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
}function b64urlToBytes_(s) {
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

// ================= ServerovÃ© relace =================
// Do ScriptProperties se uklÃ¡dÃ¡ jen SHA-256 otisk tokenu, takÅ¾e Ãºnik ÃºloÅ¾iÅ¡tÄ› tokeny nevyzradÃ­.
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
  while (live.length >= MAX_SESSIONS) props.deleteProperty(live.shift().k);   // uvolnÃ­ mÃ­sto nejstarÅ¡Ã­m
}
// SpusÅ¥te ruÄnÄ› v editoru: zneplatnÃ­ vÅ¡echny relace (napÅ™. pÅ™i ztrÃ¡tÄ› zaÅ™Ã­zenÃ­)
function revokeAllSessions() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('sess_') === 0) props.deleteProperty(k); });
}
// SpusÅ¥te jednou ruÄnÄ› po vloÅ¾enÃ­ kÃ³du: vyvolÃ¡ Å¾Ã¡dost o povolenÃ­ (kalendÃ¡Å™, e-mail, UrlFetch)
function authorize() {
  getCal(); MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs');
  CacheService.getScriptCache(); PropertiesService.getScriptProperties();
}

// JedinÃ¡ brÃ¡na k administrÃ¡torskÃ½m funkcÃ­m: vÅ¾dy ovÄ›Å™Ã­ relaci na serveru
function adminCall_(d) {
  var email = checkSession_(d.s);
  if (!email) return { ok: false, error: 'auth' };
  var funcs = { adminList: adminList_, adminConfirm: adminConfirm_, adminReject: adminReject_,
                adminDelete: adminDelete_, adminAdd: adminAdd_, adminSavePrices: adminSavePrices_ };
  var name = String(d.fn || '');
  if (!Object.prototype.hasOwnProperty.call(funcs, name)) return { ok: false, error: 'fn' };
  console.log('SprÃ¡vce ' + email + ': ' + name);
  return funcs[name].apply(null, Array.isArray(d.args) ? d.args : []);
}

// ================= KalendÃ¡Å™ =================
function getCal() {
  var cal = CalendarApp.getCalendarById(OWNER);
  if (!cal) throw new Error('KalendÃ¡Å™ ' + OWNER + ' nebyl nalezen.');
  return cal;
}

// ================= PoptÃ¡vka z webu (veÅ™ejnÃ©) =================
function handleSubmit(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (d.web) return { ok: true };                    // ochrana proti robotÅ¯m
    var email = String(d.email || '').slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'email' };
    var from = parseDate(d.from), to = parseDate(d.to);
    if (!from || !to || to <= from || (to - from) / 86400000 > MAX_NIGHTS) return { ok: false, error: 'dates' };
    if (anyBusy(from, to)) return { ok: false, error: 'busy' };

    var guests = String(d.guests || '').slice(0, 50);
    var message = String(d.message || '').slice(0, 2000);
    var extras = [];
    if (d.cot === true) extras.push('dÄ›tskÃ¡ postÃ½lka');
    if (d.chair === true) extras.push('dÄ›tskÃ¡ Å¾idliÄka');
    var extrasText = extras.length ? extras.join(', ') : 'nic';
    var price = money(calcStay(from, to, parseInt(guests, 10) || 1).total);

    var ev = getCal().createAllDayEvent('PoptÃ¡vka: ' + email, from, to, { description:
      'E-mail: ' + email + '\nHostÃ©: ' + guests + '\nPro dÄ›ti: ' + extrasText + '\nCena: ' + price + '\n\n' + message });
    ev.setColor(CalendarApp.EventColor.YELLOW);

    MailApp.sendEmail({
      to: NOTIFY.join(','), replyTo: email, subject: 'PoptÃ¡vka termÃ­nu â€“ Costa Plana',
      body: 'NovÃ¡ poptÃ¡vka z webu.\n\nPÅ™Ã­jezd: ' + czDate(d.from) + '\nOdjezd: ' + czDate(d.to) +
            '\nHostÃ©: ' + guests + '\nPro dÄ›ti: ' + extrasText + '\nCena za pobyt: ' + price +
            '\nE-mail hosta: ' + email + '\n\nZprÃ¡va:\n' + message +
            '\n\nTermÃ­n je v kalendÃ¡Å™i zapsÃ¡n jako pÅ™edbÄ›Å¾nÃ½ (Å¾lutÄ›).' +
            '\n\nPotvrzenÃ­ nebo zamÃ­tnutÃ­ v administraci (nutnÃ© pÅ™ihlÃ¡Å¡enÃ­): ' + ADMIN_PAGE
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

function calcStay(from, to, guests) {
  var prices = getPrices(), tz = getCal().getTimeZone(), sum = 0, nights = 0;
  for (var d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
    sum += nightPrice(Utilities.formatDate(d, tz, 'MM-dd'), prices); nights++;
  }
  return { nights: nights, total: sum + prices.cleaning + prices.perPersonNight * guests * nights };
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

// ================= UdÃ¡losti (internÃ­, volÃ¡no jen z administrace) =================
function eventInfo(ev) {
  var tz = getCal().getTimeZone();
  var d = ev.getDescription() || '', t = ev.getTitle();
  function get(label) { var m = new RegExp('^' + label + ': (.*)$', 'm').exec(d); return m ? m[1] : ''; }
  var type = t.indexOf('PoptÃ¡vka') === 0 ? 'inquiry' : t.indexOf('Rezervace') === 0 ? 'booked' :
             t.indexOf('Blokace') === 0 ? 'block' : 'other';
  return {
    id: ev.getId(), type: type, title: t,
    from: Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd'),
    to: Utilities.formatDate(ev.getEndTime(), tz, 'yyyy-MM-dd'),
    email: get('E-mail'), guests: get('HostÃ©'), kids: get('Pro dÄ›ti'), price: get('Cena'),
    message: d.split('\n\n').slice(1).join('\n\n')
  };
}

function confirmEvent_(ev, sendMail) {
  var i = eventInfo(ev);
  ev.setTitle('Rezervace: ' + (i.email || 'host'));
  ev.setColor(CalendarApp.EventColor.GREEN);
  if (sendMail && i.email) {
    MailApp.sendEmail({ to: i.email, replyTo: OWNER, name: 'ApartmÃ¡n Costa Plana',
      subject: 'PotvrzenÃ­ rezervace â€“ apartmÃ¡n Costa Plana',
      body: 'DobrÃ½ den,\n\nrÃ¡di potvrzujeme rezervaci apartmÃ¡nu Costa Plana (ÄŒernÃ¡ v PoÅ¡umavÃ­, Lipno).\n\n' +
            'PÅ™Ã­jezd: ' + czDate(i.from) + '\nOdjezd: ' + czDate(i.to) + '\nHostÃ©: ' + i.guests +
            (i.price ? '\nCena za pobyt: ' + i.price : '') +
            '\n\nS dotazy nebo upÅ™esnÄ›nÃ­m pÅ™Ã­jezdu odpovÄ›zte prosÃ­m na tento e-mail.\n\nS pozdravem\nApartmÃ¡n Costa Plana' });
  }
}

function rejectEvent_(ev, sendMail) {
  var i = eventInfo(ev);
  if (sendMail && i.email) {
    MailApp.sendEmail({ to: i.email, replyTo: OWNER, name: 'ApartmÃ¡n Costa Plana',
      subject: 'PoptÃ¡vka termÃ­nu â€“ apartmÃ¡n Costa Plana',
      body: 'DobrÃ½ den,\n\ndÄ›kujeme za zÃ¡jem o apartmÃ¡n Costa Plana. BohuÅ¾el vÃ¡m v poÅ¾adovanÃ©m termÃ­nu (' +
            czDate(i.from) + ' â€“ ' + czDate(i.to) + ') nemÅ¯Å¾eme apartmÃ¡n potvrdit.\n\n' +
            'RÃ¡di vÃ¡m navrhneme jinÃ½ termÃ­n, staÄÃ­ odpovÄ›dÄ›t na tento e-mail.\n\nS pozdravem\nApartmÃ¡n Costa Plana' });
  }
  ev.deleteEvent();
}

function findInquiry_(id) {
  var ev = getCal().getEventById(String(id || ''));
  return ev && ev.getTitle().indexOf('PoptÃ¡vka') === 0 ? ev : null;
}

// ================= AdministrÃ¡torskÃ© funkce (dosaÅ¾itelnÃ© jen pÅ™es adminCall_) =================
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
  if (t.indexOf('Blokace') !== 0 && t.indexOf('Rezervace') !== 0 && t.indexOf('PoptÃ¡vka') !== 0) return { ok: false, error: 'notfound' };
  ev.deleteEvent(); return { ok: true };
}

function adminAdd_(o) {
  o = o || {};
  var from = parseDate(o.from), to = parseDate(o.to);
  if (!from || !to || to <= from) return { ok: false, error: 'dates' };
  if (anyBusy(from, to)) return { ok: false, error: 'busy' };
  var booked = o.type === 'booked', note = String(o.note || '').slice(0, 100) || 'ruÄnÄ›';
  var ev = getCal().createAllDayEvent((booked ? 'Rezervace: ' : 'Blokace: ') + note, from, to);
  ev.setColor(booked ? CalendarApp.EventColor.GREEN : CalendarApp.EventColor.GRAY);
  return { ok: true };
}

function adminSavePrices_(p) {
  var clean = validatePrices(p); if (!clean) return { ok: false, error: 'invalid' };
  PropertiesService.getScriptProperties().setProperty('prices', JSON.stringify(clean));
  return { ok: true };
}

// ================= PomocnÃ© =================
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
function money(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' KÄ'; }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

// OdpovÄ›Ä: JSON, nebo (s parametrem callback, jen veÅ™ejnÃ© GET operace) JavaScript volÃ¡nÃ­ funkce
function out(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback && /^[A-Za-z0-9_]+$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}


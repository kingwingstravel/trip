/**
 * Админка King Wings — пульт сайта программ для агентов (kingwingstravel-dmc.com/programs/).
 * Веб-приложение в Google-аккаунте King Wings. Сохраняет изменения прямо в GitHub (kingwingstravel/galeri),
 * сайт пересобирается сам за 2–3 минуты. Claude и программист не нужны.
 *
 * УСТАНОВКА (один раз):
 *  1) script.google.com → Новый проект «Админка King Wings» → файл Code.gs = этот текст;
 *     «+» → HTML → имя Index → вставить Index.html.
 *  2) Развернуть → Новое развертывание → Веб-приложение: «Запуск от имени: я», «Доступ: только я» → Развернуть.
 *     Адрес …/exec — это и есть админка (добавить в закладки / на главный экран телефона).
 *  3) При первом открытии админка попросит ключ GitHub (fine-grained token: репозиторий galeri,
 *     Contents: Read and write, Actions: Read). Вставляет владелец.
 *
 * ВЕРСИЯ 2 (26.11.2026): пульт ВСЕХ сайтов King Wings.
 *  Админка сама находит сайты: в любом репозитории kingwingstravel файл «kw-site.json» (или «<имя>.kw-site.json»)
 *  = паспорт сайта. Новый сайт с паспортом появляется на главной сам — без Claude и без программиста.
 *  Поля паспорта: name, emoji, color, about, url, links[{t,u}], kind (programs | gallery | guides | page),
 *  workflow (имя сборки в GitHub Actions), settings (путь к json настроек), content (папка данных), order, help[].
 *  Открытые репозитории (trip) читаются и без ключа; закрытые (galeri) — по ключу.
 */
var CFG = { OWNER: 'kingwingstravel', REPO: 'galeri', BRANCH: 'main', DIR: 'programs/content',
            SETTINGS: 'programs/settings.json', LIVE: 'https://raw.githubusercontent.com/kingwingstravel/trip/main/live.json',
            SITE: 'https://trip.kingwingstravel-dmc.com/programs/' };
var LANGS = ['en', 'id', 'tr', 'es', 'hi'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('King Wings Admin')
    .setFaviconUrl('https://trip.kingwingstravel-dmc.com/tools/admin/icon-64.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/* ---------- GitHub ---------- */
function token_() { return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN'); }
function gh_(method, path, body, repo) {
  var t = token_();
  if (!t) throw new Error('NO_TOKEN');
  var opt = { method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var r, c;
  for (var k = 0; k < 3; k++) {   // GitHub иногда отвечает 502/503 — пробуем ещё раз
    r = UrlFetchApp.fetch('https://api.github.com/repos/' + CFG.OWNER + '/' + (repo || CFG.REPO) + path, opt);
    c = r.getResponseCode();
    if (c < 500) break;
    Utilities.sleep(700 * (k + 1));
  }
  if ((c === 404 || (c === 403 && repo)) && method === 'get') return null;
  if (c === 401) throw new Error('Ключ GitHub не подходит или истёк — замените его (⚙︎ Ключ).');
  if (c >= 300) throw new Error('GitHub ' + c + ': ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText() || '{}');
}
function getText_(path) {
  var r = gh_('get', '/contents/' + encodeURI(path) + '?ref=' + CFG.BRANCH);
  if (!r) return null;
  var bytes = Utilities.base64Decode(r.content.replace(/\n/g, ''));
  return { sha: r.sha, text: Utilities.newBlob(bytes).getDataAsString('UTF-8') };
}
function putText_(path, text, sha, msg) {
  var body = { message: msg, content: Utilities.base64Encode(text, Utilities.Charset.UTF_8), branch: CFG.BRANCH };
  if (sha) body.sha = sha;
  var r = gh_('put', '/contents/' + encodeURI(path), body);
  return r.content.sha;
}
function who_() { try { return Session.getActiveUser().getEmail() || 'админка'; } catch (e) { return 'админка'; } }

/* ---------- API для страницы ---------- */
function api_hasToken() { return !!token_(); }
function api_setToken(t) {
  t = String(t || '').trim();
  if (!t) throw new Error('Пустой ключ');
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', t);
  try { gh_('get', ''); } catch (e) { PropertiesService.getScriptProperties().deleteProperty('GITHUB_TOKEN'); throw new Error('GitHub не принял ключ: ' + e.message); }
  return true;
}

function api_state() {
  var out = { site: CFG.SITE, programs: [], settings: null, live: null, build: null };
  var s = getText_(CFG.SETTINGS);
  out.settings = s ? { sha: s.sha, data: JSON.parse(s.text) } : { sha: null, data: {} };
  var list = gh_('get', '/contents/' + CFG.DIR + '?ref=' + CFG.BRANCH) || [];
  list.filter(function (f) { return /\.json$/.test(f.name); }).forEach(function (f) {
    var p = getText_(f.path), d = JSON.parse(p.text);
    out.programs.push({ path: f.path, sha: p.sha, slug: d.slug, order: d.order, hidden: !!d.hidden, days: d.days, nights: d.nights,
      countries: d.countries || [], langs: LANGS.filter(function (l) { return d[l]; }),
      title: (d.en || d.id || {}).title || d.slug, orders: LANGS.reduce(function (o, l) { if (d['order_' + l] != null) o[l] = d['order_' + l]; return o; }, {}),
      prices: !!d.prices, season: (d.en || {}).season || '' });
  });
  out.programs.sort(function (a, b) { return a.order - b.order; });
  try { out.live = JSON.parse(UrlFetchApp.fetch(CFG.LIVE, { muteHttpExceptions: true }).getContentText()); } catch (e) {}
  try {
    var runs = gh_('get', '/actions/runs?per_page=5&branch=' + CFG.BRANCH);
    var r = (runs.workflow_runs || []).filter(function (x) { return /program/i.test(x.name); })[0] || (runs.workflow_runs || [])[0];
    if (r) out.build = { status: r.status, result: r.conclusion, at: r.updated_at, url: r.html_url };
  } catch (e) {}
  return out;
}

function api_program(path) {
  var p = getText_(path);
  return { path: path, sha: p.sha, data: JSON.parse(p.text) };
}

function check_(d) {
  var errs = [];
  LANGS.forEach(function (l) {
    if (!d[l]) return;
    if ((d[l].itinerary || []).length !== d.days) errs.push(l.toUpperCase() + ': дней в программе ' + (d[l].itinerary || []).length + ', а должно быть ' + d.days);
    var n = (d[l].stays || []).reduce(function (a, s) { return a + (+s[2] || 0); }, 0);
    if (n !== d.nights) errs.push(l.toUpperCase() + ': ночей в отелях ' + n + ', а должно быть ' + d.nights);
    if (!d[l].title) errs.push(l.toUpperCase() + ': нет названия');
  });
  if (d.prices) Object.keys(d.prices).forEach(function (h) {
    Object.keys(d.prices[h]).forEach(function (m) {
      Object.keys(d.prices[h][m]).forEach(function (g) {
        var v = d.prices[h][m][g];
        if (!(v > 0 && v < 100000)) errs.push('Цена ' + h + '★ ' + m + ' на ' + g + ' гостей: «' + v + '» — нужно число');
      });
    });
  });
  if (!/^[a-z0-9-]+$/.test(d.slug || '')) errs.push('Адрес страницы (slug): только латиница, цифры и «-»');
  return errs;
}

function api_saveProgram(path, sha, data, what) {
  var errs = check_(data);
  if (errs.length) throw new Error(errs.join('\n'));
  try { pricesToSheet_(data); } catch (e) {}   // цены для PIN-агентов — копия в таблицу
  CacheService.getScriptCache().remove('sites2');
  var nsha = putText_(path, JSON.stringify(data, null, 2) + '\n', sha, 'Админка: ' + (what || 'программа') + ' — ' + data.slug + ' (' + who_() + ')');
  return { sha: nsha };
}

function api_saveSettings(sha, data, what) {
  CacheService.getScriptCache().remove('sites2');
  var nsha = putText_(CFG.SETTINGS, JSON.stringify(data, null, 2) + '\n', sha, 'Админка: ' + (what || 'настройки') + ' (' + who_() + ')');
  return { sha: nsha };
}

function api_duplicate(path) {
  var p = api_program(path), d = p.data;
  var list = gh_('get', '/contents/' + CFG.DIR + '?ref=' + CFG.BRANCH) || [];
  var nums = list.map(function (f) { return parseInt(f.name, 10) || 0; });
  var n = Math.max.apply(null, nums.concat([0])) + 1, num = ('0' + n).slice(-2);
  d.slug = d.slug + '-copy-' + num; d.order = n; d.hidden = true;
  LANGS.forEach(function (l) { delete d['order_' + l]; if (d[l]) d[l].title = d[l].title + ' (копия)'; });
  var np = CFG.DIR + '/' + num + '-' + d.slug + '.json';
  putText_(np, JSON.stringify(d, null, 2) + '\n', null, 'Админка: копия программы ' + d.slug + ' (' + who_() + ')');
  return np;
}

/* ================= ПАПКИ ГРУПП НА ДИСКЕ (27.11.2026) ================= */
// Туризм / 1.b2b / <агент> / <год> / <«Confirmed» | «Quotation» | «Drafted»> / [<месяц>] / <группа>
// Номер перед словом не важен («1. Confirmed», «2. Confirmed» — одно и то же).
var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
            янв: 0, фев: 1, мар: 2, апр: 3, мая: 4, май: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11 };
function mon_(s) { var k = String(s || '').toLowerCase().replace(/[^a-zа-я]/g, '').slice(0, 3); return MON[k] != null ? MON[k] : -1; }
function stage_(name) { var n = String(name).toLowerCase(); return /confirm/.test(n) ? 'ok' : /quot/.test(n) ? 'offer' : /draft/.test(n) ? 'new' : ''; }
var SKIP = /^(архив|archive|initial info|personal|whatsapp|from |offer$|\d*\.?\s*(quotation|quoted|confirmed|drafted|completed)\s*$)/i;
// Даты из названия: «02-08 Dec.», «26-Nov.- 6 Dec.», «30 Dec.-6 Jan.», «15-17 Bishkek, 17-20 Almaty» (месяц из папки)
function datesFromName_(name, year, m0) {
  var s = String(name).replace(/^\s*\d{1,2}\.\s+/, ' '), toks = [], re = /\d+|[A-Za-zА-Яа-я]{3,}/g, x;
  while ((x = re.exec(s))) {
    var t = x[0], before = s.slice(0, x.index).replace(/\s+$/, ''), after = s.slice(x.index + t.length);
    if (/^\d+$/.test(t)) {   // число = день, если это не «25+1», «20 Pax», «3 Star», «2025»
      if (t.length > 2 || +t < 1 || +t > 31) continue;
      if (/\+$/.test(before) || /^\s*(\+|pax|star|чел|stan|★|\*|d\d|n\b|ноч|night|day|infant|inf\b|child|twin|dbl|sgl|trp|room|номер|реб|взр)/i.test(after)) continue;
      toks.push({ d: +t });
    } else if (mon_(t) >= 0 && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)/i.test(t)) toks.push({ m: mon_(t) });
  }
  var days = [], cm = null;   // месяц стоит после числа («02-08 Dec») или до него («Nov 26»)
  for (var i = 0; i < toks.length; i++) {
    if (toks[i].d != null) days.push({ d: toks[i].d, m: null });
    else { for (var k = days.length - 1; k >= 0 && days[k].m == null; k--) days[k].m = toks[i].m; cm = toks[i].m; }
  }
  var lastM = -1; for (var q = 0; q < days.length; q++) if (days[q].m != null) lastM = q;
  if (lastM >= 0 && lastM < days.length - 1) days = days.slice(0, lastM + 1);   // «3-6 Nov. 7 Pax (1 Infant)» — после месяца уже не даты
  if (!days.length) return null;
  var a = days[0], b = days[days.length - 1];
  var ma = a.m != null ? a.m : (m0 >= 0 ? m0 : cm), mb = b.m != null ? b.m : ma;
  if (ma == null || ma < 0) return null;
  var A = new Date(year, ma, a.d), B = new Date(year, mb, b.d);
  if (B < A) B = new Date(year, mb + (b.m == null ? 1 : 12), b.d);   // через месяц / Новый год
  return { start: A, end: B };
}
// Все группы из папок b2b (кэш 10 минут). Только текущие и будущие (или без дат, но тронутые за 60 дней).
function scanGroups_(fresh) {
  var c = CacheService.getScriptCache();
  if (!fresh) { var h = c.get('scan1'); if (h) return JSON.parse(h); }
  var out = [], today = new Date(); today.setHours(0, 0, 0, 0);
  var tops = DriveApp.getFoldersByName('1.b2b');
  while (tops.hasNext()) {
    var agents = tops.next().getFolders();
    while (agents.hasNext()) {
      var ag = agents.next(), agent = ag.getName(), years = ag.getFolders();
      if (SKIP.test(agent) || /email|website|whatsapp/i.test(agent)) continue;
      while (years.hasNext()) {
        var yf = years.next(), yr = +yf.getName();
        if (!(yr >= 2025 && yr <= 2035)) continue;
        var sts = yf.getFolders();
        while (sts.hasNext()) {
          var sf = sts.next(), st = stage_(sf.getName());
          if (!st) continue;
          var subs = sf.getFolders();
          while (subs.hasNext()) {
            var mf = subs.next(), m0 = mon_(mf.getName()), groups = [];
            if (m0 >= 0 && mf.getName().replace(/[^A-Za-zА-Яа-я]/g, '').length <= 9) { var gi = mf.getFolders(); while (gi.hasNext()) groups.push(gi.next()); }
            else groups.push(mf);
            groups.forEach(function (gf) {
              var nm = gf.getName();
              if (SKIP.test(nm)) return;
              var dd = datesFromName_(nm, yr, m0), upd = gf.getLastUpdated().getTime();
              var monthEnd = m0 >= 0 ? new Date(yr, m0 + 1, 0) : null;   // дат в названии нет — смотрим месяц папки
              if (dd ? dd.end < today : monthEnd ? monthEnd < today : upd < Date.now() - 60 * 864e5) return;
              out.push({ name: nm, agent: agent, year: yr, stage: st, stageName: sf.getName(), month: m0 >= 0 ? mf.getName() : '',
                start: dd ? dd.start.getTime() : 0, end: dd ? dd.end.getTime() : 0, folder: gf.getUrl(), id: gf.getId() });
            });
          }
        }
      }
    }
  }
  out.sort(function (x, y) { return (x.start || 9e15) - (y.start || 9e15); });
  try { c.put('scan1', JSON.stringify(out), 600); } catch (e) {}
  return out;
}

// группы из таблиц «Путеводитель» (только смотреть): текущие и будущие, только Confirmed
function api_groups() {
  var out = [], today = new Date(); today.setHours(0, 0, 0, 0);
  scanGroups_().filter(function (g) { return g.stage === 'ok'; }).forEach(function (sg) {
    try {
      var gf = DriveApp.getFolderById(sg.id);
      var it = gf.getFilesByType(MimeType.GOOGLE_SHEETS), f = null;
      while (it.hasNext()) { var x = it.next(); if (x.getName().indexOf('Путеводитель') >= 0) { f = x; break; } }
      if (!f) {   // путеводителя ещё нет — группа всё равно видна (даты из названия папки)
        var a0 = sg.start ? new Date(sg.start) : null, b0 = sg.end ? new Date(sg.end) : null;
        out.push({ name: sg.name, agent: sg.agent, dates: '', start: sg.start, end: sg.end, now: !!(a0 && b0 && a0 <= today && today <= b0),
          guests: '', lang: '', publish: false, link: '', pin: '', staff: '', sheet: '', folder: sg.folder, noGuide: true });
        return;
      }
      var v = SpreadsheetApp.openById(f.getId()).getSheetByName('Путеводитель').getRange('A1:B26').getDisplayValues();
      var m = v[6][1].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      var a = m ? new Date(+m[3], +m[2] - 1, +m[1]) : null, b = m ? new Date(+m[6], +m[5] - 1, +m[4]) : null;
      if (b && b < today) return;
      var link = (v[24][1].match(/https:\/\/\S+\/g\/[a-z0-9]{8}\//) || [''])[0], pin = (v[24][1].match(/PIN\s*(\d{6})/) || ['', ''])[1];
      out.push({ name: gf.getName(), agent: sg.agent, dates: m ? m[0] : v[6][1], start: a ? a.getTime() : sg.start, end: b ? b.getTime() : sg.end,
        now: !!(a && b && a <= today && today <= b), guests: v[4][1], lang: v[7][1], publish: v[22][1] === 'TRUE',
        link: link, pin: pin, staff: v[25][1], sheet: f.getUrl(), folder: gf.getUrl() });
    } catch (e) {}
  });
  out.sort(function (x, y) { return x.start - y.start; });
  return out;
}


/* ================= ВЕРСИЯ 2: все сайты ================= */
var REPOS = ['galeri', 'trip'];   // запасной список, если ключ не умеет показывать список репозиториев
function repos_() {
  try {
    var r = UrlFetchApp.fetch('https://api.github.com/user/repos?per_page=100', { muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token_(), Accept: 'application/vnd.github+json' } });
    if (r.getResponseCode() === 200) {
      var names = JSON.parse(r.getContentText()).filter(function (x) { return x.owner && x.owner.login === CFG.OWNER; }).map(function (x) { return x.name; });
      REPOS.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
      return names;
    }
  } catch (e) {}
  return REPOS.slice();
}
// список файлов репозитория: сначала по ключу, для открытых — через jsDelivr (без ключа)
function files_(repo) {
  var t = null;
  try { t = gh_('get', '/git/trees/' + CFG.BRANCH + '?recursive=1', null, repo); } catch (e) {}
  if (t && t.tree) return { via: 'key', list: t.tree.filter(function (x) { return x.type === 'blob'; }).map(function (x) { return x.path; }) };
  try {   // открытый репозиторий: GitHub без ключа (свежие данные), запасной путь — jsDelivr
    var g = UrlFetchApp.fetch('https://api.github.com/repos/' + CFG.OWNER + '/' + repo + '/git/trees/' + CFG.BRANCH + '?recursive=1', { muteHttpExceptions: true, headers: { Accept: 'application/vnd.github+json' } });
    if (g.getResponseCode() === 200) return { via: 'public', list: JSON.parse(g.getContentText()).tree.filter(function (x) { return x.type === 'blob'; }).map(function (x) { return x.path; }) };
  } catch (e) {}
  try {
    var r = UrlFetchApp.fetch('https://data.jsdelivr.com/v1/packages/gh/' + CFG.OWNER + '/' + repo + '@' + CFG.BRANCH + '?structure=flat', { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) return { via: 'public', list: JSON.parse(r.getContentText()).files.map(function (x) { return x.name.replace(/^\//, ''); }) };
  } catch (e) {}
  return { via: 'none', list: [] };
}
function readAny_(repo, path, via) {
  if (via === 'key') { var x = getTextR_(repo, path); return x ? x.text : null; }
  var r = UrlFetchApp.fetch('https://raw.githubusercontent.com/' + CFG.OWNER + '/' + repo + '/' + CFG.BRANCH + '/' + encodeURI(path), { muteHttpExceptions: true });
  return r.getResponseCode() === 200 ? r.getContentText('UTF-8') : null;
}
function getTextR_(repo, path) {
  var r = gh_('get', '/contents/' + encodeURI(path) + '?ref=' + CFG.BRANCH, null, repo);
  if (!r) return null;
  return { sha: r.sha, text: Utilities.newBlob(Utilities.base64Decode(r.content.replace(/\n/g, ''))).getDataAsString('UTF-8') };
}
function builds_(repo) {
  try { var runs = gh_('get', '/actions/runs?per_page=20&branch=' + CFG.BRANCH, null, repo); return (runs && runs.workflow_runs) || []; } catch (e) { return []; }
}
function lastCommit_(repo, dir) {
  try {
    var c = gh_('get', '/commits?per_page=1&sha=' + CFG.BRANCH + (dir ? '&path=' + encodeURIComponent(dir) : ''), null, repo);
    if (c && c[0]) return { at: c[0].commit.committer.date, msg: c[0].commit.message.split('\n')[0] };
  } catch (e) {}
  return null;
}

// Параллельные запросы к GitHub (быстрее в несколько раз). Возвращает тексты ответов или null.
function many_(reqs) {
  if (!reqs.length) return [];
  var t = token_(), list = reqs.map(function (q) {
    var h = { Accept: q.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' };
    if (q.key && t) h.Authorization = 'Bearer ' + t;
    return { url: q.url, headers: h, muteHttpExceptions: true };
  });
  var out = reqs.map(function () { return null; }), todo = list.map(function (x, k) { return k; });
  for (var a = 0; a < 3 && todo.length; a++) {
    var rs = UrlFetchApp.fetchAll(todo.map(function (k) { return list[k]; })), again = [];
    rs.forEach(function (r, n) { var k = todo[n], c = r.getResponseCode(); if (c === 200) out[k] = r.getContentText('UTF-8'); else if (c >= 500) again.push(k); });
    todo = again; if (todo.length) Utilities.sleep(700);
  }
  return out;
}
var API = 'https://api.github.com/repos/';
// Найти все сайты (паспорта kw-site.json). Кэш 30 минут; «обновить» на главной — сразу.
function api_sites(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) { var c = cache.get('sites2'); if (c) return JSON.parse(c); }
  var out = { sites: [], repos: [], live: null, at: new Date().toISOString() }, found = [];
  repos_().forEach(function (repo) {
    var f = files_(repo); out.repos.push({ name: repo, via: f.via, files: f.list.length });
    var runs = f.via === 'key' ? builds_(repo) : [];
    f.list.filter(function (p) { return /(^|\/)([\w-]+\.)?kw-site\.json$/.test(p); }).forEach(function (p) { found.push({ repo: repo, file: p, via: f.via, runs: runs, list: f.list }); });
  });
  // 1) паспорта — все сразу
  var txt = many_(found.map(function (x) {
    return x.via === 'key' ? { url: API + CFG.OWNER + '/' + x.repo + '/contents/' + encodeURI(x.file) + '?ref=' + CFG.BRANCH, key: 1, raw: 1 }
                           : { url: 'https://raw.githubusercontent.com/' + CFG.OWNER + '/' + x.repo + '/' + CFG.BRANCH + '/' + encodeURI(x.file) };
  }));
  // 2) последние изменения и настройки — тоже все сразу
  var extra = [];
  found.forEach(function (x, k) {
    var m; try { m = JSON.parse(txt[k] || ''); } catch (e) { m = { name: x.file.replace(/\.?kw-site\.json$/, '') || x.file, error: txt[k] == null ? 'GitHub не ответил — нажмите «обновить»' : 'в паспорте ошибка: ' + e.message }; }
    m.repo = x.repo; m.file = x.file; m.private = x.via !== 'public';
    m.id = (x.repo + '-' + x.file.replace(/\.?kw-site\.json$/, '').replace(/[^\w]+/g, '-')).replace(/-+$/, '');
    if (m.workflow) { var r = x.runs.filter(function (z) { return new RegExp(m.workflow, 'i').test(z.name); })[0]; if (r) m.build = { status: r.status, result: r.conclusion, at: r.updated_at, url: r.html_url }; }
    var dir = m.content || (x.file.indexOf('/') >= 0 ? x.file.replace(/\/[^\/]*$/, '') : '');
    if (x.via === 'key') {
      m._c = extra.length; extra.push({ url: API + CFG.OWNER + '/' + x.repo + '/commits?per_page=1&sha=' + CFG.BRANCH + (dir ? '&path=' + encodeURIComponent(dir) : ''), key: 1 });
      if (m.settings) { m._s = extra.length; extra.push({ url: API + CFG.OWNER + '/' + x.repo + '/contents/' + encodeURI(m.settings) + '?ref=' + CFG.BRANCH, key: 1, raw: 1 }); }
    }
    var L = x.list;
    if (m.kind === 'gallery' && m.content) m.count = L.filter(function (z) { return z.indexOf(m.content + '/') === 0 && /\/group\.json$/.test(z); }).length;
    if (m.kind === 'programs' && m.content) m.count = L.filter(function (z) { return z.indexOf(m.content + '/') === 0 && /\.json$/.test(z); }).length;
    if (m.kind === 'guides' && m.content) m.count = L.filter(function (z) { return new RegExp('^' + m.content + '/[a-z0-9]{8}/index\\.html$').test(z); }).length;
    out.sites.push(m);
  });
  var ex = many_(extra);
  out.sites.forEach(function (m) {
    if (m._c != null && ex[m._c]) { try { var c = JSON.parse(ex[m._c])[0]; if (c) m.changed = { at: c.commit.committer.date, msg: c.commit.message.split('\n')[0] }; } catch (e) {} }
    if (m._s != null && ex[m._s]) { try { m.settingsData = JSON.parse(ex[m._s]); } catch (e) {} }
    delete m._c; delete m._s;
  });
  out.sites.sort(function (a, b) { return (a.order != null ? a.order : 99) - (b.order != null ? b.order : 99); });
  try { out.live = JSON.parse(UrlFetchApp.fetch(CFG.LIVE, { muteHttpExceptions: true }).getContentText()); } catch (e) {}
  if (!out.sites.some(function (m) { return m.error; })) { try { cache.put('sites2', JSON.stringify(out), 1800); } catch (e) {} }
  return out;
}

// Проверка, что сайт открывается (код ответа), — по кнопке «Проверить»
function api_ping(url) {
  try { var t = Date.now(), r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }); return { code: r.getResponseCode(), ms: Date.now() - t }; }
  catch (e) { return { code: 0, ms: 0, error: String(e.message || e) }; }
}

// Галерея: список групп и «показать / скрыть»
function api_gallery(repo, dir) {
  var list = gh_('get', '/contents/' + dir + '?ref=' + CFG.BRANCH, null, repo) || [], out = [];
  list.filter(function (x) { return x.type === 'dir'; }).forEach(function (d) {
    var g = getTextR_(repo, d.path + '/group.json'); if (!g) return;
    var j = JSON.parse(g.text);
    out.push({ path: d.path + '/group.json', sha: g.sha, slug: j.slug, title: j.title, start: j.date_start, end: j.date_end, pax: j.pax, city: j.city,
      hidden: !!j.hidden, example: !!j.example, photos: (j.photos || []).length, videos: (j.videos || []).length, words: String(j.story || '').split(/\s+/).length });
  });
  out.sort(function (a, b) { return String(b.start).localeCompare(String(a.start)); });
  return out;
}
function api_galleryToggle(repo, path, hidden) {
  var g = getTextR_(repo, path), j = JSON.parse(g.text);
  if (hidden) j.hidden = true; else delete j.hidden;
  putTextR_(repo, path, JSON.stringify(j, null, 2) + '\n', g.sha, 'Админка: галерея — ' + (hidden ? 'скрыть ' : 'показать ') + j.slug + ' (' + who_() + ')');
  CacheService.getScriptCache().remove('sites2');
  return true;
}
function putTextR_(repo, path, text, sha, msg) {
  var body = { message: msg, content: Utilities.base64Encode(text, Utilities.Charset.UTF_8), branch: CFG.BRANCH };
  if (sha) body.sha = sha;
  return gh_('put', '/contents/' + encodeURI(path), body, repo).content.sha;
}
// Настройки любого сайта (простые поля: да/нет, текст, число) — для сайтов вида «page»
function api_siteSettings(repo, path) { var x = getTextR_(repo, path); return x ? { sha: x.sha, data: JSON.parse(x.text) } : null; }
function api_saveSiteSettings(repo, path, sha, data) {
  var r = putTextR_(repo, path, JSON.stringify(data, null, 2) + '\n', sha, 'Админка: настройки ' + path + ' (' + who_() + ')');
  CacheService.getScriptCache().remove('sites2');
  return { sha: r };
}


/* ================= PIN агентов (26.11.2026) ================= */
// Цены на сайте видят только агенты с PIN. PIN и копия цен — в таблице «KW — PIN агентов (цены для сайта Sales)».
var PIN_SHEET = '1ryBFBySbEXoISn6lEFbb-juZ49YoypmWmnuqm1sOd8M';
var PIN_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // без похожих 0/O, 1/I/L
function pinSS_() { return SpreadsheetApp.openById(PIN_SHEET); }
function pricesToSheet_(d) {
  var sh = pinSS_().getSheetByName('Цены'), v = sh.getDataRange().getValues(), row = -1;
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === d.slug) { row = i + 1; break; }
  if (!d.prices) { if (row > 0) sh.deleteRow(row); return; }
  var vals = [[d.slug, (d.en || {}).title || d.slug, new Date(), JSON.stringify(d.prices)]];
  if (row > 0) sh.getRange(row, 1, 1, 4).setValues(vals); else sh.appendRow(vals[0]);
}
function api_pricesSync() {   // все программы → таблица (кнопка в разделе PIN)
  var list = gh_('get', '/contents/' + CFG.DIR + '?ref=' + CFG.BRANCH) || [], n = 0;
  list.filter(function (f) { return /\.json$/.test(f.name); }).forEach(function (f) { var d = JSON.parse(getText_(f.path).text); pricesToSheet_(d); if (d.prices) n++; });
  return n;
}
function api_pins() {
  var ss = pinSS_(), v = ss.getSheetByName('PIN').getDataRange().getValues(), out = [], tz = 'Asia/Almaty';
  var f = function (x) { return x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : String(x || ''); };
  for (var i = 1; i < v.length; i++) if (v[i][0]) out.push({ row: i + 1, pin: String(v[i][0]), agent: String(v[i][1]), country: String(v[i][2]), contact: String(v[i][3]),
    issued: f(v[i][4]), until: f(v[i][5]), on: v[i][6] === true || String(v[i][6]).toUpperCase() === 'TRUE', note: String(v[i][7]),
    count: +v[i][8] || 0, last: v[i][9] instanceof Date ? v[i][9].toISOString() : '' });
  var lg = ss.getSheetByName('Журнал'), n = lg.getLastRow(), log = [];
  if (n > 1) lg.getRange(Math.max(2, n - 39), 1, Math.min(40, n - 1), 6).getValues().reverse().forEach(function (r) {
    log.push({ at: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), pin: String(r[1]), agent: String(r[2]), prog: String(r[3]), lang: String(r[4]), res: String(r[5]) }); });
  var pr = ss.getSheetByName('Цены').getLastRow() - 1;
  return { pins: out, log: log, priced: Math.max(0, pr), sheet: ss.getUrl() };
}
function api_pinAdd(o) {
  o = o || {}; if (!String(o.agent || '').trim()) throw new Error('Впишите название агентства');
  var sh = pinSS_().getSheetByName('PIN'), have = sh.getDataRange().getValues().map(function (r) { return String(r[0]); }), pin;
  do { pin = ''; for (var k = 0; k < 6; k++) pin += PIN_ABC.charAt(Math.floor(Math.random() * PIN_ABC.length)); } while (have.indexOf(pin) >= 0);
  sh.appendRow([pin, String(o.agent).trim(), String(o.country || '').trim(), String(o.contact || '').trim(), new Date(), o.until ? new Date(o.until) : '', true, String(o.note || '').trim(), 0, '']);
  return pin;
}
function api_pinSet(row, field, value) {
  var col = { on: 7, until: 6, note: 8 }[field]; if (!col) throw new Error('bad field');
  var sh = pinSS_().getSheetByName('PIN');
  if (sh.getRange(row, 1).getValue() === '') throw new Error('PIN не найден');
  sh.getRange(row, col).setValue(field === 'until' ? (value ? new Date(value) : '') : value);
  return true;
}


/* ================= БРОНИ (CRM) ================= */
// Лист «Брони» и «История броней» в той же таблице, что PIN. Заявки с сайта попадают туда сами (скрипт «KW Цены по PIN»).
var BK_HEAD = ['ID', 'Создано', 'Статус', 'Агентство', 'PIN', 'Программа', 'Название', 'Гостей', 'Начало', 'Конец',
               'Сумма USD', 'Депозит USD', 'Депозит получен', 'Остаток получен', 'Ответственный', 'Детали', 'Обновлено'];
var BK_ST = { new: 'Новая', offer: 'Предложение отправлено', wait: 'Ждём депозит', ok: 'Confirmed', tour: 'В туре', done: 'Закрыто', lost: 'Отказ' };
function bkSheets_() {
  var ss = pinSS_(), b = ss.getSheetByName('Брони');
  if (!b) { b = ss.insertSheet('Брони'); b.appendRow(BK_HEAD); b.setFrozenRows(1); b.getRange(1, 1, 1, BK_HEAD.length).setFontWeight('bold'); }
  var h = ss.getSheetByName('История броней');
  if (!h) { h = ss.insertSheet('История броней'); h.appendRow(['Когда', 'ID', 'Кто', 'Что']); h.setFrozenRows(1); h.getRange(1, 1, 1, 4).setFontWeight('bold'); }
  return { ss: ss, b: b, h: h };
}
function bkDay_(x) { return x instanceof Date ? Utilities.formatDate(x, 'Asia/Almaty', 'yyyy-MM-dd') : String(x || ''); }
function bkRow_(r, i) {
  var d = {}; try { d = JSON.parse(r[15] || '{}'); } catch (e) {}
  return { row: i + 1, id: String(r[0]), created: r[1] instanceof Date ? r[1].toISOString() : '', st: String(r[2] || 'new'), agent: String(r[3]), pin: String(r[4]),
    slug: String(r[5]), title: String(r[6]), n: +r[7] || 0, start: bkDay_(r[8]), end: bkDay_(r[9]), total: +r[10] || 0, dep: +r[11] || 0,
    depPaid: bkDay_(r[12]), balPaid: bkDay_(r[13]), owner: String(r[14]), d: d, upd: r[16] instanceof Date ? r[16].toISOString() : '' };
}
function bkLog_(h, id, what, who) { h.appendRow([new Date(), id, who || who_(), what]); }
// Группы из папок Confirmed / Quotation / Drafted на Диске → в «Брони». Раз в 30 минут или по кнопке.
// Новая папка → новая строка. Папку перенесли из Quotation в Confirmed → статус поднимается сам (вниз — никогда).
var STAGE_TXT = { ok: 'Confirmed', offer: 'Quotation', 'new': 'Drafted' }, RANK = { 'new': 0, offer: 1, wait: 2, ok: 3, tour: 4, done: 5, lost: 5 };
function paxFromName_(n) { var m = String(n).match(/(\d+)\s*\+\s*(\d+)/); if (m) return +m[1] + +m[2]; m = String(n).match(/(\d+)\s*pax/i); return m ? +m[1] : 0; }
function bkFromDrive_(s, force) {
  var c = CacheService.getScriptCache();
  if (!force && c.get('gsync')) return 0;
  c.put('gsync', '1', 1800);
  var G = scanGroups_(force), v = s.b.getDataRange().getValues(), have = {}, n = 0, tz = 'Asia/Almaty', guides = null, today = new Date(); today.setHours(0, 0, 0, 0);
  for (var i = 1; i < v.length; i++) { try { var d0 = JSON.parse(v[i][15] || '{}'); if (d0.src) have[d0.src] = { row: i + 1, st: String(v[i][2]), id: String(v[i][0]), d: d0 }; } catch (e) {} }
  G.forEach(function (g) {
    var old = have[g.folder];
    if (g.stage === 'ok' && !guides) { guides = {}; try { api_groups().forEach(function (x) { guides[x.folder] = x; }); } catch (e) {} }
    var gd = (guides && guides[g.folder]) || {};
    if (old) {   // уже есть: поднять статус, если папку перенесли дальше
      var ch = false;
      if (RANK[g.stage] > (RANK[old.st] != null ? RANK[old.st] : 0) && ['new', 'offer', 'wait'].indexOf(old.st) >= 0) {
        s.b.getRange(old.row, 3).setValue(g.stage); old.d.stage = g.stage; ch = true;
        bkLog_(s.h, old.id, 'Папку перенесли в «' + g.stageName + '» → ' + STAGE_TXT[g.stage], 'Система');
      }
      var sh0 = old.d.sheet || gd.sheet;   // пустые разделы карточки — из путеводителя группы
      if (sh0) { old.d.sheet = sh0; var what = fromGuide_(old.d, sh0); if (what) { ch = true; n++; bkLog_(s.h, old.id, 'Из путеводителя: ' + what, 'Система'); } }
      if (ch) s.b.getRange(old.row, 16).setValue(JSON.stringify(old.d));
      return;
    }
    var a = g.start ? new Date(g.start) : gd.start ? new Date(gd.start) : null, b = g.end ? new Date(g.end) : gd.end ? new Date(gd.end) : null;
    var st = g.stage === 'ok' && a && b && a <= today && today <= b ? 'tour' : g.stage;
    var id = 'KW-' + Utilities.formatDate(new Date(g.start || Date.now()), tz, 'yyMMdd') + '-' + Math.floor(100 + Math.random() * 900);
    var d = { src: g.folder, stage: g.stage, sheet: gd.sheet || '', link: gd.link || '', gpin: gd.pin || '', staff: gd.staff || '', lang: gd.lang || '',
      guide: {}, transport: {}, hotels: [], meals: [], trip: {}, docs: {}, contact: {}, note: 'Из папки «' + g.stageName + '» на Диске' };
    var what0 = d.sheet ? fromGuide_(d, d.sheet) : '';
    s.b.appendRow([id, new Date(), st, g.agent || 'Агент не указан', '', '', g.name, paxFromName_(g.name) || parseInt(String(gd.guests || '').replace(/\D+/g, ' '), 10) || 0,
      a || '', b || '', 0, 0, '', '', '', JSON.stringify(d), new Date()]);
    bkLog_(s.h, id, 'Добавлена из Диска (папка «' + g.stageName + '», ' + g.year + ')' + (what0 ? '; из путеводителя: ' + what0 : ''), 'Система'); n++;
  });
  return n;
}
function api_bookingsSync() { var s = bkSheets_(); return bkFromDrive_(s, true); }

/* ===== Путеводитель группы → карточка (27.11.2026) =====
   Заполняет ТОЛЬКО пустое: рейсы, гостей, гида, водителя, отели (по колонке «Ночлег»), обеды и ужины (без «?»), программу по дням.
   То, что уже внесено в админке руками, не трогает. */
function gTime_(t) { var m = String(t).match(/\b(\d{1,2}):(\d{2})\b/); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }
function gDate_(t) { var m = String(t).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; }
function gDayType_(title, k, last) {
  var t = String(title).toLowerCase();
  if (k === 0 || k === last || /✈|departure|arrival|airport|home|вылет|прилёт|аэропорт/.test(t)) return 'transfer';
  if (/canyon|lake|kolsa|kaindy|charyn|issyk|mountain|border|turgen|altyn|чарын|кольсай|каинды|граница|горы| — /.test(t)) return 'out';
  return 'city';
}
function fromGuide_(d, url) {
  var id = (String(url).match(/\/d\/([\w-]+)/) || [])[1]; if (!id) return '';
  var sh = SpreadsheetApp.openById(id).getSheetByName('Путеводитель'); if (!sh) return '';
  var v = sh.getRange('A1:L70').getDisplayValues(), B = {}, done = [], hdr = -1;
  v.forEach(function (r, i) { if (r[0] && hdr < 0) B[r[0].trim()] = r[1]; if (r[0] === 'День' && r[1] === 'Дата') hdr = i; });
  var get = function (k) { for (var x in B) if (x.indexOf(k) === 0) return String(B[x] || '').trim(); return ''; };
  var rng = get('Даты').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/), y0 = rng ? +rng[3] : new Date().getFullYear(), m0 = rng ? +rng[2] : 1;
  var iso = function (t) { var m = String(t).match(/(\d{1,2})\.(\d{1,2})/); if (!m) return ''; var y = +m[2] < m0 ? y0 + 1 : y0; return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); };
  var bad = function (t) { t = String(t || '').trim(); return !t || /^\?/.test(t); };
  d.trip = d.trip || {}; d.guide = d.guide || {}; d.transport = d.transport || {};
  // гости
  var pax = parseInt((get('Группа').match(/(\d+)\s*(гост|чел|pax)/i) || [])[1], 10);
  if (!d.trip.adults && pax) { d.trip.adults = pax; done.push('гостей ' + pax); }
  // рейсы
  [['arr', 'Прилёт'], ['dep', 'Вылет']].forEach(function (p) {
    var t = get(p[1]); d.trip[p[0]] = d.trip[p[0]] || {};
    if (t && !d.trip[p[0]].flight) { d.trip[p[0]] = { date: gDate_(t), time: gTime_(t.replace(/\d{1,2}\.\d{1,2}\.\d{4}/, '')), flight: t.slice(0, 300) }; done.push(p[1].toLowerCase()); }
  });
  // гид, водитель
  if (!d.guide.name && !bad(get('Гид'))) { d.guide = { name: get('Гид').slice(0, 200), phone: get('Телефон гида') }; done.push('гид'); }
  if (!d.transport.name && !bad(get('Водитель'))) { d.transport = { name: get('Водитель').slice(0, 200), car: '', phone: '' }; done.push('водитель'); }
  if (hdr < 0) return done.join(', ');
  var days = []; for (var i = hdr + 1; i < v.length; i++) { var r = v[i]; if (!/^\d+$/.test(String(r[0]).trim())) break; days.push(r); }
  var guests = d.trip.adults || pax || '';
  // программа
  if (!(d.days || []).length && days.length) {
    d.days = days.map(function (r, k) { return { date: iso(r[1]), type: gDayType_(r[2], k, days.length - 1), what: String(r[2] || '').trim(), tickets: '' }; });
    done.push('программа ' + days.length + ' дн.');
  }
  // отели: подряд идущие ночи в одном отеле
  if (!(d.hotels || []).length) {
    var H = [];
    days.forEach(function (r) {
      var h = String(r[7] || '').trim(), dt = iso(r[1]); if (!h || bad(h)) return;
      var last = H[H.length - 1];
      if (last && last.full === h && last.out === dt) { last.nights++; last.out = Utilities.formatDate(new Date(new Date(dt + 'T12:00:00').getTime() + 864e5), 'Asia/Almaty', 'yyyy-MM-dd'); return; }
      var parts = h.split(',').map(function (x) { return x.trim(); }), nx = new Date(new Date(dt + 'T12:00:00').getTime() + 864e5);
      H.push({ full: h, city: parts[1] || '', name: parts[0], in: dt, out: Utilities.formatDate(nx, 'Asia/Almaty', 'yyyy-MM-dd'), nights: 1, rooms: '', meal: 'BB', extra: '', contact: '', ok: false });
    });
    if (H.length) { d.hotels = H.map(function (h) { delete h.full; return h; }); done.push('отели ' + H.length); }
  }
  // обеды и ужины (только с названием места, «?» пропускаем)
  if (!(d.meals || []).length) {
    var M = [];
    days.forEach(function (r) {
      [[9, 'lunch'], [10, 'dinner']].forEach(function (c) {
        var t = String(r[c[0]] || '').trim(); if (bad(t)) return;
        var p = t.split('·').map(function (x) { return x.trim(); }), city = (p[0].match(/\(([^)]+)\)/) || [])[1] || '';
        M.push({ date: iso(r[1]), kind: c[1], time: gTime_(t), city: city || (String(r[7] || '').split(',')[1] || '').trim(), place: p[0].replace(/\s*\([^)]*\)/, ''),
          n: guests, staff: 2, budget: 0, note: p.slice(2).join(' · ').slice(0, 300), ok: true });
      });
    });
    if (M.length) { d.meals = M; done.push('питание ' + M.length); }
  }
  return done.join(', ');
}

/* ================= ПУТЕВОДИТЕЛЬ: готовность, публикация, PIN и коды (27.11.2026) =================
   Кнопка «Опубликовать» в карточке группы: ставит галочку B23 в таблице «Путеводитель» и запускает
   сборку ТОЛЬКО этой группы в GitHub (trip → Actions → Guide autopilot, only = id таблицы). Через 2–4 минуты
   в таблице появляются ссылка и PIN (B25), код гида (B26), ссылка гида (C26) — админка их показывает.
   Если ключ GitHub не умеет запускать сборку — галочка всё равно стоит, путеводитель выйдет утром (05:47). */
function guideSheetIn_(folderId) {
  var it = DriveApp.getFolderById(folderId).getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) { var f = it.next(); if (f.getName().indexOf('Путеводитель') >= 0) return f; }
  return null;
}
function guideInfo_(folderUrl) {
  var fid = folderIdFromUrl_(folderUrl); if (!fid) return { none: true, why: 'У группы нет папки на Диске' };
  var f = guideSheetIn_(fid); if (!f) return { none: true, folder: folderUrl };
  var sh = SpreadsheetApp.openById(f.getId()).getSheetByName('Путеводитель'); if (!sh) return { none: true, folder: folderUrl, sheet: f.getUrl(), why: 'В таблице нет листа «Путеводитель»' };
  var v = sh.getRange('A1:L70').getDisplayValues(), B = {}, hdr = -1;
  for (var i = 0; i < 27; i++) if (v[i][0]) B[i + 1] = String(v[i][1] || '').trim();
  for (var j = 0; j < v.length; j++) if (v[j][0] === 'День' && v[j][1] === 'Дата') { hdr = j; break; }
  var days = []; if (hdr >= 0) for (var k = hdr + 1; k < v.length; k++) { if (!/^\d+$/.test(String(v[k][0]).trim())) break; days.push(v[k]); }
  var q = function (t) { return /\?/.test(String(t || '')); }, e = function (t) { return !String(t || '').trim(); };
  // обязательное: без этого путеводитель не соберётся
  var must = [], warn = [];
  if (e(B[5])) must.push('Группа (B5)');
  if (!/\d{1,2}\.\d{1,2}\.\d{4}\s*[–-]\s*\d{1,2}\.\d{1,2}\.\d{4}/.test(B[7] || '')) must.push('Даты (B7) — формат 26.11.2026 – 07.12.2026');
  if (e(B[8])) must.push('Язык путеводителя (B8)');
  if (!days.length) must.push('Дни программы (с 29-й строки)');
  else if (days.some(function (r) { return e(r[1]) || e(r[5]); })) must.push('У каждого дня — дата и план дня (колонки B и F)');
  // желательно: жёлтое и «?»
  [[11, 'Руководитель группы'], [12, 'Прилёт'], [13, 'Вылет'], [14, 'Отель'], [16, 'Гид'], [17, 'Телефон гида'], [19, 'Водитель']].forEach(function (p) {
    if (e(B[p[0]])) warn.push(p[1] + ' — пусто'); else if (q(B[p[0]])) warn.push(p[1] + ' — есть «?»');
  });
  if (/агент/i.test(B[9] || '') && e(B[10])) must.push('Файл логотипа агента (B10)');
  var dq = 0, dn = 0; days.forEach(function (r) { for (var c = 2; c <= 10; c++) if (q(r[c])) dq++; if (e(r[7]) && r !== days[days.length - 1]) dn++; });
  if (dq) warn.push('В днях программы «?»: ' + dq);
  if (dn) warn.push('Дней без ночлега (колонка H): ' + dn);
  var b25 = String(v[24][1] || ''), link = (b25.match(/https:\/\/\S+\/g\/[a-z0-9]{8}\//) || [''])[0], pin = (b25.match(/PIN\s*(\d{6})/) || ['', ''])[1];
  var staff = String(v[25][1] || '').replace(/\D/g, ''), staffLink = (String(v[25][2] || '').match(/https:\/\/\S+/) || [''])[0];
  if (!staffLink && link && pin && staff) staffLink = link + '?p=' + pin + '&s=' + staff;
  var gtext = (b25.split('Текст для группы:')[1] || '').trim();
  if (!gtext && link && pin) gtext = 'Your travel guide: ' + link + '?p=' + pin + '  PIN: ' + pin;
  var log = String(v[23][1] || ''), pubs = log.match(/Опубликовано[^·\n]*/g) || [];
  return { id: f.getId(), sheet: f.getUrl(), folder: folderUrl, publish: String(v[22][1]).toUpperCase() === 'TRUE',
    title: String(v[0][0] || '').replace(/^Путеводитель\s*[—-]\s*/, ''), dates: B[7] || '', lang: B[8] || '',
    must: must, warn: warn, ready: !must.length, days: days.length,
    link: link, pin: pin, tlink: link && pin ? link + '?p=' + pin : '', staff: staff, slink: staffLink, gtext: gtext,
    last: pubs.length ? pubs[pubs.length - 1].trim() : '', run: PropertiesService.getScriptProperties().getProperty('grun_' + f.getId()) || '' };
}
function api_guide(id) {
  var x = api_booking(id), d = x.d || {}, g = guideInfo_(d.src);
  if (!g.none && (g.sheet !== d.sheet || g.link !== (d.link || '') || g.pin !== (d.gpin || '') || g.staff !== (d.staff || ''))) {   // запомнить в карточке
    var s = bkSheets_(), v = s.b.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) {
      var dj = {}; try { dj = JSON.parse(v[i][15] || '{}'); } catch (e) {}
      dj.sheet = g.sheet; dj.link = g.link; dj.gpin = g.pin; dj.staff = g.staff;
      s.b.getRange(i + 1, 16).setValue(JSON.stringify(dj)); break;
    }
  }
  return g;
}
function api_guidePublish(id) {
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var x = api_booking(id), g = guideInfo_((x.d || {}).src);
    if (g.none) throw new Error('У группы ещё нет таблицы «Путеводитель».');
    if (!g.ready) throw new Error('Сначала заполните: ' + g.must.join('; '));
    var sh = SpreadsheetApp.openById(g.id).getSheetByName('Путеводитель'); sh.getRange('B23').setValue(true);
    var now = new Date(), stamp = Utilities.formatDate(now, 'Asia/Almaty', 'dd.MM HH:mm'), started = false, why = '';
    try {
      var t = token_(); if (!t) throw new Error('нет ключа');
      var r = UrlFetchApp.fetch('https://api.github.com/repos/' + CFG.OWNER + '/trip/actions/workflows/guide-autopilot.yml/dispatches', {
        method: 'post', muteHttpExceptions: true, contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        payload: JSON.stringify({ ref: 'main', inputs: { force: true, only: g.id } }) });
      started = r.getResponseCode() === 204;
      if (!started) why = 'GitHub ' + r.getResponseCode();
    } catch (e) { why = String(e.message || e); }
    if (started) PropertiesService.getScriptProperties().setProperty('grun_' + g.id, String(now.getTime()));
    var s = bkSheets_();
    bkLog_(s.h, id, started ? 'Путеводитель: «Опубликовать» — сборка запущена ' + stamp : 'Путеводитель: галочка «Опубликовать» поставлена ' + stamp + ' — выйдет утром (' + why + ')');
    return { started: started, why: why, had: !!g.link };
  } finally { lock.releaseLock(); }
}

/* ================= ЗАЯВКИ ПОСТАВЩИКАМ (27.11.2026) ================= */
// Текст заявки готовит страница (по данным карточки). Здесь — сохранить его файлом Word в папку группы:
// <группа> / Personal / Hotel (отели) · Personal / Restaurant (рестораны) · Personal / Transport & Guides (гид, водитель).
// Файл с тем же именем заменяется (старый — в корзину), чтобы не было двух одинаковых.
function folderIdFromUrl_(u) { var m = String(u || '').match(/folders\/([\w-]+)/) || String(u || '').match(/[?&]id=([\w-]+)/); return m ? m[1] : ''; }
function sub_(parent, name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function api_saveRequest(id, kind, fname, text) {
  var x = api_booking(id), src = folderIdFromUrl_((x.d || {}).src);
  if (!src) throw new Error('У группы нет папки на Диске — скопируйте текст кнопкой «Скопировать».');
  var dir = sub_(sub_(DriveApp.getFolderById(src), 'Personal'), { hotel: 'Hotel', meal: 'Restaurant', team: 'Transport & Guides' }[kind] || 'Restaurant');
  var name = String(fname || 'Заявка').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  var doc = DocumentApp.create(name), blob;
  try {
    var body = doc.getBody();
    body.setMarginLeft(56).setMarginRight(56);
    body.setText(String(text || ' '));
    body.editAsText().setFontFamily('Arial').setFontSize(11);
    doc.saveAndClose();
    blob = UrlFetchApp.fetch('https://docs.google.com/document/d/' + doc.getId() + '/export?format=docx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob().setName(name + '.docx');
  } finally { DriveApp.getFileById(doc.getId()).setTrashed(true); }   // черновик Google Doc не оставляем никогда
  var old = dir.getFilesByName(name + '.docx'); while (old.hasNext()) old.next().setTrashed(true);
  var f = dir.createFile(blob);
  var s = bkSheets_(); bkLog_(s.h, id, 'Заявка сохранена: ' + name + '.docx (Personal / ' + dir.getName() + ')');
  return { url: f.getUrl(), folder: dir.getUrl() };
}

/* ===== Подтверждения отелей из папки группы (27.11.2026, просьба владельца) =====
   <группа>/Personal/Hotel (и подпапки «Directly from hotel», «Modified» …): PDF/фото от отеля с его названием в имени файла
   → отель «подтверждён» сам, в карточке ссылка на файл. Наши заявки («Заявка …») не считаются.
   Если владелец сам снял галочку (okManual = false) — не ставим обратно. Список файлов кэшируется на 10 минут. */
var HOTEL_GENERIC_ = /^(hotel|hotels|residence|residences|resort|spa|plaza|garden|town|lake|lakes|inn|house|guest|the|and|city|grand|apart|apartments|hostel|boutique|отель|гостиница)$/;
function hotelKey_(s) { return String(s || '').toLowerCase().replace(/y/g, 'i').replace(/[^a-zа-яё0-9]+/g, ' '); }
function hotelDocs_(folderUrl) {
  var fid = folderIdFromUrl_(folderUrl); if (!fid) return [];
  var c = CacheService.getScriptCache(), ck = 'hdoc_' + fid, got = c.get(ck); if (got) return JSON.parse(got);
  var out = [];
  try {
    var p = DriveApp.getFolderById(fid).getFoldersByName('Personal');
    if (p.hasNext()) {
      var h = p.next().getFoldersByName('Hotel');
      if (h.hasNext()) (function walk(f, depth) {
        var it = f.getFiles();
        while (it.hasNext()) { var x = it.next(), n = x.getName(); if (!/^заявка/i.test(n)) out.push({ n: n, u: x.getUrl() }); }
        if (depth < 3) { var fs = f.getFolders(); while (fs.hasNext()) walk(fs.next(), depth + 1); }
      })(h.next(), 0);
    }
  } catch (e) {}
  try { c.put(ck, JSON.stringify(out), 600); } catch (e) {}
  return out;
}
function hotelConfirm_(d) {
  if (!d || !d.hotels || !d.hotels.length || !d.src) return;
  var docs = hotelDocs_(d.src); if (!docs.length) return;
  d.hotels.forEach(function (h) {
    var words = hotelKey_(h.name).split(' ').filter(function (w) { return w.length >= 4 && !HOTEL_GENERIC_.test(w); });
    if (!words.length) return;
    var hit = null;
    docs.some(function (f) { var k = ' ' + hotelKey_(f.n) + ' '; if (words.every(function (w) { return k.indexOf(w) >= 0; })) { hit = f; return true; } return false; });
    if (!hit) return;
    h.doc = hit.u; h.docName = hit.n;
    if (!h.ok && h.okManual !== false) { h.ok = true; h.auto = true; }
  });
}
function api_bookings() {
  var s0 = bkSheets_(), added = 0;
  try { added = bkFromDrive_(s0, false); } catch (e) {}
  var s = s0, v = s.b.getDataRange().getValues(), out = [], today = bkDay_(new Date());
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    var x = bkRow_(v[i], i);
    if (x.st === 'ok' && x.start && x.start <= today && (!x.end || today <= x.end)) {   // начался тур → «В туре» сам
      s.b.getRange(i + 1, 3).setValue('tour'); bkLog_(s.h, x.id, 'Confirmed → В туре (тур начался)', 'Система'); x.st = 'tour';
    }
    if (!/^(done|lost)$/.test(x.st)) try { hotelConfirm_(x.d); } catch (e) {}
    out.push(x);
  }
  return { list: out, today: today, added: added, sheet: s.ss.getUrl() + '#gid=' + s.b.getSheetId() };
}
function api_booking(id) {
  var s = bkSheets_(), v = s.b.getDataRange().getValues(), x = null;
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) { x = bkRow_(v[i], i); break; }
  if (!x) throw new Error('Бронь не найдена');
  var hv = s.h.getDataRange().getValues(), hist = [];
  for (var k = hv.length - 1; k > 0; k--) if (String(hv[k][1]) === id) hist.push({ at: hv[k][0] instanceof Date ? hv[k][0].toISOString() : '', who: String(hv[k][2]), what: String(hv[k][3]) });
  x.hist = hist; try { hotelConfirm_(x.d); } catch (e) {} return x;
}
// o: {id?, st, agent, pin, slug, title, n, start, end, total, dep, depPaid, balPaid, owner, d}; what — текст для истории
function api_bookingSave(o, what) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var s = bkSheets_(), v = s.b.getDataRange().getValues(), row = -1, old = null;
    if (o.id) for (var i = 1; i < v.length; i++) if (String(v[i][0]) === o.id) { row = i + 1; old = bkRow_(v[i], i); break; }
    if (o.id && row < 0) throw new Error('Бронь не найдена');
    if (!String(o.agent || '').trim()) throw new Error('Впишите агентство');
    var dt = function (x) { return x ? new Date(x + 'T00:00:00') : ''; };
    var id = o.id || ('KW-' + Utilities.formatDate(new Date(), 'Asia/Almaty', 'yyMMdd') + '-' + Math.floor(100 + Math.random() * 900));
    var st = BK_ST[o.st] ? o.st : 'new';
    var vals = [id, old ? new Date(old.created || Date.now()) : new Date(), st, String(o.agent).trim(), String(o.pin || ''), String(o.slug || ''), String(o.title || ''),
      Math.max(0, +o.n || 0), dt(o.start), dt(o.end), Math.max(0, +o.total || 0), Math.max(0, +o.dep || 0), dt(o.depPaid), dt(o.balPaid), String(o.owner || ''),
      JSON.stringify(o.d || {}), new Date()];
    if (row > 0) s.b.getRange(row, 1, 1, vals.length).setValues([vals]); else s.b.appendRow(vals);
    if (!old) bkLog_(s.h, id, 'Создана вручную');
    else if (old.st !== st) bkLog_(s.h, id, BK_ST[old.st] + ' → ' + BK_ST[st]);
    if (what) bkLog_(s.h, id, what);
    return id;
  } finally { lock.releaseLock(); }
}

/* ================= ЗАЩИТА ================= */
// 1) Все листы таблицы под защитой «с предупреждением»: при ручной правке или удалении Google спросит «Вы уверены?». Админка и сайт пишут без вопросов.
// 2) Каждую ночь копия таблицы в папку «KW Резервные копии» на Диске. Хранятся последние 30 копий.
function api_safety() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('safe') === 'v1') return { ok: true, last: P.getProperty('lastBackup') || '' };
  var ss = pinSS_();
  bkSheets_();
  ss.getSheets().forEach(function (sh) {
    if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
    sh.protect().setDescription('Ведёт админка King Wings. Не удаляйте и не переименовывайте этот лист.').setWarningOnly(true);
  });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backup_') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backup_').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Almaty').create();
  backup_();
  P.setProperty('safe', 'v1');
  return { ok: true, last: P.getProperty('lastBackup') || '' };
}
function backup_() {
  var it = DriveApp.getFoldersByName('KW Резервные копии'), f = it.hasNext() ? it.next() : DriveApp.createFolder('KW Резервные копии');
  var src = DriveApp.getFileById(PIN_SHEET), tz = 'Asia/Almaty';
  src.makeCopy(src.getName() + ' — копия ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), f);
  var files = [], fi = f.getFiles();
  while (fi.hasNext()) files.push(fi.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(30).forEach(function (x) { x.setTrashed(true); });
  PropertiesService.getScriptProperties().setProperty('lastBackup', new Date().toISOString());
  PropertiesService.getScriptProperties().setProperty('backupFolder', f.getUrl());
}
function api_backupInfo() { var P = PropertiesService.getScriptProperties(); return { last: P.getProperty('lastBackup') || '', folder: P.getProperty('backupFolder') || '' }; }

/* ================= ВВОДНЫЕ ДАННЫЕ (27.11.2026) ================= */
// Страница собирает документ (заголовки, абзацы, таблицы) по данным карточки, здесь — Word-файл в <группа>/Personal.
// blocks: [{t:'title'|'h'|'p'|'note'|'table', text, rows:[[...]], red:[[r,c],...]}]; «[[...]]» в тексте = красным (не известно).
function api_saveIntro(id, name, blocks) {
  var x = api_booking(id), src = folderIdFromUrl_((x.d || {}).src);
  if (!src) throw new Error('У группы нет папки на Диске.');
  var dir = sub_(DriveApp.getFolderById(src), 'Personal');
  name = String(name || 'Вводные данные').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  var doc = DocumentApp.create(name), blob;
  try {
    var b = doc.getBody(); b.setMarginLeft(50).setMarginRight(50).setMarginTop(50).setMarginBottom(50);
    var first = true;
    var red = function (el) {   // «[[текст]]» → красный жирный, скобки убрать
      var t = el.editAsText(), s = t.getText(), m, re = /\[\[(.*?)\]\]/g, out = [];
      while ((m = re.exec(s))) out.push([m.index, m[1].length]);
      for (var k = out.length - 1; k >= 0; k--) {
        var a = out[k][0], n = out[k][1];
        t.deleteText(a + n + 2, a + n + 3); t.deleteText(a, a + 1);
        if (n) t.setForegroundColor(a, a + n - 1, '#C00000').setBold(a, a + n - 1, true);
      }
    };
    (blocks || []).forEach(function (bl) {
      if (bl.t === 'table') {
        var tb = b.appendTable(bl.rows.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c) || ' '; }); }));
        tb.setBorderColor('#B8C4D6');
        for (var i = 0; i < tb.getNumRows(); i++) for (var j = 0; j < tb.getRow(i).getNumCells(); j++) {
          var cell = tb.getCell(i, j); cell.setPaddingTop(3).setPaddingBottom(3);
          var tx = cell.editAsText(); tx.setFontFamily('Arial').setFontSize(9.5);
          if (i === 0) { cell.setBackgroundColor('#1F3A5F'); tx.setForegroundColor('#FFFFFF').setBold(true); }
          else if (j === 0) tx.setBold(true);
          red(cell);
        }
        return;
      }
      var p = first ? b.getParagraphs()[0].setText(bl.text || ' ') : b.appendParagraph(bl.text || ' '); first = false;
      var t = p.editAsText(); t.setFontFamily('Arial').setFontSize(10.5).setForegroundColor('#1A1F47').setBold(false).setItalic(false);
      if (bl.t === 'title') { t.setFontSize(16).setBold(true); }
      else if (bl.t === 'h') { t.setFontSize(12.5).setBold(true).setForegroundColor('#1F3A5F'); p.setSpacingBefore(10); }
      else if (bl.t === 'note') { t.setItalic(true).setForegroundColor('#555555'); }
      else if (bl.t === 'bold') { t.setBold(true); }
      else if (bl.t === 'warn') { t.setBold(true).setForegroundColor('#C00000'); }
      red(p);
    });
    doc.saveAndClose();
    blob = UrlFetchApp.fetch('https://docs.google.com/document/d/' + doc.getId() + '/export?format=docx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob().setName(name + '.docx');
  } finally { DriveApp.getFileById(doc.getId()).setTrashed(true); }
  var old = dir.getFilesByName(name + '.docx'); while (old.hasNext()) old.next().setTrashed(true);
  var f = dir.createFile(blob);
  var s = bkSheets_(); bkLog_(s.h, id, 'Вводные данные сохранены: ' + name + '.docx (Personal)');
  return { url: f.getUrl(), folder: dir.getUrl() };
}

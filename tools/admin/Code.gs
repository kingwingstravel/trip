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

// группы из таблиц «Путеводитель» (только смотреть): текущие и будущие
function api_groups() {
  var out = [], today = new Date(); today.setHours(0, 0, 0, 0);
  var tops = DriveApp.getFoldersByName('1. Confirmed');
  while (tops.hasNext()) {
    var top = tops.next(), agent = '';
    try { agent = top.getParents().next().getParents().next().getName(); } catch (e) {}
    var ms = top.getFolders();
    while (ms.hasNext()) {
      var gs = ms.next().getFolders();
      while (gs.hasNext()) {
        var gf = gs.next();
        if (gf.getLastUpdated().getTime() < Date.now() - 200 * 864e5) continue;
        var it = gf.getFilesByType(MimeType.GOOGLE_SHEETS), f = null;
        while (it.hasNext()) { var x = it.next(); if (x.getName().indexOf('Путеводитель') >= 0) { f = x; break; } }
        if (!f) continue;
        try {
          var v = SpreadsheetApp.openById(f.getId()).getSheetByName('Путеводитель').getRange('A1:B26').getDisplayValues();
          var m = v[6][1].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
          var a = m ? new Date(+m[3], +m[2] - 1, +m[1]) : null, b = m ? new Date(+m[6], +m[5] - 1, +m[4]) : null;
          if (b && b < today) continue;
          var link = (v[24][1].match(/https:\/\/\S+\/g\/[a-z0-9]{8}\//) || [''])[0], pin = (v[24][1].match(/PIN\s*(\d{6})/) || ['', ''])[1];
          out.push({ name: gf.getName(), agent: agent, dates: m ? m[0] : v[6][1], start: a ? a.getTime() : 0, end: b ? b.getTime() : 0,
            now: !!(a && b && a <= today && today <= b), guests: v[4][1], lang: v[7][1], publish: v[22][1] === 'TRUE',
            link: link, pin: pin, staff: v[25][1], sheet: f.getUrl(), folder: gf.getUrl() });
        } catch (e) {}
      }
    }
  }
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
function api_bookings() {
  var s = bkSheets_(), v = s.b.getDataRange().getValues(), out = [], today = bkDay_(new Date());
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    var x = bkRow_(v[i], i);
    if (x.st === 'ok' && x.start && x.start <= today && (!x.end || today <= x.end)) {   // начался тур → «В туре» сам
      s.b.getRange(i + 1, 3).setValue('tour'); bkLog_(s.h, x.id, 'Confirmed → В туре (тур начался)', 'Система'); x.st = 'tour';
    }
    out.push(x);
  }
  return { list: out, today: today, sheet: s.ss.getUrl() + '#gid=' + s.b.getSheetId() };
}
function api_booking(id) {
  var s = bkSheets_(), v = s.b.getDataRange().getValues(), x = null;
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) { x = bkRow_(v[i], i); break; }
  if (!x) throw new Error('Бронь не найдена');
  var hv = s.h.getDataRange().getValues(), hist = [];
  for (var k = hv.length - 1; k > 0; k--) if (String(hv[k][1]) === id) hist.push({ at: hv[k][0] instanceof Date ? hv[k][0].toISOString() : '', who: String(hv[k][2]), what: String(hv[k][3]) });
  x.hist = hist; return x;
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

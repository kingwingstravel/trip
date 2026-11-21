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
 */
var CFG = { OWNER: 'kingwingstravel', REPO: 'galeri', BRANCH: 'main', DIR: 'programs/content',
            SETTINGS: 'programs/settings.json', LIVE: 'https://raw.githubusercontent.com/kingwingstravel/trip/main/live.json',
            SITE: 'https://kingwingstravel-dmc.com/programs/' };
var LANGS = ['en', 'id', 'tr', 'es', 'hi'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('King Wings · Админка')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ---------- GitHub ---------- */
function token_() { return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN'); }
function gh_(method, path, body) {
  var t = token_();
  if (!t) throw new Error('NO_TOKEN');
  var opt = { method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + CFG.OWNER + '/' + CFG.REPO + path, opt);
  var c = r.getResponseCode();
  if (c === 404 && method === 'get') return null;
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
  var nsha = putText_(path, JSON.stringify(data, null, 2) + '\n', sha, 'Админка: ' + (what || 'программа') + ' — ' + data.slug + ' (' + who_() + ')');
  return { sha: nsha };
}

function api_saveSettings(sha, data, what) {
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

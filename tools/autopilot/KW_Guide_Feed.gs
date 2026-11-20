/**
 * King Wings — автопилот путеводителей (запасной путь, без Claude и без программиста).
 * Живёт в Google-аккаунте King Wings. Ничего не публикует сам: только отдаёт данные таблиц
 * «Путеводитель» роботу GitHub (kingwingstravel/trip → Actions → Guide autopilot) по секретному ключу,
 * переводит тексты (Google Переводчик) и записывает ссылку/PIN обратно в B24–B26.
 *
 * УСТАНОВКА (один раз, 5 минут) — см. ИНСТРУКЦИЯ.md в репозитории trip, раздел «Автопилот».
 *   1) script.google.com → Новый проект → вставить этот файл → Сохранить.
 *   2) Выбрать функцию setup → Выполнить → разрешить доступ. В журнале появится КЛЮЧ.
 *   3) Развернуть → Новое развертывание → Веб-приложение: «Запуск от имени: я», «Доступ: все» → Развернуть. Скопировать адрес …/exec.
 *   4) GitHub → kingwingstravel/trip → Settings → Secrets and variables → Actions → New repository secret:
 *      имя GUIDE_FEED, значение: <адрес …/exec>?k=<КЛЮЧ>
 * Без ключа веб-приложение ничего не отдаёт.
 */
var TOKEN_KEY = 'FEED_TOKEN';
var MAX_AGE_DAYS = 300;          // таблицы, которые не менялись дольше, не читаем (старые группы)
var ALLOWED_CELLS = ['B24', 'B25', 'B26'];

function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty(TOKEN_KEY)) p.setProperty(TOKEN_KEY, Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  Logger.log('КЛЮЧ: ' + p.getProperty(TOKEN_KEY));
  Logger.log('Групп найдено: ' + feed_().groups.length);
}

function ok_(k) {
  var t = PropertiesService.getScriptProperties().getProperty(TOKEN_KEY);
  return !!t && k === t;
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var q = (e && e.parameter) || {};
  if (!ok_(q.k)) return out_({ error: 'denied' });
  if (q.op === 'feed') return out_(feed_());
  return out_({ ok: true, now: new Date().toISOString() });
}

function doPost(e) {
  var b = {};
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'bad json' }); }
  if (!ok_(b.k)) return out_({ error: 'denied' });
  if (b.op === 'tr') return out_({ t: translate_(b.texts || [], b.to || 'en') });
  if (b.op === 'write') return out_(write_(b));
  return out_({ error: 'unknown op' });
}

// значения как у Sheets API: отображаемый текст, без пустых хвостов строк и пустых строк в конце
function trim_(v) {
  var rows = v.map(function (r) {
    var n = r.length;
    while (n > 0 && r[n - 1] === '') n--;
    return r.slice(0, n);
  });
  var m = rows.length;
  while (m > 0 && rows[m - 1].length === 0) m--;
  return rows.slice(0, m);
}

function feed_() {
  var res = { now: new Date().toISOString(), groups: [] };
  var cut = Date.now() - MAX_AGE_DAYS * 864e5;
  var tops = DriveApp.getFoldersByName('1. Confirmed');
  var seen = {};
  while (tops.hasNext()) {
    var top = tops.next();
    var months = top.getFolders();
    while (months.hasNext()) {
      var month = months.next();
      var groups = month.getFolders();
      while (groups.hasNext()) {
        var gf = groups.next();
        var files = gf.getFilesByType(MimeType.GOOGLE_SHEETS);
        while (files.hasNext()) {
          var f = files.next();
          var name = f.getName();
          if (name.indexOf('Путеводитель') < 0 || name.indexOf('Шаблон') >= 0) continue;
          if (seen[f.getId()] || f.getLastUpdated().getTime() < cut) continue;
          seen[f.getId()] = 1;
          try { res.groups.push(readGroup_(f, gf.getName())); }
          catch (x) { res.groups.push({ id: f.getId(), name: name, error: String(x) }); }
        }
      }
    }
  }
  return res;
}

function readGroup_(f, folderName) {
  var ss = SpreadsheetApp.openById(f.getId());
  var sh = ss.getSheetByName('Путеводитель');
  if (!sh) return { id: f.getId(), name: f.getName(), error: 'нет листа Путеводитель' };
  var g = trim_(sh.getRange('A1:T80').getDisplayValues());
  var ts = ss.getSheetByName('Туристы');
  var t = ts ? trim_(ts.getRange('A1:K60').getDisplayValues()) : [];
  var o = { id: f.getId(), name: f.getName(), folder: folderName, g: g, t: t };
  // логотип агентства по ссылке Google Диска из B10
  var mode = (g[8] && g[8][1]) || '', link = (g[9] && g[9][1]) || '';
  if (/агент|Два/i.test(mode) && link) {
    o.logos = [];
    var ids = link.match(/[-\w]{25,}/g) || [];
    ids.slice(0, 2).forEach(function (id) {
      try {
        var blob = DriveApp.getFileById(id).getBlob();
        if (blob.getBytes().length < 1500000) o.logos.push({ mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) });
      } catch (x) {}
    });
  }
  return o;
}

// перевод с английского; {go} {n} {t} {d} {a} не переводятся
function translate_(texts, to) {
  var cache = CacheService.getScriptCache();
  return texts.map(function (s) {
    s = String(s || '');
    if (!s.trim() || to === 'en') return s;
    var key = 'tr_' + to + '_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
    var c = cache.get(key);
    if (c !== null) return c;
    var ph = [], i = 0;
    var src = s.replace(/\{[a-z]+\}/g, function (m) { ph.push(m); return '[[' + (i++) + ']]'; });
    var r;
    try { r = LanguageApp.translate(src, 'en', to); } catch (x) { return s; }
    r = r.replace(/\[\[\s*(\d+)\s*\]\]/g, function (m, n) { return ph[+n] || m; });
    if (r.length < 90000) cache.put(key, r, 21600);
    return r;
  });
}

// только B24 (дописать), B25, B26 (записать, если пусто) листа «Путеводитель»
function write_(b) {
  var ss = SpreadsheetApp.openById(b.id);
  var sh = ss.getSheetByName('Путеводитель');
  var done = [];
  Object.keys(b.set || {}).forEach(function (a) {
    if (ALLOWED_CELLS.indexOf(a) < 0 || a === 'B24') return;
    var r = sh.getRange(a);
    if (String(r.getDisplayValue()).trim() === '') { r.setNumberFormat('@').setValue(String(b.set[a])); done.push(a); }
  });
  if (b.append && b.append.B24) {
    var r24 = sh.getRange('B24');
    r24.setValue(String(r24.getValue() || '') + String(b.append.B24));
    done.push('B24');
  }
  if (b.photo && b.photo.code) done.push(photoReg_(b.photo));
  return { ok: true, done: done };
}

// реестр фото для бота (лист «Фото путеводителя» таблицы «Взаиморасчёты King Wings»): A код, B sha(код:PIN), C sha(код:код гида), D папка (ставит бот), E название
var SETTLE_ID = '191QH1XH3BdrkKna5FY_Ncma_eBbtmExTbqm5_OV8fe4';
function photoReg_(p) {
  try {
    var sh = SpreadsheetApp.openById(SETTLE_ID).getSheetByName('Фото путеводителя');
    if (!sh) return 'photo: нет листа';
    var v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 5).getDisplayValues();
    for (var i = 0; i < v.length; i++) {
      if (v[i][0] === p.code) {
        if (!v[i][2] && p.c) sh.getRange(i + 1, 3).setValue(p.c);
        return 'photo: есть';
      }
    }
    sh.appendRow([p.code, p.b || '', p.c || '', '', p.e || '']);
    return 'photo: добавлено';
  } catch (x) { return 'photo: ' + x; }
}

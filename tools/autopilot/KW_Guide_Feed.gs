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
  if (b.op === 'filllist') return out_({ list: fillList_() });
  if (b.op === 'fill') { try { return out_({ ok: fillOne_(b.folder, b.partner || '') }); } catch (x) { return out_({ error: String(x) }); } }
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

/* =====================================================================================
 * АВТОЗАПОЛНЕНИЕ ТАБЛИЦ ПУТЕВОДИТЕЛЯ (Gemini) — решение владельца 20.11.2026:
 * если Claude не работает, таблицу «Путеводитель» заполняет сам скрипт из файлов партнёра в папке группы.
 * Ключ Gemini — свойство скрипта GEMINI_KEY (Настройки проекта → Свойства скрипта).
 * Правила: только пустые клетки и клетки с «?» (ничего, что вписал человек или Claude, не трогаем);
 * без цен, без паспортов; всё заполненное — в B24 «🟡 Заполнил автопилот … — проверьте».
 * Галочку «Опубликовать» (B23) скрипт НЕ ставит — это решает владелец.
 * ===================================================================================== */
var TEMPLATE_ID = '1Y9k964UtNJy3zHszDJ2bjpOH7LIemwdB_Lkj7JGxHWA';   // «ШАБЛОН путеводителя (не заполнять)»
var GEMINI_MODEL = 'gemini-flash-latest';
var SKIP_FOLDERS = /^(Quotation|Initial Info|Hotel|WhatsApp|Фото|Photos?)$/i;
var LANG_NAME = { id: 'Bahasa', en: '', ru: 'Русский', ms: 'Melayu', ko: '한국어', tr: 'Türkçe', ar: 'العربية', es: 'Español', hi: 'हिन्दी' };

// список групп, которым нужно автозаполнение (новые файлы партнёра после прошлого заполнения или нет таблицы)
function fillList_() {
  var out = [], props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GEMINI_KEY')) return out;   // без ключа Gemini автозаполнение выключено — ничего не создаём
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var tops = DriveApp.getFoldersByName('1. Confirmed');
  while (tops.hasNext()) {
    var top = tops.next(), partner = '';
    try { var y = top.getParents().next(); partner = y.getParents().next().getName(); } catch (x) {}
    var months = top.getFolders();
    while (months.hasNext()) {
      var groups = months.next().getFolders();
      while (groups.hasNext()) {
        var gf = groups.next();
        if (gf.getLastUpdated().getTime() < Date.now() - 200 * 864e5) continue;
        var src = sources_(gf, 0, []);
        if (!src.length) continue;
        var sig = src.map(function (f) { return f.getId() + ':' + f.getLastUpdated().getTime(); }).sort().join('|');
        var key = 'fill_' + gf.getId();
        if (props.getProperty(key) === Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig))) continue;
        var sheet = guideSheet_(gf);
        if (sheet) {   // тур уже закончился — не трогаем
          var end = endDate_(sheet);
          if (end && end < today) continue;
        }
        out.push({ folder: gf.getId(), name: gf.getName(), partner: partner });
      }
    }
  }
  return out;
}

function sources_(folder, depth, acc) {
  var fs = folder.getFiles();
  while (fs.hasNext()) {
    var f = fs.next(), n = f.getName(), mt = f.getMimeType();
    if (/Путеводитель|KW_Restorany|Quotation|Quote|Budget|Calculator|Калькулятор|Passport|Паспорт/i.test(n)) continue;
    if (mt === MimeType.GOOGLE_DOCS || mt === MimeType.PDF || mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mt === MimeType.MICROSOFT_WORD) acc.push(f);
  }
  if (depth < 2) {
    var ds = folder.getFolders();
    while (ds.hasNext()) {
      var d = ds.next(), dn = d.getName();
      if (SKIP_FOLDERS.test(dn)) continue;
      if (/^Personal$/i.test(dn)) {   // из Personal — только «Вводные данные»
        var pf = d.getFiles();
        while (pf.hasNext()) { var x = pf.next(); if (/Вводные данные/i.test(x.getName()) && x.getMimeType() !== MimeType.GOOGLE_SHEETS) acc.push(x); }
        continue;
      }
      sources_(d, depth + 1, acc);
    }
  }
  return acc;
}

function guideSheet_(gf) {
  var it = gf.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) { var f = it.next(); if (f.getName().indexOf('Путеводитель') >= 0) return f; }
  return null;
}
function endDate_(file) {
  try {
    var v = SpreadsheetApp.openById(file.getId()).getSheetByName('Путеводитель').getRange('B7').getDisplayValue();
    var m = v.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    return m ? new Date(+m[6], +m[5] - 1, +m[4]) : null;
  } catch (x) { return null; }
}

// текст файла для Gemini: Google Doc / Word → текст, PDF → как есть (Gemini читает PDF сам)
function part_(f) {
  var mt = f.getMimeType();
  if (mt === MimeType.PDF) return { inline_data: { mime_type: 'application/pdf', data: Utilities.base64Encode(f.getBlob().getBytes()) } };
  var id = f.getId(), tmp = null;
  if (mt !== MimeType.GOOGLE_DOCS) {
    var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/copy?supportsAllDrives=true', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ name: 'tmp-autofill', mimeType: MimeType.GOOGLE_DOCS })
    });
    tmp = JSON.parse(r.getContentText()).id; id = tmp;
  }
  var t = '';
  try { t = DocumentApp.openById(id).getBody().getText(); } finally { if (tmp) DriveApp.getFileById(tmp).setTrashed(true); }
  return { text: '=== FILE: ' + f.getName() + ' (' + f.getLastUpdated().toISOString().slice(0, 10) + ') ===\n' + t.slice(0, 60000) };
}

var SCHEMA = {
  type: 'OBJECT', properties: {
    group: { type: 'STRING' }, guests: { type: 'STRING' }, date_from: { type: 'STRING' }, date_to: { type: 'STRING' },
    language: { type: 'STRING' }, leader: { type: 'STRING' }, arrival: { type: 'STRING' }, departure: { type: 'STRING' },
    hotels: { type: 'STRING' }, booking: { type: 'STRING' }, guide: { type: 'STRING' }, driver: { type: 'STRING' },
    days: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      date: { type: 'STRING' }, title: { type: 'STRING' }, meet_time: { type: 'STRING' }, meet_place: { type: 'STRING' },
      plan: { type: 'STRING' }, important: { type: 'STRING' }, night: { type: 'STRING' }, lunch: { type: 'STRING' }, dinner: { type: 'STRING' }, other_meal: { type: 'STRING' },
      title_l: { type: 'STRING' }, meet_place_l: { type: 'STRING' }, plan_l: { type: 'STRING' }, important_l: { type: 'STRING' },
      night_l: { type: 'STRING' }, lunch_l: { type: 'STRING' }, dinner_l: { type: 'STRING' }, other_meal_l: { type: 'STRING' } },
      required: ['date', 'title', 'plan', 'night'] } },
    tourists: { type: 'ARRAY', items: { type: 'STRING' } }
  }, required: ['date_from', 'date_to', 'days']
};

function gemini_(parts, lang) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!key) throw new Error('нет GEMINI_KEY в свойствах скрипта');
  var prompt = [
    'You prepare a day-by-day TRAVEL GUIDE for tourists of a group tour in Central Asia (King Wings Travel, Almaty), from the tour operator files below.',
    'Return JSON only. Rules:',
    '- Dates: date_from / date_to as dd.mm.yyyy; days[].date as dd.mm. One item per calendar day of the tour, in order, first day = arrival day.',
    '- English texts: title (short day name, e.g. "Almaty city tour" or "Almaty ✈ Tashkent"), meet_place, important (1-3 short practical tips), night ("Hotel name, City, Country"; "—" for a night flight/no hotel; unknown hotel → "Hotel ?, City, Country").',
    '- plan: lines "HH:MM — text" or "HH:MM–HH:MM — text", one per line, times exactly as in the files. Flights: airline, flight number, route, arrival time. Arrival at the airport 3 hours before international flights.',
    '- meet_time: first meeting time of the day "HH:MM". lunch/dinner/other_meal: "HH:MM–HH:MM · lunch" style, only if in the files; breakfast at hotel is not written.',
    '- *_l fields: the same texts translated into ' + (lang || 'the tourists\' language') + ' (leave empty if that language is English).',
    '- language: tourists\' language name in English (e.g. "Bahasa Indonesia", "English", "Malay", "Russian"); guests: e.g. "12 guests (6 twin), Indonesia".',
    '- tourists: full names only, as written in the files.',
    '- NEVER write prices, costs, net rates, margins, passport numbers, dates of birth, supplier phone numbers. If a fact is unknown write "?" — never invent.'
  ].join('\n');
  var body = { contents: [{ role: 'user', parts: [{ text: prompt }].concat(parts) }],
               generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.1 } };
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(key);
  for (var a = 0; a < 3; a++) {
    var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      var j = JSON.parse(r.getContentText());
      return JSON.parse(j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join(''));
    }
    if (r.getResponseCode() !== 429 && r.getResponseCode() < 500) throw new Error('Gemini ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
    Utilities.sleep(5000 * (a + 1));
  }
  throw new Error('Gemini не ответил');
}

function clean_(s) {
  s = String(s || '');
  s = s.replace(/\b[A-Z]{1,2}\d{6,8}\b/g, '');                                  // похоже на паспорт
  s = s.replace(/(\d[\d\s.,]*\s?(USD|EUR|KZT|UZS|KGS|тг|тенге|сум|\$))|(\$\s?\d[\d.,]*)/gi, '');  // цены
  return s.trim();
}

// заполнить одну группу. testFolderId — куда положить таблицу при проверке (иначе — в папку группы)
function fillOne_(folderId, partner, testFolderId) {
  if (!PropertiesService.getScriptProperties().getProperty('GEMINI_KEY')) throw new Error('нет GEMINI_KEY — автозаполнение выключено');
  var gf = DriveApp.getFolderById(folderId);
  var src = sources_(gf, 0, []);
  if (!src.length) return 'нет файлов';
  src.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
  var file = testFolderId ? null : guideSheet_(gf);
  var created = false;
  if (!file) {
    file = DriveApp.getFileById(TEMPLATE_ID).makeCopy('🟡 Путеводитель — ' + gf.getName(), testFolderId ? DriveApp.getFolderById(testFolderId) : gf);
    created = true;
  }
  var ss = SpreadsheetApp.openById(file.getId()), sh = ss.getSheetByName('Путеводитель');
  var langName = sh.getRange('B8').getDisplayValue();
  var parts = src.slice(0, 4).map(part_);
  var d = gemini_(parts, langName);
  var lang = langName || d.language || '';
  var lk = /indonesia/i.test(lang) ? 'Bahasa' : /english/i.test(lang) ? '' : lang;
  var did = [];
  function put(a1, v) {
    v = clean_(v); if (!v) return;
    var r = sh.getRange(a1), cur = String(r.getDisplayValue()).trim();
    if (cur === '' || cur === '?' || (/\?/.test(cur) && cur.length < 40)) { r.setValue(v); did.push(a1); }
  }
  if (created) sh.getRange('A1').setValue('Путеводитель — ' + (d.group || gf.getName()) + ', ' + d.date_from + ' – ' + d.date_to);
  put('B5', d.guests); put('B6', partner); put('B7', d.date_from + ' – ' + d.date_to); put('B8', lang);
  if (created) put('B9', 'King Wings');
  put('B11', d.leader); put('B12', d.arrival); put('B13', d.departure); put('B14', d.hotels); put('B15', d.booking);
  put('B16', d.guide); put('B19', d.driver);
  // дни: строка «День», дальше по строкам
  var colA = sh.getRange('A1:A80').getDisplayValues(), hdr = 0;
  for (var i = 0; i < colA.length; i++) if (colA[i][0] === 'День') { hdr = i + 1; break; }
  if (!hdr) throw new Error('нет строки «День»');
  if (lk) {
    var h = sh.getRange(hdr, 13, 1, 8);
    if (!String(h.getCell(1, 1).getDisplayValue())) h.setValues([['Название дня (' + lk + ')', 'Место встречи (' + lk + ')', 'План дня (' + lk + ')', 'Важно сегодня (' + lk + ')', 'Ночлег (' + lk + ')', 'Обед (' + lk + ')', 'Ужин (' + lk + ')', 'Другое питание (' + lk + ')']]);
  }
  var wd = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'], y = +(String(d.date_from).match(/\d{4}/) || [new Date().getFullYear()])[0];
  (d.days || []).forEach(function (x, k) {
    var row = hdr + 1 + k, m = String(x.date || '').match(/(\d{1,2})\.(\d{1,2})/), dd = '';
    if (m) { var dt = new Date(y, +m[2] - 1, +m[1]); dd = ('0' + m[1]).slice(-2) + '.' + ('0' + m[2]).slice(-2) + ' ' + wd[dt.getDay()]; }
    var cols = { A: String(k + 1), B: dd, C: x.title, D: x.meet_time, E: x.meet_place, F: x.plan, G: x.important, H: x.night, J: x.lunch, K: x.dinner, L: x.other_meal };
    if (lk) { cols.M = x.title_l; cols.N = x.meet_place_l; cols.O = x.plan_l; cols.P = x.important_l; cols.Q = x.night_l; cols.R = x.lunch_l; cols.S = x.dinner_l; cols.T = x.other_meal_l; }
    Object.keys(cols).forEach(function (c) { put(c + row, cols[c]); });
  });
  // туристы — только имена, только если листа ещё нет
  if (d.tourists && d.tourists.length && !ss.getSheetByName('Туристы')) {
    var ts = ss.insertSheet('Туристы');
    ts.getRange('A1').setValue('Туристы — личная часть путеводителя (каждый один раз нажимает своё имя)');
    ts.getRange('A2').setValue('Имена заполнил автопилот из файлов группы — проверьте. Комнаты, билеты, сообщения — по мере появления. НЕ писать: номер паспорта, дату рождения.');
    ts.getRange('A4:K4').setValues([['№', 'Имя (латиницей, как в списке группы)', 'Комната', '', '', '', '', '', 'Билеты (дата · рейс · место · бронь)', 'Личное сообщение (EN)', 'Личное сообщение (' + (lk || 'EN') + ')']]);
    ts.getRange(5, 1, d.tourists.length, 2).setValues(d.tourists.map(function (n, i) { return [String(i + 1), clean_(n)]; }));
    did.push('Туристы');
  }
  var note = '🟡 Заполнил автопилот (Gemini) ' + Utilities.formatDate(new Date(), 'Asia/Almaty', 'dd.MM HH:mm') + ' из файлов: ' +
    src.slice(0, 4).map(function (f) { return '«' + f.getName() + '»'; }).join(', ') + '. Клеток: ' + did.length + '. Проверьте всё, «?» замените; потом галочка «Опубликовать».';
  var b24 = sh.getRange('B24'); b24.setValue((String(b24.getValue() || '') ? b24.getValue() + '\n' : '') + note);
  if (!testFolderId) {
    var sig = src.map(function (f) { return f.getId() + ':' + f.getLastUpdated().getTime(); }).sort().join('|');
    PropertiesService.getScriptProperties().setProperty('fill_' + folderId, Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig)));
  }
  return (created ? 'создана таблица, ' : '') + 'заполнено клеток: ' + did.length + ' · ' + file.getUrl();
}

// ПРОВЕРКА без риска: заполнить копию шаблона в папке «Claude Testing» по файлам одной группы (название папки группы)
function testFill() {
  var NAME = 'Ilham';   // ← часть названия папки группы
  var test = DriveApp.getFoldersByName('Claude Testing').next().getId();
  var tops = DriveApp.getFoldersByName('1. Confirmed');
  while (tops.hasNext()) {
    var ms = tops.next().getFolders();
    while (ms.hasNext()) {
      var gs = ms.next().getFolders();
      while (gs.hasNext()) { var g = gs.next(); if (g.getName().indexOf(NAME) >= 0) { Logger.log(fillOne_(g.getId(), 'TEST', test)); return; } }
    }
  }
  Logger.log('папка не найдена: ' + NAME);
}

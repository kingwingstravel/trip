/**
 * KW Цены по PIN — отдаёт цены программ сайту Sales только агентам с PIN.
 * Цены и PIN хранятся в таблице «KW — PIN агентов (цены для сайта Sales)». В коде сайта цен нет.
 * Скрипт только читает таблицу (и пишет журнал). GitHub и ключей здесь нет.
 *
 * УСТАНОВКА (один раз): script.google.com → Новый проект «KW Цены по PIN» → этот текст в Code.gs →
 *   Развернуть → Новое развертывание → Веб-приложение: «Запуск от имени: я», «Доступ: все» → Развернуть.
 *   Адрес …/exec вписать в админку (Продажи → «Адрес проверки PIN») или в programs/settings.json → "pin_api".
 * Сделано 26.11.2026.
 */
var SHEET_ID = '1ryBFBySbEXoISn6lEFbb-juZ49YoypmWmnuqm1sOd8M';
var MAX_BAD_DEVICE = 5;     // неверных PIN с одного устройства за 15 минут
var MAX_BAD_ALL = 40;       // неверных PIN всего за 15 минут — дальше пауза для всех (защита от подбора)

function doGet(e) {
  var out;
  var p = e && e.parameter || {};
  try { out = p.act === 'book' ? book_(p) : check_(p); }
  catch (x) { out = { ok: false, err: 'server' }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function check_(p) {
  var pin = String(p.pin || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  var prog = String(p.p || '').replace(/[^a-z0-9-]/g, '').slice(0, 80);
  var lang = String(p.l || 'en').replace(/[^a-z]/g, '').slice(0, 3);
  var dev = String(p.d || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
  var cache = CacheService.getScriptCache();
  var badAll = +(cache.get('bad') || 0), badDev = dev ? +(cache.get('d' + dev) || 0) : 0;
  if (badAll >= MAX_BAD_ALL || badDev >= MAX_BAD_DEVICE) return { ok: false, err: 'locked' };
  if (pin.length < 4) return { ok: false, err: 'bad' };

  var ss = SpreadsheetApp.openById(SHEET_ID), sh = ss.getSheetByName('PIN');
  var v = sh.getDataRange().getValues(), row = -1;
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).toUpperCase().trim() === pin) { row = i; break; }
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var on = row > 0 && (v[row][6] === true || String(v[row][6]).toUpperCase() === 'TRUE');
  var until = row > 0 && v[row][5] ? new Date(v[row][5]) : null;
  var expired = !!(until && until < today);
  var agent = row > 0 ? String(v[row][1]) : '';

  if (row < 0 || !on || expired) {
    cache.put('bad', String(badAll + 1), 900);
    if (dev) cache.put('d' + dev, String(badDev + 1), 900);
    log_(ss, pin, agent, prog, lang, row < 0 ? 'неверный PIN' : !on ? 'PIN выключен' : 'срок истёк');
    return { ok: false, err: row < 0 ? 'bad' : !on ? 'off' : 'expired' };
  }

  var prices = null;
  if (prog) {
    var pv = ss.getSheetByName('Цены').getDataRange().getValues();
    for (var k = 1; k < pv.length; k++) if (String(pv[k][0]) === prog) { try { prices = JSON.parse(pv[k][3]); } catch (x) {} break; }
  }
  sh.getRange(row + 1, 9, 1, 2).setValues([[(+v[row][8] || 0) + 1, new Date()]]);
  log_(ss, pin, agent, prog, lang, prices ? 'цены показаны' : 'цен для программы нет');
  return { ok: true, agent: agent, pin: pin, prices: prices,
           until: until ? Utilities.formatDate(until, 'Asia/Almaty', 'yyyy-MM-dd') : '' };
}

function log_(ss, pin, agent, prog, lang, res) {
  try { ss.getSheetByName('Журнал').appendRow([new Date(), pin, agent, prog, lang, res]); } catch (x) {}
}

// ---- Бронь с сайта: агент с PIN нажал «Book this group» → строка «Новая» в листе «Брони» ----
var BK_HEAD = ['ID', 'Создано', 'Статус', 'Агентство', 'PIN', 'Программа', 'Название', 'Гостей', 'Начало', 'Конец',
               'Сумма USD', 'Депозит USD', 'Депозит получен', 'Остаток получен', 'Ответственный', 'Детали', 'Обновлено'];
function bkSheets_(ss) {
  var b = ss.getSheetByName('Брони');
  if (!b) { b = ss.insertSheet('Брони'); b.appendRow(BK_HEAD); b.setFrozenRows(1); b.getRange(1, 1, 1, BK_HEAD.length).setFontWeight('bold'); }
  var h = ss.getSheetByName('История броней');
  if (!h) { h = ss.insertSheet('История броней'); h.appendRow(['Когда', 'ID', 'Кто', 'Что']); h.setFrozenRows(1); h.getRange(1, 1, 1, 4).setFontWeight('bold'); }
  return { b: b, h: h };
}
function book_(p) {
  var cl = function (x, n) { return String(x || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n || 120); };
  var pin = String(p.pin || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  var cache = CacheService.getScriptCache(), k = 'bk' + pin, cnt = +(cache.get(k) || 0);
  if (cnt >= 10) return { ok: false, err: 'locked' };
  var ss = SpreadsheetApp.openById(SHEET_ID), v = ss.getSheetByName('PIN').getDataRange().getValues(), row = -1;
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).toUpperCase().trim() === pin) { row = i; break; }
  var today = new Date(); today.setHours(0, 0, 0, 0);
  if (row < 0 || !(v[row][6] === true || String(v[row][6]).toUpperCase() === 'TRUE') || (v[row][5] && new Date(v[row][5]) < today)) return { ok: false, err: 'bad' };
  cache.put(k, String(cnt + 1), 3600);
  var n = Math.max(1, Math.min(99, parseInt(p.n, 10) || 0)), pp = Math.max(0, Math.round(+p.pp || 0)), tot = pp * n;
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var s = bkSheets_(ss), id = 'KW-' + Utilities.formatDate(new Date(), 'Asia/Almaty', 'yyMMdd') + '-' + Math.floor(100 + Math.random() * 900);
    var det = { contact: { name: cl(p.nm), email: cl(p.em), wa: cl(p.wa, 40) }, hotel: cl(p.h, 2), meals: cl(p.m, 3), month: cl(p.mo, 40), pp: pp, lang: cl(p.l, 3),
                guide: {}, transport: {}, hotels: [], docs: {}, note: '' };
    s.b.appendRow([id, new Date(), 'new', cl(p.ag) || String(v[row][1]), pin, cl(p.p, 80), cl(p.t, 160), n, '', '', tot, Math.round(tot * 0.3), '', '', '', JSON.stringify(det), new Date()]);
    s.h.appendRow([new Date(), id, 'Сайт', 'Заявка по PIN ' + pin + (pp ? ' · ' + n + ' × ' + pp + ' $' : '')]);
  } finally { lock.releaseLock(); }
  log_(ss, pin, String(v[row][1]), cl(p.p, 80), cl(p.l, 3), 'заявка на бронь');
  return { ok: true };
}

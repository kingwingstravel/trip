"""Автопилот путеводителей — запасной путь без Claude и без программиста.

Каждое утро (GitHub Actions, .github/workflows/guide-autopilot.yml) берёт таблицы «Путеводитель»
из Google (веб-приложение tools/autopilot/KW_Guide_Feed.gs, секрет GUIDE_FEED = …/exec?k=КЛЮЧ),
собирает страницы групп тем же build_guide.py + publish.py и публикует их, плюс live.json для сайта агентов.

Работает, ТОЛЬКО если утренняя задача Claude молчит 2+ дня (live.json старше вчерашнего дня),
или при ручном запуске с --force. Пока Claude работает — ничего не делает, путаницы нет.

Запуск вручную:  GUIDE_FEED='https://script.google.com/macros/s/…/exec?k=…' python3 tools/autopilot/autoguide.py [--force] [--dry]
Проверка без Google:  python3 tools/autopilot/autoguide.py --local FEED.json --dry   (FEED.json = {"groups":[{id,name,g,t}]})
"""
import sys, os, re, json, hashlib, subprocess, datetime, base64, tempfile, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
SITE = 'https://trip.kingwingstravel-dmc.com'
ARGS = sys.argv[1:]
FORCE, DRY = '--force' in ARGS, '--dry' in ARGS
LOCAL = ARGS[ARGS.index('--local') + 1] if '--local' in ARGS else None
NOW = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=5)          # Алматы, UTC+5
TODAY = NOW.date()
LOG = []
def log(*a):
    s = ' '.join(str(x) for x in a); LOG.append(s); print(s, flush=True)

# ---------------------------------------------------------------- справочники
LANG = {'bahasa indonesia': 'id', 'indonesia': 'id', 'english': 'en', 'английский': 'en', 'русский': 'ru', 'russian': 'ru',
        'bahasa melayu': 'ms', 'malay': 'ms', 'korean': 'ko', 'корейский': 'ko', 'turkish': 'tr', 'турецкий': 'tr', 'türkçe': 'tr',
        'arabic': 'ar', 'арабский': 'ar', 'spanish': 'es', 'español': 'es', 'испанский': 'es', 'hindi': 'hi', 'хинди': 'hi',
        'chinese': 'zh', 'китайский': 'zh', 'japanese': 'ja', 'thai': 'th', 'vietnamese': 'vi', 'german': 'de', 'french': 'fr'}
CITY = {  # город -> страна (по-английски, как в таблице)
    'almaty': 'kz', 'astana': 'kz', 'shymkent': 'kz', 'turkistan': 'kz', 'turkestan': 'kz', 'taraz': 'kz', 'saty': 'kz', 'kolsai': 'kz',
    'kaindy': 'kz', 'charyn': 'kz', 'basshi': 'kz', 'altyn-emel': 'kz', 'medeu': 'kz', 'shymbulak': 'kz', 'kok-tobe': 'kz', 'otrar': 'kz',
    'tashkent': 'uz', 'samarkand': 'uz', 'bukhara': 'uz', 'khiva': 'uz', 'urgench': 'uz', 'fergana': 'uz', 'nukus': 'uz', 'termez': 'uz',
    'shakhrisabz': 'uz', 'kokand': 'uz', 'margilan': 'uz', 'andijan': 'uz', 'namangan': 'uz', 'chimgan': 'uz', 'moynaq': 'uz',
    'bishkek': 'kg', 'karakol': 'kg', 'cholpon-ata': 'kg', 'osh': 'kg', 'naryn': 'kg', 'kochkor': 'kg', 'son-kul': 'kg', 'issyk-kul': 'kg',
    'tash-rabat': 'kg', 'kel-suu': 'kg', 'ala-archa': 'kg', 'jeti-oguz': 'kg', 'bokonbaevo': 'kg', 'tamga': 'kg',
    'dushanbe': 'tj', 'khujand': 'tj', 'panjakent': 'tj', 'penjikent': 'tj', 'iskanderkul': 'tj', 'seven lakes': 'tj', 'haft kul': 'tj',
    'ashgabat': 'tm', 'mary': 'tm', 'darvaza': 'tm', 'dashoguz': 'tm', 'turkmenabat': 'tm', 'merv': 'tm'}
COUNTRY = {'kazakhstan': 'kz', 'uzbekistan': 'uz', 'kyrgyzstan': 'kg', 'tajikistan': 'tj', 'turkmenistan': 'tm'}
MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
MON_L = {'en': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
         'id': ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
         'ru': ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']}
MON_S = {'en': MON, 'id': ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
         'ru': ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']}
# готовые тексты (en / id / ru); другие языки — через Google Переводчик из en
TXT = {
    'guide': {'en': 'Travel guide', 'id': 'Panduan Perjalanan', 'ru': 'Путеводитель', 'ms': 'Panduan Perjalanan'},
    'guests': {'en': '{n} guests', 'id': '{n} tamu', 'ru': '{n} гостей', 'ms': '{n} tetamu'},
    'c_pass6': {'en': 'Passport valid for at least 6 months', 'id': 'Paspor berlaku minimal 6 bulan', 'ru': 'Паспорт действует ещё минимум 6 месяцев'},
    'c_passH': {'en': 'Passport always in your hand luggage (flights, trains and borders: {d})', 'id': 'Paspor selalu di tas tangan (penerbangan, kereta dan perbatasan: {d})', 'ru': 'Паспорт всегда в ручной клади (перелёты, поезда и границы: {d})'},
    'c_ins': {'en': 'Travel insurance', 'id': 'Asuransi perjalanan', 'ru': 'Туристическая страховка'},
    'c_cash': {'en': 'Some cash (US dollars in small notes)', 'id': 'Sedikit uang tunai (dolar AS dalam pecahan kecil)', 'ru': 'Немного наличных (доллары США мелкими купюрами)'},
    'c_plug': {'en': 'Power adapter type C/F', 'id': 'Adaptor listrik tipe C/F', 'ru': 'Переходник для розетки типа C/F'},
    'c_win': {'en': 'Winter jacket, hat, gloves, anti-slip shoes', 'id': 'Jaket musim dingin, kupluk, sarung tangan, sepatu antiselip', 'ru': 'Зимняя куртка, шапка, перчатки, нескользящая обувь'},
    'c_mid': {'en': 'Warm layer for the evenings and the mountains', 'id': 'Pakaian hangat untuk malam hari dan pegunungan', 'ru': 'Тёплая одежда на вечер и для гор'},
    'c_sum': {'en': 'Sun hat, sunscreen, light clothes; a warm layer for the mountains', 'id': 'Topi, tabir surya, pakaian ringan; pakaian hangat untuk pegunungan', 'ru': 'Панама, крем от солнца, лёгкая одежда; тёплая кофта для гор'},
    'c_holy': {'en': 'Modest clothes and a scarf for the holy sites', 'id': 'Pakaian sopan dan kerudung untuk tempat ziarah', 'ru': 'Закрытая одежда и платок для святых мест'},
    'c_open': {'en': 'Open this guide once while online', 'id': 'Buka panduan ini sekali saat online', 'ru': 'Откройте путеводитель один раз при интернете'},
    'tz1': {'en': 'All countries on the route: UTC+5', 'id': 'Semua negara di rute: UTC+5', 'ru': 'Во всех странах маршрута: UTC+5'},
    'tz2': {'en': 'Kazakhstan, Uzbekistan, Tajikistan, Turkmenistan: UTC+5 · Kyrgyzstan: UTC+6', 'id': 'Kazakhstan, Uzbekistan, Tajikistan, Turkmenistan: UTC+5 · Kirgizstan: UTC+6', 'ru': 'Казахстан, Узбекистан, Таджикистан, Туркменистан: UTC+5 · Кыргызстан: UTC+6'},
    'weather': {'en': 'Weather in {m}', 'id': 'Cuaca {m}', 'ru': 'Погода в {m}'},
    'noHotel': {'en': 'No hotel tonight — night flight', 'id': 'Malam ini tanpa hotel — penerbangan malam', 'ru': 'Сегодня без отеля — ночной рейс'},
    'thanks': {'en': '{d} days, {c} countries — many memories. Have a safe trip home.', 'id': '{d} hari, {c} negara — banyak kenangan. Semoga perjalanan pulang Anda lancar.', 'ru': '{d} дней, {c} стран(ы) — много впечатлений. Счастливого пути домой!'},
    'grp1': {'en': 'Your travel guide', 'id': 'Panduan perjalanan Anda', 'ru': 'Ваш путеводитель'},
    'grp2': {'en': 'Open in Safari or Chrome and save to your home screen — works offline.', 'id': 'Buka di Safari atau Chrome dan simpan ke layar utama — bisa dibuka tanpa internet.', 'ru': 'Откройте в Safari или Chrome и сохраните на главный экран — работает без интернета.'},
}
WX = {  # примерная погода по месяцам (города / ночи / горы) — без обещаний
    'en': ['Cities about −10…0 °C, cold nights; mountains colder, snow', 'Cities about −8…+3 °C, cold nights; mountains colder, snow',
           'Cities about 0–12 °C, cool nights; snow possible in the mountains', 'Cities about 10–22 °C, cool evenings; the mountains are colder',
           'Cities about 15–27 °C; cool evenings in the mountains', 'Cities about 25–35 °C, hot and dry; cooler in the mountains',
           'Cities about 28–38 °C, hot and dry; cooler in the mountains', 'Cities about 27–37 °C, hot and dry; cooler in the mountains',
           'Cities about 20–30 °C; cool evenings in the mountains', 'Cities about 10–22 °C, cool nights; the mountains are colder',
           'Cities about 0–12 °C, nights near or below 0 °C; mountains colder, snow possible', 'Cities about −8…+3 °C, cold nights; mountains colder, snow'],
}
IMG = [('night_arrival', r'night arrival|arrival at night|tiba dini hari'), ('flight', r'✈|\bflight\b'), ('train', r'\btrain\b|afrosiyob|sharq'),
       ('mountains', r'medeu|shymbulak|kolsai|kaindy|charyn|big almaty lake|seven lakes|haft kul|ala.?archa|issyk|son.?kul|kel.?suu|chimgan|mountain|canyon|gorge|waterfall'),
       ('madrasa', r'madras|registan|ichan kala|mausoleum|mosque|bukhara|samarkand|khiva|imam'), ('road', r'→|\bdrive\b|by road|border')]
FLIGHTLINE = re.compile(r'✈|airways|airline|air astana|flydubai|uzbekistan airways|scat|qazaq|\bflight\b', re.I)
FLIGHTNO = re.compile(r'\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{2,4}\b')
TIME = r'\d{1,2}[:.]\d{2}'
PLANRE = re.compile(r'^\s*((?:~\s*)?' + TIME + r'(?:\s*[–-]\s*' + TIME + r')?(?:\s*\(\d\d\.\d\d\))?)\s*[—–-]\s+(.+)$')
PHONE = re.compile(r'\+?\d[\d\s\-()]{8,}\d')

# ---------------------------------------------------------------- мелочи
def C(g, a1):
    """клетка по адресу A1 (строка, колонка)"""
    m = re.fullmatch(r'([A-Z])(\d+)', a1); c = ord(m.group(1)) - 65; r = int(m.group(2)) - 1
    return bad((g[r][c] if r < len(g) and c < len(g[r]) else '').strip())
def bad(v): return '' if re.fullmatch(r'#(ERROR!?|REF!?|N/A|VALUE!?|NAME\??|DIV/0!?)', v or '') else v
def at(row, i): return bad((row[i] if i < len(row) else '').strip())
def tru(v): return str(v).strip().upper() in ('TRUE', 'ИСТИНА', '1', 'YES', 'ДА')
def noq(s):
    """убрать то, что с «?» — туристам не показываем"""
    s = str(s or '')
    s = re.sub(r'\s*[\(\[][^()\[\]]*\?[^()\[\]]*[\)\]]', '', s)
    out = []
    for ln in s.splitlines():
        if '?' in ln:
            segs = re.split(r'\s+·\s+|;\s*|,\s*', ln)
            ln = ' · '.join(x.strip() for x in segs if x.strip() and '?' not in x)
        if ln.strip() and ln.strip() not in ('—', '-'): out.append(ln.rstrip())
    return '\n'.join(out).strip()
def hhmm(s):
    return re.sub(r'(?<!\d)(\d{1,2}):(\d{2})(?::\d{2})?(?!\d)', lambda m: f'{int(m.group(1)):02d}:{m.group(2)}', s or '')
def low(s): return (s or '').lower()
def find_city(text):
    t = low(text); best = None
    for k in CITY:
        for m in re.finditer(r'(?<![a-z])' + re.escape(k) + r'(?![a-z])', t):
            if best is None or m.start() > best[0]: best = (m.start(), k)
    return best[1] if best else None
def first_city(text):
    c = cities_in(text)
    return c[0] if c else None
def cities_in(text):
    t = low(text); found = []
    for k in CITY:
        m = re.search(r'(?<![a-z])' + re.escape(k) + r'(?![a-z])', t)
        if m: found.append((m.start(), k))
    return [k for _, k in sorted(found)]
def title_city(k): return '-'.join(w.capitalize() for w in k.split('-')).title() if ' ' in k else '-'.join(w.capitalize() for w in k.split('-'))
def fmt_range(a, b):
    if a.year == b.year and a.month == b.month: return f'{a.day}–{b.day} {MON[a.month-1]} {a.year}'
    if a.year == b.year: return f'{a.day} {MON[a.month-1]} – {b.day} {MON[b.month-1]} {a.year}'
    return f'{a.day} {MON[a.month-1]} {a.year} – {b.day} {MON[b.month-1]} {b.year}'

# ---------------------------------------------------------------- перевод (Google, через веб-приложение)
FEED = os.environ.get('GUIDE_FEED', '').strip()
TRC = {}
def translate(texts, to):
    texts = [t for t in texts if t and (to, t) not in TRC]
    if not texts: return
    if to == 'en' or not FEED:
        for t in texts: TRC[(to, t)] = t
        return
    for i in range(0, len(texts), 80):
        part = texts[i:i + 80]
        try:
            r = post({'op': 'tr', 'to': to, 'texts': part}).get('t') or part
        except Exception as e:
            log('перевод не удался:', e); r = part
        for a, b in zip(part, r): TRC[(to, a)] = b or a
def tr(en, to): return en if to == 'en' else TRC.get((to, en), en)
def txt(key, lang, **kw):
    d = TXT[key]; s = d.get(lang)
    if s is None: s = tr(d['en'], lang)
    for k, v in kw.items(): s = s.replace('{' + k + '}', str(v))
    return s
def need_txt(lang):
    if lang in ('en', 'id', 'ru'): return []
    return [d['en'] for k, d in TXT.items() if lang not in d] + WX['en']

def url_with(op):
    u = urllib.parse.urlsplit(FEED); q = dict(urllib.parse.parse_qsl(u.query)); q['op'] = op
    return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, urllib.parse.urlencode(q), ''))
def get_feed():
    with urllib.request.urlopen(url_with('feed'), timeout=300) as r: return json.loads(r.read().decode())
def post(body):
    u = urllib.parse.urlsplit(FEED); k = dict(urllib.parse.parse_qsl(u.query)).get('k', '')
    body = dict(body, k=k)
    req = urllib.request.Request(urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, '', '')), data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=300) as r: return json.loads(r.read().decode())

# ---------------------------------------------------------------- таблица -> данные группы
def day_rows(g):
    hdr = next((i for i, r in enumerate(g) if at(r, 0) == 'День'), None)
    if hdr is None: return None, []
    rows = []
    for r in g[hdr + 1:]:
        if re.fullmatch(r'\d{1,2}', at(r, 0)): rows.append(r)
        elif rows: break
    return g[hdr], rows

def dates_of(g, rows):
    b7 = C(g, 'B7')
    m = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})', b7)
    years = re.findall(r'20\d\d', b7 + ' ' + C(g, 'A1')) or [str(TODAY.year)]
    y = int(years[0])
    if m:
        a = datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    else:
        mm = re.match(r'(\d{1,2})\.(\d{1,2})', at(rows[0], 1)) if rows else None
        if not mm: return None, None, []
        a = datetime.date(y, int(mm.group(2)), int(mm.group(1)))
    ds = [a + datetime.timedelta(days=i) for i in range(len(rows))]
    return a, ds[-1] if ds else a, ds

def guests_of(g):
    b5 = C(g, 'B5')
    m = re.search(r'(\d+)\s*(?:гост|guest|pax|чел|tamu|tourist|турист)', b5, re.I) or re.search(r'(\d+)', b5)
    return int(m.group(1)) if m else 0

def parse_stays(rows, g, home):
    b14 = C(g, 'B14'); b15 = C(g, 'B15')
    n = len(rows); H = [at(r, 7) for r in rows]; idx = [None] * n; stays = []
    i = 0
    while i < n:
        h = H[i].strip()
        if not h: i += 1; continue
        if h.startswith('—') or h in ('-', '–'):
            idx[i] = -1; i += 1; continue
        j = i
        while j + 1 < n and H[j + 1].strip() == h: j += 1
        parts = [p.strip() for p in h.split(',') if p.strip()]
        parts = [p for p in parts if low(p) not in COUNTRY]
        name = parts[0] if parts and '?' not in parts[0] else None
        city = next((title_city(find_city(p)) for p in parts[1:] if find_city(p)), None)
        st = {'from': i, 'to': j + 1, 'nights': j + 1 - i}
        # подробности из B14: «Имя · адрес (для таксиста: …) · тел…» или «Город — Имя (адрес, тел)»
        if name:
            k = b14.find(name)
            if k >= 0:
                seg = re.split(r';|\s·\s(?=[А-ЯЁ][а-яё]+:)|\s·\s(?=Uzbekistan|Kyrgyzstan|Kazakhstan|Tajikistan|Turkmenistan)', b14[k:])[0]
                taxi = re.search(r'для таксиста:\s*([^)]+)\)', seg)
                if taxi: st['taxiRu'] = taxi.group(1).strip(); st['nameRu'] = f'Отель «{name}»'
                rest = seg[len(name):]
                pm = re.match(r'\s*\(([^)]*)\)', rest)
                if pm: addr = re.split(r',\s*(?=\+|тел)', pm.group(1))[0].strip()
                else:
                    bits = [x.strip() for x in re.split(r'\s+·\s+', rest) if x.strip()]
                    addr = re.sub(r'\s*\(.*', '', bits[0]).strip() if bits else ''
                if addr and not PHONE.fullmatch(addr) and re.search(r'\d|st\b|street|ul\.|kala|road|avenue|ave\b', addr, re.I): st['addr'] = addr
                if not city:
                    pre = b14[max(0, k - 40):k]
                    c2 = first_city(seg) or find_city(pre)
                    if c2: city = title_city(c2)
            if not city: city = title_city(find_city(at(rows[i], 2)) or '') or None
            st['name'] = name
        if not city and parts: city = title_city(find_city(' '.join(parts)) or '') or None
        st['city'] = city or (stays[-1]['city'] if stays else '')
        if st.get('addr') and city and city.lower() not in low(st['addr']): st['addr'] += ', ' + city
        if name: st['map'] = 'https://www.google.com/maps/search/?api=1&query=' + urllib.parse.quote_plus(f'{name} {st["city"]}')
        stays.append(st)
        for x in range(i, j + 1): idx[x] = len(stays) - 1
        i = j + 1
    bk = re.search(r'№\s*([\w\-/, ]+?)(?:\s+·|$)', b15)
    if bk:
        for st in stays:
            if CITY.get(low(st.get('city'))) == home: st['booking'] = bk.group(1).strip()
    return stays, idx

def plan_of(en, ln, lang):
    a = [x for x in noq(en).splitlines() if x.strip()]
    b = [x for x in noq(ln).splitlines() if x.strip()] if lang != 'en' else []
    out = []
    for k, line in enumerate(a):
        m = PLANRE.match(line); t, s = (m.group(1).strip(), m.group(2).strip()) if m else ('', line.strip())
        o = {'en': s}
        if lang != 'en':
            if len(b) == len(a):
                mb = PLANRE.match(b[k]); o[lang] = (mb.group(2) if mb else b[k]).strip()
            else: o[lang] = None
        out.append([t, o])
    return out

def L(en, ln, lang):
    """текст {en, lang}; пусто — None"""
    en = noq(en); ln = noq(ln) if lang != 'en' else ''
    if not en and not ln: return None
    o = {'en': en or ln}
    if lang != 'en': o[lang] = ln or None
    return o

def fill_missing(G, lang):
    """перевести то, что не заполнено на языке группы"""
    if lang == 'en': return
    miss = []
    def walk(o):
        if isinstance(o, dict):
            if 'en' in o and lang in o and o[lang] is None: miss.append(o['en'])
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(G)
    translate(sorted(set(miss)), lang)
    def put(o):
        if isinstance(o, dict):
            if 'en' in o and lang in o and o[lang] is None: o[lang] = tr(o['en'], lang)
            for v in o.values(): put(v)
        elif isinstance(o, list):
            for v in o: put(v)
    put(G)

def ticket_en(s):
    for a, b in [('ручная кладь', 'Hand luggage'), ('бронь', 'Booking'), ('билет', 'Ticket'), ('багаж', 'Baggage'), ('место', 'Seat'), ('кг', 'kg'), ('вагон', 'Car')]:
        s = re.sub(a, b, s, flags=re.I)
    return s

def build_group(grp):
    g, t = grp['g'], grp.get('t') or []
    lang = LANG.get(low(C(g, 'B8')), 'en')
    hdr, rows = day_rows(g)
    if not rows: raise ValueError('нет дней (строка «День»)')
    start, end, ds = dates_of(g, rows)
    if not start: raise ValueError('нет дат (B7)')
    home = 'kz'
    stays, hidx = parse_stays(rows, g, home)
    # страна и город по дням
    days = []; countries = []; prev_city = None; flight_days = []
    for i, r in enumerate(rows):
        h = hidx[i]
        city = stays[h]['city'] if h is not None and h >= 0 else None
        tc = cities_in(at(r, 2))
        if not city: city = title_city(tc[-1]) if tc else prev_city
        c = CITY.get(low(city)) or (CITY.get(tc[-1]) if tc else None) or (days[-1]['c'] if days else home)
        for k in tc:
            cc = CITY.get(k)
            if cc and cc not in countries and (cc == c or not countries or cc != countries[-1]): pass
        for k in COUNTRY:
            if k in low(at(r, 2)) and COUNTRY[k] not in countries: countries.append(COUNTRY[k])
        if c not in countries: countries.append(c)
        allt = ' '.join([at(r, 2), at(r, 5)])
        d = {'c': c, 'place': (f'{prev_city} → {city}' if prev_city and city and prev_city != city else (city or '')),
             't': hhmm(noq(at(r, 3))), 'title': L(at(r, 2), at(r, 12), lang)}
        img = next((k for k, rx in IMG if (i == 0 or k != 'night_arrival') and re.search(rx, low(allt))), 'city')
        d['img'] = img
        mt = L(at(r, 4), at(r, 13), lang)
        if mt: d['meet'] = mt
        pl = plan_of(at(r, 5), at(r, 14), lang)
        if pl: d['plan'] = pl
        im = L(at(r, 6), at(r, 15), lang)
        if im: d['imp'] = im
        tags = []
        for line in at(r, 5).splitlines():
            if FLIGHTLINE.search(line):
                fn = FLIGHTNO.search(line); tm = re.match(r'\s*(' + TIME + ')', line)
                if fn: tags.append(fn.group(0) + (' · ' + tm.group(1) if tm else ''))
        if tags:
            d['tags'] = [{'en': x, **({lang: x} if lang != 'en' else {})} for x in tags[:2]]
        if tags or re.search(r'\btrain\b|border', low(allt)): flight_days.append(ds[i])
        if h is not None: d['hotel'] = h
        meals = {}
        for key, ce, cl in (('l', 9, 17), ('d', 10, 18), ('o', 11, 19)):
            v = L(at(r, ce), at(r, cl), lang)
            if v: meals[key] = v
        if meals: d['meals'] = meals
        back = noq(at(r, 8))
        if back and re.search(r'-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}|@-?\d|[?&]q=-?\d', back): d['back'] = back
        days.append(d); prev_city = city or prev_city
    G = {'lang': lang, 'langs': [lang, 'en'] if lang != 'en' else ['en'], 'start': start.isoformat(), 'countries': countries, 'home': home}
    grp_name = re.sub(r'^.*?—\s*', '', C(g, 'A1')).split(',')[0].strip() or grp.get('folder', '')
    translate(need_txt(lang), lang)
    G['title'] = f'{txt("guide", lang)} · {grp_name} · {fmt_range(start, end)}'
    n = guests_of(g)
    if n: G['guests'] = {'en': txt('guests', 'en', n=n), **({lang: txt('guests', lang, n=n)} if lang != 'en' else {})}
    # логотип
    b9 = low(C(g, 'B9'))
    mode = 'none' if 'без' in b9 else 'kw+agent' if '+' in b9 else 'two' if 'два' in b9 else 'agent' if 'агент' in b9 else 'kw'
    files = []
    for k, lg in enumerate(grp.get('logos') or []):
        ext = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg'}.get(lg.get('mime'), '.png')
        p = os.path.join(tempfile.gettempdir(), f'kwlogo_{grp["id"][:10]}_{k}{ext}'); open(p, 'wb').write(base64.b64decode(lg['b64'])); files.append(p)
    if mode in ('agent', 'two', 'kw+agent') and not files: log('  логотип агентства не скачался — ставлю King Wings'); mode = 'kw'
    G['logo'] = {'mode': mode, **({'files': files} if files else {})}
    sup = C(g, 'B21')
    if sup: G['support'] = sup
    gname = re.split(r'\s+[—–]\s+|\s*\(', noq(C(g, 'B16')))[0].strip(); gph = C(g, 'B17')
    if gname:
        G['guides'] = {home: {'name': gname, **({'phone': gph} if tru(C(g, 'B18')) and PHONE.fullmatch(gph or '') else {})}}
    b19 = noq(re.sub(r'\+.*$', '', C(g, 'B19')))
    if b19:
        bits = [x.strip(' ·') for x in re.split(r'\s+·\s+', b19) if x.strip(' ·')]
        ph = PHONE.search(C(g, 'B19'))
        dr = {'name': bits[0]}
        if len(bits) > 1 and not PHONE.fullmatch(bits[1]): dr['car'] = bits[1]
        if ph and tru(C(g, 'B20')): dr['phone'] = ph.group(0).strip()
        G['drivers'] = {home: dr}
    G['route'] = ' · '.join(dict.fromkeys(s['city'] for s in stays if s.get('city')))
    G['tripImg'] = 'madrasa' if 'uz' in countries else 'mountains'
    G['showMeals'] = tru(C(g, 'J23'))
    G['stays'] = stays; G['days'] = days
    # перед поездкой
    mo = start.month
    dd = sorted(set(flight_days))
    dtxt = lambda lg: ', '.join(str(x.day) for x in dd) + ' ' + (MON_S.get(lg) or MON_S['en'])[dd[-1].month - 1] if dd else ''
    keys = ['c_pass6'] + (['c_passH'] if dd else []) + ['c_ins', 'c_cash', 'c_plug'] + \
           [('c_win' if mo in (11, 12, 1, 2, 3) else 'c_sum' if mo in (6, 7, 8) else 'c_mid')] + \
           (['c_holy'] if any(re.search(r'mosque|madras|mausoleum|imam|ziarah|shrine|holy', low(json.dumps(d))) for d in days) else []) + ['c_open']
    G['check'] = {lg: [txt(k, lg, d=dtxt(lg if lg in MON_S else 'en')) for k in keys] for lg in G['langs']}
    tz = 'tz2' if 'kg' in countries else 'tz1'
    wx = WX['en'][mo - 1]
    G['ui'] = {}
    for lg in G['langs']:
        mname = (MON_L.get(lg) or MON_L['en'])[mo - 1]
        G['ui'][lg] = {'timeV': txt(tz, lg), 'weatherV': wx if lg == 'en' else tr(wx, lg), 'weather': txt('weather', lg, m=mname if lg in MON_L else tr(MON_L['en'][mo - 1], lg)),
                       'noHotel': txt('noHotel', lg), 'thanksSub': txt('thanks', lg, d=len(days), c=len(countries))}
    # личная часть
    people = []
    if len(t) > 4:
        hrow = t[3] if len(t) > 3 else []
        roomcol = {}
        for ci in range(2, 8):
            hh = at(hrow, ci)
            if not hh: continue
            k = next((si for si, s in enumerate(stays) if s.get('name') and low(s['name']) in low(hh)), None)
            if k is None:
                cc = find_city(hh)
                k = next((si for si, s in enumerate(stays) if cc and low(s.get('city')) == cc), None)
            if k is not None: roomcol[ci] = k
        for r in t[4:]:
            nm = at(r, 1)
            if not nm: continue
            try: pid = 'p%02d' % int(re.sub(r'\D', '', at(r, 0)) or len(people) + 1)
            except ValueError: pid = 'p%02d' % (len(people) + 1)
            p = {'id': pid, 'name': nm}
            rooms = {str(k): at(r, ci) for ci, k in roomcol.items() if at(r, ci)}
            if rooms: p['rooms'] = rooms
            tk = []
            for line in at(r, 8).splitlines():
                m = re.match(r'\s*(\d{1,2})\.(\d{1,2})\s*[·\-—:]?\s*(.+)', line)
                if not m: continue
                try: dt = datetime.date(start.year + (1 if int(m.group(2)) < start.month - 6 else 0), int(m.group(2)), int(m.group(1)))
                except ValueError: continue
                if dt in ds: tk.append({'day': ds.index(dt), 'text': ticket_en(noq(m.group(3)))})
            if tk: p['tickets'] = tk
            ms = L(at(r, 9), at(r, 10), lang)
            if ms: p['msg'] = ms
            people.append(p)
    if people: G['people'] = people
    fill_missing(G, lang)
    return G, start, end, ds, lang

# ---------------------------------------------------------------- живые цифры
def live_of(groups):
    now = []; nxt = 0
    for grp in groups:
        if grp.get('error'): continue
        g = grp['g']
        try:
            hdr, rows = day_rows(g); start, end, ds = dates_of(g, rows)
        except Exception: continue
        if not start: continue
        if start <= TODAY <= end and rows:
            i = (TODAY - start).days
            stays, hidx = parse_stays(rows, g, 'kz')
            h = hidx[i] if i < len(hidx) else None
            city = stays[h]['city'] if h is not None and h >= 0 else (title_city(cities_in(at(rows[i], 2))[-1]) if cities_in(at(rows[i], 2)) else None)
            c = CITY.get(low(city)) if city else None
            it = {'c': (c or 'kz').upper()}
            if city and c: it['city'] = city
            n = guests_of(g)
            if n: it['guests'] = n
            now.append(it)
        if TODAY < start <= TODAY + datetime.timedelta(days=30): nxt += 1
    return {'updated': TODAY.isoformat(), 'now': now, 'next30': {'groups': nxt}}

# ---------------------------------------------------------------- главное
def srchash(g, t, extra):
    h = hashlib.sha256(json.dumps({'g': g, 't': t}, ensure_ascii=False, sort_keys=True).encode())
    h.update(extra.encode())
    for f in ('template.html', 'build_guide.py', 'claim_url.txt'):
        fp = os.path.join(TOOLS, f)
        if os.path.exists(fp): h.update(open(fp, 'rb').read())
    return h.hexdigest()

def run(cmd):
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    if r.returncode: raise RuntimeError(' '.join(cmd[:3]) + ': ' + (r.stdout + r.stderr)[-800:])
    return r.stdout

def claude_active():
    try:
        u = json.load(open(os.path.join(REPO, 'live.json'))).get('updated', '2000-01-01')
        return datetime.date.fromisoformat(u) >= TODAY - datetime.timedelta(days=1)
    except Exception: return False

def main():
    if not FORCE and not LOCAL and claude_active():
        log('Утренняя задача Claude работает (live.json свежий) — автопилот ничего не делает.'); return 0
    if LOCAL: feed = json.load(open(LOCAL))
    else:
        if not FEED: log('Нет секрета GUIDE_FEED — автопилот не настроен (см. ИНСТРУКЦИЯ.md).'); return 0
        feed = get_feed()
        if feed.get('error'): log('Google ответил:', feed['error']); return 1
    groups = feed.get('groups', [])
    log(f'Таблиц путеводителей: {len(groups)}')
    done = []; writes = []
    for grp in groups:
        if grp.get('error'): log('-', grp.get('name'), ':', grp['error']); continue
        g, t = grp['g'], grp.get('t') or []
        name = grp.get('name', '')
        if not tru(C(g, 'B23')): continue
        try:
            hdr, rows = day_rows(g); start, end, ds = dates_of(g, rows)
        except Exception as e: log('-', name, ': даты не читаются', e); continue
        if not end or end < TODAY: continue
        b25 = C(g, 'B25')
        mc = re.search(r'/g/([a-hj-km-np-z2-9]{8})/', b25); mp = re.search(r'PIN\s*(\d{6})', b25)
        code, pin = (mc.group(1), mp.group(1)) if mc and mp else (None, None)
        sh = srchash(g, t, C(g, 'B9') + ' ' + C(g, 'B10'))
        if code and os.path.exists(os.path.join(REPO, 'g', code, 'src.sha')) and open(os.path.join(REPO, 'g', code, 'src.sha')).read().strip() == sh:
            log('-', name, ': без изменений'); continue
        try:
            G, start, end, ds, lang = build_group(grp)
        except Exception as e: log('-', name, ': НЕ собрано —', e); continue
        new = not code
        if new:
            code, pin = run(['python3', 'tools/newcode.py', '.']).split()
        G['code'] = code
        staff = re.sub(r'\D', '', C(g, 'B26'))
        if G.get('people'):
            if not staff: staff = run(['python3', 'tools/staffcode.py', pin]).strip(); writes.append((grp['id'], {'B26': staff}, None, None))
            G['staffCode'] = staff.zfill(6)
        tmpj = os.path.join(tempfile.gettempdir(), f'{code}.json'); tmph = os.path.join(tempfile.gettempdir(), f'{code}.html')
        json.dump(G, open(tmpj, 'w', encoding='utf8'), ensure_ascii=False)
        try:
            out = run(['python3', 'tools/build_guide.py', tmpj, tmph])
            for ln in out.splitlines():
                if ln.startswith('ВНИМАНИЕ'): log('  ', ln)
            if DRY: log('-', name, ': собрано (пробный запуск, не опубликовано)', code); done.append(code); continue
            short = G['title'].split(' · ', 1)[1]
            run(['python3', 'tools/publish.py', tmph, code, pin, short, '.', lang if lang in ('id', 'en', 'ru', 'ms', 'ko') else 'en'])
        except Exception as e: log('-', name, ': НЕ собрано —', e); continue
        finally:
            for f in (tmpj,):
                try: os.remove(f)
                except OSError: pass
        open(os.path.join(REPO, 'g', code, 'src.sha'), 'w').write(sh + '\n')
        open(os.path.join(REPO, 'g', code, 'auto'), 'w').write(f'собрано автопилотом {NOW:%d.%m.%Y %H:%M} — Claude пересоберёт при следующем запуске\n')
        stamp = f' · Опубликовано автопилотом {NOW:%d.%m %H:%M}'
        photo = {'code': code, 'b': hashlib.sha256(f'{code}:{pin}'.encode()).hexdigest(),
                 'c': hashlib.sha256(f'{code}:{staff.zfill(6)}'.encode()).hexdigest() if staff else '', 'e': G['title'].split(' · ', 1)[1]}
        if new:
            link = f'{SITE}/g/{code}/'
            gl = f'{txt("grp1", lang)} / Your travel guide: {link}?p={pin}  PIN: {pin}' if lang != 'en' else f'Your travel guide: {link}?p={pin}  PIN: {pin}'
            g2 = f'{txt("grp2", lang)} / {TXT["grp2"]["en"]}' if lang != 'en' else TXT['grp2']['en']
            writes.append((grp['id'], {'B25': f'{link} · PIN {pin}\n\nТекст для группы:\n{gl}\n{g2}'}, stamp, photo))
        else: writes.append((grp['id'], {}, stamp, photo))
        log('-', name, ': опубликовано', f'{SITE}/g/{code}/', '(новая группа)' if new else '')
        done.append(code)
    live = live_of(groups)
    if not DRY:
        open(os.path.join(REPO, 'live.json'), 'w').write(json.dumps(live, ensure_ascii=False) + '\n')
    log('Живые цифры:', json.dumps(live, ensure_ascii=False))
    if DRY: return 0
    run(['git', 'add', 'g', 'live.json'])
    if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=REPO).returncode:
        run(['git', '-c', 'user.name=guide-autopilot', '-c', 'user.email=guide-autopilot@users.noreply.github.com', 'commit', '-q', '-m', 'guide autopilot: ' + (', '.join(done) or 'live.json')])
        run(['git', 'pull', '-q', '--rebase', 'origin', 'main']); run(['git', 'push', '-q', 'origin', 'HEAD:main'])
        run(['git', 'fetch', '-q', 'origin', 'main'])
        for code in done:
            got = subprocess.run(['git', 'show', f'origin/main:g/{code}/src.sha'], cwd=REPO, capture_output=True, text=True).stdout.strip()
            if not got: log('ВНИМАНИЕ: не видно на сайте', code)
    if not FEED: writes = []
    for sid, cells, stamp, photo in writes:          # таблицу трогаем только после успешной публикации
        try:
            r = post({'op': 'write', 'id': sid, 'set': cells, **({'append': {'B24': stamp}} if stamp else {}), **({'photo': photo} if photo else {})})
            if r.get('error'): log('запись в таблицу:', r['error'])
        except Exception as e: log('запись в таблицу не удалась:', e)
    return 0

if __name__ == '__main__':
    sys.exit(main())

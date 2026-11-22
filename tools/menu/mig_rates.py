# Курс обменника МиГ (mig.kz) -> menu/rates.js. Запускается GitHub Actions по расписанию.
# Левая цифра — МиГ покупает, правая — МиГ продаёт.
# Нам нужны: сомы покупаем у МиГ (их продажа), доллары клиента сдаём МиГ (их покупка) — так расчёт не в минус.
import re, sys, html, json, datetime, urllib.request
req = urllib.request.Request('https://mig.kz/', headers={'User-Agent': 'Mozilla/5.0 (KWT menu rates)'})
raw = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'ignore')
txt = html.unescape(re.sub(r'<[^>]+>', ' ', raw))
tok = txt.split()
def pair(code):
    for i, t in enumerate(tok):
        if t == code:
            a = [x for x in tok[max(0, i-4):i] if re.fullmatch(r'\d+(?:[.,]\d+)?', x)]
            b = [x for x in tok[i+1:i+5] if re.fullmatch(r'\d+(?:[.,]\d+)?', x)]
            if a and b:
                return float(a[-1].replace(',', '.')), float(b[0].replace(',', '.'))
    return None
k, u = pair('KGS'), pair('USD')
if not k or not u or not (3 < k[1] < 9) or not (300 < u[0] < 800) or k[0] > k[1] or u[0] > u[1]:
    print('не удалось прочитать курс, файл не меняю', k, u); sys.exit(0)
m = re.search(r'на\s+(\d{1,2}\s+\S+\s+\d{4})[,\s]+(\d{1,2}:\d{2})', txt)
now = datetime.datetime.utcnow() + datetime.timedelta(hours=5)
d = (m.group(1) + ' ' + m.group(2)) if m else now.strftime('%d.%m.%Y %H:%M')
data = {'d': d, 'kgs': k[1], 'kgsb': k[0], 'usd': u[0], 'usds': u[1], 'src': 'mig.kz'}
open('menu/rates.js', 'w').write('window.KW_RATES=' + json.dumps(data, ensure_ascii=False) + ';\n')
print(data)

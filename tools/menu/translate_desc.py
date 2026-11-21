# RU → EN описания блюд для «Меню партнёру». Запускается в GitHub Actions (там есть интернет).
import json, time, urllib.request, urllib.parse, os
src = json.load(open('tools/menu/tr_src.json'))
outp = 'tools/menu/tr_en.json'
done = json.load(open(outp)) if os.path.exists(outp) else {}
def gt(text):
    data = urllib.parse.urlencode({'q': text}).encode()
    req = urllib.request.Request('https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=en&dt=t', data=data,
                                 headers={'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'})
    j = json.load(urllib.request.urlopen(req, timeout=15))
    return ''.join(x[0] for x in j[0])
T0 = time.time()
todo = [t for t in src if t not in done]
grp, cur, n = [], [], 0
for t in todo:
    if n + len(t) > 1500 and cur: grp.append(cur); cur, n = [], 0
    cur.append(t); n += len(t) + 1
if cur: grp.append(cur)
for g in grp:
    for k in range(3):
        try:
            out = gt('\n'.join(g)).split('\n')
            if len(out) == len(g):
                for a, b in zip(g, out): done[a] = b.strip()
            else:
                for a in g: done[a] = gt(a).strip(); time.sleep(.2)
            break
        except Exception as e:
            print('retry', e, flush=True); time.sleep(3)
    json.dump(done, open(outp, 'w'), ensure_ascii=False, indent=0)
    print(len(done), flush=True)
    if time.time() - T0 > 600: print('time limit, saving'); break
    time.sleep(.3)
json.dump(done, open(outp, 'w'), ensure_ascii=False, indent=0)
print('translated', len(done), 'of', len(src))

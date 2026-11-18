"""King Wings menu: step 1 — fetch dish lists (name, description, image url) from Glovo / Wolt.
Step 2 — download images listed in tools/menu/want.json into menu/img/ (resized, jpg).
Prices are NEVER taken from here (owner rule: prices only from our base)."""
import json, os, re, time, hashlib, io, sys
import requests
OUT='tools/menu/out'; os.makedirs(OUT, exist_ok=True)
H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36','Accept-Language':'ru-RU,ru;q=0.9'}
src=json.load(open('tools/menu/sources.json'))
log=[]
def get(u, **kw):
    try:
        r=requests.get(u, headers=H, timeout=30, **kw); return r
    except Exception as e:
        log.append(f'ERR {u} {e}'); return None
def walk_wolt(j):
    items=[]
    def rec(o):
        if isinstance(o,dict):
            if 'name' in o and ('images' in o or 'image' in o) and isinstance(o.get('name'),str):
                im=None
                if isinstance(o.get('images'),list) and o['images']:
                    x=o['images'][0]; im=x.get('url') if isinstance(x,dict) else x
                elif isinstance(o.get('image'),dict): im=o['image'].get('url')
                elif isinstance(o.get('image'),str): im=o['image']
                items.append({'name':o['name'],'desc':o.get('description') or '','img':im})
            for v in o.values(): rec(v)
        elif isinstance(o,list):
            for v in o: rec(v)
    rec(j); return items
def glovo_items(html):
    items=[]; seen=set()
    # product objects in embedded JSON: "name":"...", ... "imageUrl":"..."  (order varies) — scan windows
    for m in re.finditer(r'https:\\?/\\?/glovo\.dhmedia\.io\\?/image\\?/[^"\'\s\\]+(?:\\?/[^"\'\s\\]+)*', html):
        pass
    for m in re.finditer(r'\{[^{}]{0,4000}?"imageUrl"\s*:\s*"([^"]+)"[^{}]{0,4000}?\}', html):
        blk=m.group(0)
        n=re.search(r'"name"\s*:\s*"((?:[^"\\]|\\.)*)"', blk)
        d=re.search(r'"description"\s*:\s*"((?:[^"\\]|\\.)*)"', blk)
        if not n: continue
        try: name=json.loads('"'+n.group(1)+'"'); desc=json.loads('"'+d.group(1)+'"') if d else ''
        except Exception: continue
        img=m.group(1).replace('\\u002F','/').replace('\\/','/')
        if (name,img) in seen: continue
        seen.add((name,img)); items.append({'name':name,'desc':desc,'img':img})
    return items
mode = sys.argv[1] if len(sys.argv)>1 else 'auto'
want_path='tools/menu/want.json'
if mode=='auto':
    mode = 'images' if os.path.exists(want_path) and os.path.exists(f'{OUT}/.lists_done') else 'lists'
if mode=='lists':
    for rid,s in src.items():
        res={}
        for slug in s.get('wolt',[]):
            u=f'https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/{slug}/assortment?language=ru'
            r=get(u); log.append(f'wolt {rid} {slug} {r.status_code if r else None}')
            if r is not None and r.ok:
                try: it=walk_wolt(r.json())
                except Exception: it=[]
                log.append(f'   items {len(it)}')
                if it: res['wolt:'+slug]=it; break
            time.sleep(1)
        for slug in s.get('glovo',[]):
            u=f'https://glovoapp.com/ru/kz/almaty/stores/{slug}'
            r=get(u); log.append(f'glovo {rid} {slug} {r.status_code if r else None} {len(r.text) if r else 0}')
            if r is not None and r.ok:
                it=glovo_items(r.text); log.append(f'   items {len(it)}')
                if not it: open(f'{OUT}/{rid}_glovo_raw.html','w').write(r.text[:3000000])
                if it: res['glovo:'+slug]=it; break
            time.sleep(1)
        json.dump(res, open(f'{OUT}/{rid}.json','w'), ensure_ascii=False, indent=0)
    open(f'{OUT}/.lists_done','w').write(time.strftime('%Y-%m-%d %H:%M'))
else:
    from PIL import Image
    want=json.load(open(want_path)); os.makedirs('menu/img',exist_ok=True); n=0
    for fn,u in want.items():
        p=f'menu/img/{fn}'
        if os.path.exists(p): continue
        r=get(u)
        if r is None or not r.ok: log.append(f'img fail {fn} {r.status_code if r else None}'); continue
        try:
            im=Image.open(io.BytesIO(r.content)).convert('RGB'); im.thumbnail((480,480))
            os.makedirs(os.path.dirname(p),exist_ok=True); im.save(p,'JPEG',quality=78,optimize=True,progressive=True); n+=1
        except Exception as e: log.append(f'img bad {fn} {e}')
        time.sleep(0.2)
    log.append(f'images saved {n}')
open(f'{OUT}/log.txt','w').write('\n'.join(log)); print('\n'.join(log))

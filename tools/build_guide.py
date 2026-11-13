"""Build a group guide page from a data file.
Usage: python3 build_guide.py GROUP.json OUT.html
GROUP.json — see README (fields: code, lang, langs, title, start, countries, guests, logo,
support, guides, drivers, stays, days, check, ui, route, tripImg, showMeals, photos, home).
Logo images: logo.files = [local image paths] are embedded into the page.
The page is NOT encrypted here — run publish.py on OUT.html afterwards."""
import sys,os,json,re,base64,mimetypes
src,out=sys.argv[1:3]
here=os.path.dirname(os.path.abspath(__file__))
G=json.load(open(src,encoding='utf8'))
err=[];warn=[]
for k in ['code','lang','title','start','countries','days']:
    if not G.get(k): err.append('нет поля '+k)
if not re.fullmatch(r'[a-hj-km-np-z2-9]{8}',G.get('code','')): err.append('код группы: 8 символов a-z (без i,l,o) и 2-9')
if not re.fullmatch(r'\d{4}-\d\d-\d\d',G.get('start','')): err.append('start: ГГГГ-ММ-ДД')
langs=G.get('langs') or [G.get('lang'),'en']
stays=G.get('stays',[]);n=len(G.get('days',[]))
for i,s in enumerate(stays):
    if not (0<=s.get('from',-1)<s.get('to',-1)<=n): err.append(f'stays[{i}]: from/to вне дней')
for i,d in enumerate(G.get('days',[])):
    if d.get('c') not in ('kz','uz','kg','tj','tm'): err.append(f'days[{i}].c: kz/uz/kg/tj/tm')
    h=d.get('hotel')
    if h is not None and h>=len(stays): err.append(f'days[{i}].hotel: нет такого stays')
    if not d.get('title'): err.append(f'days[{i}]: нет title')
ids=set()
for i,pp in enumerate(G.get('people',[]) or []):
    if not pp.get('id') or not pp.get('name'): err.append(f'people[{i}]: нужны id и name')
    if pp.get('id') in ids: err.append(f'people[{i}]: id повторяется')
    ids.add(pp.get('id'))
    for k in (pp.get('rooms') or {}):
        if not (str(k).isdigit() and int(k)<len(stays)): err.append(f'people[{i}].rooms: нет отеля {k}')
    for k in pp.get('tickets',[]) or []:
        if not isinstance(k.get('day'),int) or not 0<=k['day']<n: err.append(f'people[{i}].tickets: day вне дней')
    pt=json.dumps(pp,ensure_ascii=False)
    if re.search(r'pass?port|paspor|паспорт|\b[A-Z]{1,2}\d{6,8}\b',pt,re.I): err.append(f'people[{i}] ({pp.get("name")}): похоже на паспортные данные — убрать')
txt=json.dumps(G,ensure_ascii=False)
if re.search(r'\d[\d\s.,]*\s?(USD|EUR|KZT|UZS|KGS|тг\b|тенге|\$)|нетто|наценк|net price',txt,re.I): warn.append('похоже на цену/нетто — проверь!')
if '#ERROR' in txt or '#REF' in txt or '#N/A' in txt: err.append('в данных ошибка таблицы (#ERROR / #REF / #N/A)')
# --- daily memo (решение владельца 11.11.2026): место для прогноза погоды на каждый день, горы, святые места ---
# days[i].wx = [{n, lat, lon, m}] (m=1 — горы, холоднее), days[i].holy = 1. Поставлено вручную — не трогаем.
CITY={'tashkent':(41.311,69.28),'samarkand':(39.654,66.96),'bukhara':(39.768,64.455),'khiva':(41.378,60.364),'fergana':(40.386,71.787),
 'nukus':(42.46,59.6),'termez':(37.224,67.278),'shakhrisabz':(39.057,66.834),'almaty':(43.238,76.946),'shymkent':(42.317,69.596),
 'turkistan':(43.297,68.27),'turkestan':(43.297,68.27),'astana':(51.169,71.449),'taraz':(42.9,71.367),'bishkek':(42.875,74.6),
 'osh':(40.513,72.816),'karakol':(42.49,78.39),'cholpon-ata':(42.65,77.08),'dushanbe':(38.559,68.787),'panjakent':(39.495,67.609),
 'penjikent':(39.495,67.609),'khujand':(40.283,69.633),'ashgabat':(37.96,58.326),'mary':(37.6,61.83)}
MOUNT={'medeu':('Medeu',43.157,77.059),'shymbulak':('Shymbulak',43.128,77.081),'big almaty lake':('Big Almaty Lake',43.05,76.98),
 'kok-tobe':('Kok-Tobe',43.233,76.975),'ala archa':('Ala Archa',42.565,74.482),'seven lakes':('Seven Lakes',39.36,67.62),
 'haftkul':('Seven Lakes',39.36,67.62),'kolsai':('Kolsai',42.93,78.32),'charyn':('Charyn',43.35,79.08),'chimgan':('Chimgan',41.55,70.0),
 'issyk-kul':('Issyk-Kul',42.65,77.08),'burana':('Burana',42.746,75.25),'jeti-oguz':('Jeti-Oguz',42.33,78.23),
 'skazka':('Skazka',42.15,77.36),'fairy tale':('Skazka',42.15,77.36),'tash-rabat':('Tash-Rabat',40.82,75.29),'tash rabat':('Tash-Rabat',40.82,75.29),
 'son-kul':('Son-Kul',41.83,75.13),'song-kol':('Son-Kul',41.83,75.13),'son kul':('Son-Kul',41.83,75.13),'kel-suu':('Kel-Suu',40.95,76.0),'kol-suu':('Kel-Suu',40.95,76.0)}
# связь по местам (Виталий, 11.11.2026) — ключ текста в шаблоне sg_<код>
SIG={'skazka':'sk','fairy tale':'sk','tash-rabat':'tr','tash rabat':'tr','kel-suu':'ks','kol-suu':'ks','son-kul':'sn','song-kol':'sn','son kul':'sn'}
HOLY=re.compile(r'mosque|masjid|mausoleum|madrasa|madrassa|khast[- ]imam|hazrat|shrine|imam |shakhi|shah-i|yasawi|yassawi|naqshband|bahauddin|ziarah|ziyarat',re.I)
def _en(o): return (o.get('en') if isinstance(o,dict) else o) or ''
last_city=None
for i,d in enumerate(G.get('days',[])):
    text=' '.join([_en(d.get('title')),_en(d.get('place')),_en(d.get('meet'))]+[_en(p[1]) for p in (d.get('plan') or []) if len(p)>1]).lower()
    h=d.get('hotel');city=None
    if isinstance(h,int) and 0<=h<len(stays): city=(stays[h].get('city') or '').strip()
    if not city or city.lower() not in CITY:
        found=[(text.find(k),k) for k in CITY if text.find(k)>=0]
        city=max(found)[1].title() if found else last_city
    if 'wx' not in d:
        wx=[];seen=set()
        for k,(nm,la,lo) in MOUNT.items():
            if k in text and nm not in seen and len(wx)<1: wx.append({'n':nm,'lat':la,'lon':lo,'m':0 if k=='kok-tobe' else 1});seen.add(nm)
        if city and city.lower() in CITY:
            la,lo=CITY[city.lower()];wx.append({'n':city,'lat':la,'lon':lo,'m':0})
        tl=_en(d.get('title')).lower();ft=sorted((tl.find(k),k) for k in CITY if tl.find(k)>=0)
        if len(wx)<2 and ft and (not city or ft[0][1]!=city.lower()) and CITY[ft[0][1]]!=CITY.get((city or '').lower()):
            k=ft[0][1];wx.insert(0,{'n':k.title(),'lat':CITY[k][0],'lon':CITY[k][1],'m':0})
        if wx: d['wx']=wx
    if 'holy' not in d and HOLY.search(text): d['holy']=1
    if 'sig' not in d:
        sg=sorted({v for k,v in SIG.items() if k in text})
        if sg: d['sig']=sg
    if city: last_city=city
# --- 📍 места сбора (решение владельца 13.11.2026): days[i].pts=[{t,n:{en,..},lat,lon,ph}] или days[i].back — текст клетки «Сбор обратно»
# строка: «12:30 Green Bazaar, main entrance 43.2630, 76.9531» (координаты или ссылка Google Maps с @lat,lon / q=lat,lon); каждая строка — отдельная точка
CO=re.compile(r'(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})')
def _ph(path):
    try:
        from PIL import Image,ImageOps;import io
        im=ImageOps.exif_transpose(Image.open(path)).convert('RGB');im.thumbnail((560,560))
        b=io.BytesIO();im.save(b,'JPEG',quality=62,optimize=True,progressive=True)
        return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
    except Exception as e: warn.append(f'фото места сбора не прочиталось: {path} ({e})');return None
for i,d in enumerate(G.get('days',[])):
    raw=d.pop('back',None)
    if raw and not d.get('pts'):
        pts=[]
        for ln in str(raw).splitlines():
            ln=ln.strip()
            if not ln or ln=='?': continue
            t=re.search(r'\b([01]?\d|2[0-3])[:.]([0-5]\d)\b',ln);m=CO.search(ln)
            nm=re.sub(r'https?://\S+','',ln)
            if m: nm=nm.replace(m.group(0),'')
            if t: nm=nm.replace(t.group(0),'',1)
            nm=re.sub(r'^[\s—–\-·,:|]+|[\s—–\-·,:|]+$','',nm).strip()
            pt={'n':{'en':nm}}
            if t: pt['t']=f'{int(t.group(1)):02d}:{t.group(2)}'
            if not m: warn.append(f'день {i+1}: «{ln}» — нет координат, карточку сбора не делаю');continue
            pt['lat'],pt['lon']=float(m.group(1)),float(m.group(2))
            pts.append(pt)
        if pts: d['pts']=pts
    for k,pt in enumerate(d.get('pts') or []):
        if pt.get('lat') is not None and not (-90<=pt['lat']<=90 and -180<=pt['lon']<=180): err.append(f'days[{i}].pts[{k}]: координаты неверные')
        if pt.get('lat') is None: warn.append(f'день {i+1}: место сбора «{_en(pt.get("n"))}» без координат — стрелки не будет')
        if pt.get('ph') and not str(pt['ph']).startswith('data:'):
            v=_ph(pt['ph'])
            if v: pt['ph']=v
            else: pt.pop('ph')
cf=os.path.join(here,'claim_url.txt')
if not G.get('claimUrl') and os.path.exists(cf): G['claimUrl']=open(cf,encoding='utf8').read().strip()
cu=str(G.get('claimUrl','') or '').strip()
if cu and not re.fullmatch(r'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec',cu): err.append('claimUrl: адрес веб-приложения бота …/exec')
sc=str(G.pop('staffCode','') or '').strip()
if G.get('people'):
    if not re.fullmatch(r'\d{6}',sc): err.append('staffCode: 6 цифр (код для гида и агента, B26) — нужен, когда есть people')
    else:
        import hashlib; G['staffHash']=hashlib.sha256((G.get('code','')+':'+sc).encode()).hexdigest()
lg=G.get('logo') or {'mode':'kw'}
imgs=list(lg.get('imgs',[]))
for p in lg.pop('files',[]) or []:
    mt=mimetypes.guess_type(p)[0] or 'image/png'
    imgs.append(f'data:{mt};base64,'+base64.b64encode(open(p,'rb').read()).decode())
lg['imgs']=imgs;G['logo']=lg
if lg.get('mode') in ('agent','two','kw+agent') and not imgs: warn.append('логотип агента выбран, но файла нет')
if err:
    print('ОШИБКИ:\n- '+'\n- '.join(err));sys.exit(1)
t=open(os.path.join(here,'template.html'),encoding='utf8').read()
data=json.dumps(G,ensure_ascii=False).replace('</','<\\/')
esc=lambda s:s.replace('&','&amp;').replace('<','&lt;')
t=t.replace('/*__G__*/null',data,1).replace('__TITLE__',esc(G['title']),1).replace('__LANG__',G['lang'],1)
open(out,'w',encoding='utf8').write(t)
for w in warn: print('ВНИМАНИЕ:',w)
print('ok',out,len(t),'дней',n,'отелей',len(stays),'туристов',len(G.get('people',[]) or []))

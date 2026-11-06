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

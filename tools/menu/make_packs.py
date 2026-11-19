# Офлайн-копия меню на Диске: картинки упакованы в js-файлы (≤ 2 МБ каждый — лимит загрузки).
import os,io,base64,json,sys
from PIL import Image
src='/home/claude/trip/menu'; out=sys.argv[1]; LIM=2_000_000
os.makedirs(out+'/imgpack',exist_ok=True)
def enc(path,maxw,q):
    im=Image.open(path).convert('RGB')
    if im.width>maxw: im=im.resize((maxw,round(im.height*maxw/im.width)),Image.LANCZOS)
    b=io.BytesIO(); im.save(b,'JPEG',quality=q,optimize=True,progressive=True)
    return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
def write(name,m):
    parts=[[]]; size=0
    for k,v in m.items():
        if size+len(v)>LIM and parts[-1]: parts.append([]); size=0
        parts[-1].append((k,v)); size+=len(v)
    for i,pt in enumerate(parts,1):
        js='window.KWIMG=window.KWIMG||{};Object.assign(KWIMG,'+json.dumps(dict(pt),separators=(',',':'))+');'
        if i==1: js='window.KWMORE=window.KWMORE||{};KWMORE[%s]=%d;'%(json.dumps(name),len(parts)-1)+js
        fn='%s%s.js'%(name,'' if i==1 else '.%d'%i)
        open(out+'/imgpack/'+fn,'w').write(js); print(fn,len(js)//1024,'KB')
for d in sorted(os.listdir(src+'/img')):
    write(d,{('img/%s/%s'%(d,f)):enc(src+'/img/%s/%s'%(d,f),480,74) for f in sorted(os.listdir(src+'/img/'+d))})
for d in sorted(os.listdir(src+'/pages')):
    write('pages-'+d,{('pages/%s/%s'%(d,f)):enc(src+'/pages/%s/%s'%(d,f),1300,68) for f in sorted(os.listdir(src+'/pages/'+d))})

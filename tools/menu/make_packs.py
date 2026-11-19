import os,io,base64,json,glob,sys
from PIL import Image
src='/home/claude/trip/menu'; out=sys.argv[1]; os.makedirs(out+'/imgpack',exist_ok=True)
def enc(path,maxw,q):
    im=Image.open(path).convert('RGB')
    if im.width>maxw: im=im.resize((maxw,round(im.height*maxw/im.width)),Image.LANCZOS)
    b=io.BytesIO(); im.save(b,'JPEG',quality=q,optimize=True,progressive=True)
    return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
tot=0
for d in sorted(os.listdir(src+'/img')):
    m={('img/%s/%s'%(d,f)):enc(src+'/img/%s/%s'%(d,f),480,74) for f in sorted(os.listdir(src+'/img/'+d))}
    js='window.KWIMG=window.KWIMG||{};Object.assign(KWIMG,'+json.dumps(m,separators=(',',':'))+');'
    open(out+'/imgpack/%s.js'%d,'w').write(js); tot+=len(js); print(d,len(m),len(js)//1024,'KB')
for d in sorted(os.listdir(src+'/pages')):
    m={('pages/%s/%s'%(d,f)):enc(src+'/pages/%s/%s'%(d,f),1300,68) for f in sorted(os.listdir(src+'/pages/'+d))}
    js='window.KWIMG=window.KWIMG||{};Object.assign(KWIMG,'+json.dumps(m,separators=(',',':'))+');'
    open(out+'/imgpack/pages-%s.js'%d,'w').write(js); tot+=len(js); print('pages',d,len(m),len(js)//1024,'KB')
print('total MB',tot/1e6)

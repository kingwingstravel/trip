"""Download the owner's archive of original restaurant menus from Drive (temporary link access),
unpack, and prepare: inventory + page previews (step=inventory). Results go to branch menu-src."""
import json, os, re, subprocess, zipfile, shutil, glob, io
import requests
from PIL import Image
job=json.load(open('tools/menu/src_job.json'))
OUT='/tmp/menu_out'; os.makedirs(OUT,exist_ok=True)
W='/tmp/w'; os.makedirs(W,exist_ok=True)
log=[]
def sh(c): 
    r=subprocess.run(c,shell=True,capture_output=True); return (r.stdout+r.stderr).decode('utf-8','replace')
# --- download
fid=job['drive_id']; arc=f'{W}/arc.bin'
s=requests.Session()
u=f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t'
with s.get(u,stream=True,timeout=600) as r:
    log.append(f'download status {r.status_code} type {r.headers.get("content-type")}')
    with open(arc,'wb') as f:
        for ch in r.iter_content(1<<20): f.write(ch)
log.append(f'size {os.path.getsize(arc)}')
log.append(sh(f'file {arc}'))
# --- unpack (zip; nested zips too)
X=f'{W}/x'; os.makedirs(X,exist_ok=True)
log.append(sh(f'7z x -y -o{X} {arc} | tail -3'))
for z in glob.glob(f'{X}/**/*.zip',recursive=True):
    log.append(sh(f'7z x -y -o"{z}_x" "{z}" | tail -2'))
files=[p for p in glob.glob(f'{X}/**/*',recursive=True) if os.path.isfile(p)]
inv=[]
os.makedirs(f'{OUT}/prev',exist_ok=True)
for i,p in enumerate(sorted(files)):
    rel=os.path.relpath(p,X); ext=os.path.splitext(p)[1].lower(); size=os.path.getsize(p)
    e={'i':i,'path':rel,'ext':ext,'size':size}
    if ext=='.pdf':
        info=sh(f'pdfinfo "{p}"'); m=re.search(r'Pages:\s+(\d+)',info); e['pages']=int(m.group(1)) if m else None
        txt=sh(f'pdftotext -l 3 "{p}" - | head -c 600'); e['text']=re.sub(r'\s+',' ',txt)[:400]
        e['imgs']=sh(f'pdfimages -list "{p}" | tail -n +3 | wc -l').strip()
        # previews of every page, small
        d=f'{OUT}/prev/{i:03d}'; os.makedirs(d,exist_ok=True)
        sh(f'pdftoppm -r 40 -jpeg -jpegopt quality=60 "{p}" "{d}/p"')
    elif ext in ('.jpg','.jpeg','.png','.webp','.heic'):
        try:
            im=Image.open(p).convert('RGB'); e['wh']=im.size; im.thumbnail((360,360))
            os.makedirs(f'{OUT}/prev',exist_ok=True); im.save(f'{OUT}/prev/{i:03d}.jpg',quality=60)
        except Exception as ex: e['err']=str(ex)
    inv.append(e)
json.dump(inv,open(f'{OUT}/inventory.json','w'),ensure_ascii=False,indent=1)
# keep the unpacked originals for the next step (cache between runs is not possible; save list only)
open(f'{OUT}/log.txt','w').write('\n'.join(log))
print('\n'.join(log)); print(len(inv),'files')

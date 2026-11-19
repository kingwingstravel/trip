"""Menus where one big photo holds several dishes (Paradise): crop a square around each dish-name label.
Names to look for: tools/menu/label_names.json {file_index: [names]}"""
import json, os, io, glob, re
import fitz
from PIL import Image
X='/tmp/w/x'; OUT='/tmp/menu_out'; os.makedirs(f'{OUT}/labels',exist_ok=True)
files=sorted(p for p in glob.glob(f'{X}/**/*',recursive=True) if os.path.isfile(p))
want=json.load(open('tools/menu/label_names.json'))
def norm(s): s=(s or '').lower().replace('ё','е'); s=re.sub(r'[^a-zа-я ]',' ',s); return ' '.join(s.split())
res=[]
for fi,names in want.items():
    fi=int(fi); doc=fitz.open(files[fi]); N={norm(n):n for n in names}
    for pno,page in enumerate(doc):
        pr=page.rect; lines=[]
        for bl in page.get_text('dict')['blocks']:
            for ln in bl.get('lines',[]):
                tx=' '.join(sp['text'] for sp in ln['spans']).strip()
                if tx: lines.append((tx,fitz.Rect(ln['bbox'])))
        for i,(tx,b) in enumerate(lines):
            cands=[(tx,b)]
            if i+1<len(lines) and abs(lines[i+1][1].y0-b.y1)<6: cands.append((tx+' '+lines[i+1][0], b|lines[i+1][1]))
            for t,bb in cands:
                n=norm(t)
                if n in N:
                    half=pr.height*0.21
                    cx=(bb.x0+bb.x1)/2; cy=(bb.y0+bb.y1)/2
                    for tag,dx in (('c',0),('l',-half*0.7),('r',half*0.7)):
                        r=fitz.Rect(cx+dx-half,cy-half,cx+dx+half,cy+half)&pr
                        pix=page.get_pixmap(clip=r,dpi=150); im=Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB'); im.thumbnail((560,560))
                        fn=f'labels/{fi:03d}_{pno+1:03d}_{i:03d}{tag}.jpg'; im.save(f'{OUT}/{fn}',quality=80)
                        res.append({'name':N[n],'page':pno+1,'img':fn,'tag':tag})
json.dump(res,open(f'{OUT}/labels.json','w'),ensure_ascii=False,indent=0); print('labels',len(res))

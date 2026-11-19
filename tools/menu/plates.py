"""Find round plates on menu pages (e.g. Paradise: several dishes per big page photo),
crop each plate and attach the nearest text lines (dish names). Output: /tmp/menu_out/plates/..., plates.json"""
import json, os, io, glob, re
import fitz, numpy as np, cv2
from PIL import Image
job=json.load(open('tools/menu/src_job.json'))
X='/tmp/w/x'; OUT='/tmp/menu_out'; os.makedirs(f'{OUT}/plates',exist_ok=True)
files=sorted(p for p in glob.glob(f'{X}/**/*',recursive=True) if os.path.isfile(p))
res=[]
for fi in job.get('plate_files',[]):
    p=files[fi]; doc=fitz.open(p)
    for pno,page in enumerate(doc):
        pr=page.rect; z=110/72
        pix=page.get_pixmap(dpi=110); img=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.h,pix.w,pix.n)[:,:,:3].copy()
        g=cv2.medianBlur(cv2.cvtColor(img,cv2.COLOR_RGB2GRAY),5)
        H=pix.h
        cs=cv2.HoughCircles(g,cv2.HOUGH_GRADIENT,dp=1.2,minDist=int(H*0.16),param1=120,param2=55,minRadius=int(H*0.09),maxRadius=int(H*0.30))
        if cs is None: continue
        lines=[]
        for bl in page.get_text('dict')['blocks']:
            for ln in bl.get('lines',[]):
                tx=' '.join(sp['text'] for sp in ln['spans']).strip()
                if tx: lines.append([tx]+[round(v,1) for v in ln['bbox']])
        for k,(cx,cy,r) in enumerate(np.round(cs[0]).astype(int)):
            x0,y0,x1,y1=max(0,cx-r),max(0,cy-r),min(pix.w,cx+r),min(H,cy+r)
            if (x1-x0)<r*1.5 or (y1-y0)<r*1.5: continue
            crop=Image.fromarray(img[y0:y1,x0:x1]); 
            hp=page.get_pixmap(clip=fitz.Rect(x0/z,y0/z,x1/z,y1/z),dpi=180)
            crop=Image.open(io.BytesIO(hp.tobytes('png'))).convert('RGB'); crop.thumbnail((640,640))
            fn=f'{fi:03d}_{pno+1:03d}_{k:02d}.jpg'; crop.save(f'{OUT}/plates/{fn}',quality=82)
            pcx,pcy,pr_=cx/z,cy/z,r/z
            near=[]
            for l in lines:
                lx=(l[1]+l[3])/2; ly=(l[2]+l[4])/2
                dd=((lx-pcx)**2+(ly-pcy)**2)**0.5
                if dd<pr_*2.2: near.append(l+[round(dd,1)])
            near.sort(key=lambda l:l[-1])
            res.append({'f':fi,'page':pno+1,'img':'plates/'+fn,'c':[round(pcx),round(pcy),round(pr_)],'lines':near[:25]})
json.dump(res,open(f'{OUT}/plates.json','w'),ensure_ascii=False,indent=0)
print('plates',len(res))

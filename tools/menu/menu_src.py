"""Original restaurant menus (owner's archive) -> dish photo crops + caption text.
Step 1: get originals (Drive link, or artifact restored into /tmp/w/x).
Step 2: for every PDF page, every placed photo -> crop (rendered region) + nearby text
        (text layer, else OCR rus+eng). DOCX: embedded images + following paragraph.
Output (branch menu-src): inventory.json, crops/<file>/<page>_<n>.jpg, crops.json.
Prices are never taken from here (owner rule)."""
import json, os, re, subprocess, glob, io
import requests
from PIL import Image
job=json.load(open('tools/menu/src_job.json'))
OUT='/tmp/menu_out'; os.makedirs(OUT,exist_ok=True)
W='/tmp/w'; X=f'{W}/x'; os.makedirs(X,exist_ok=True)
log=[]
def sh(c):
    r=subprocess.run(c,shell=True,capture_output=True); return (r.stdout+r.stderr).decode('utf-8','replace')
have=[p for p in glob.glob(f'{X}/**/*',recursive=True) if os.path.isfile(p)]
if not have:
    arc=f'{W}/arc.bin'
    u=f"https://drive.usercontent.google.com/download?id={job['drive_id']}&export=download&confirm=t"
    with requests.get(u,stream=True,timeout=900) as r:
        log.append(f'download {r.status_code} {r.headers.get("content-type")}')
        with open(arc,'wb') as f:
            for ch in r.iter_content(1<<20): f.write(ch)
    log.append(f'size {os.path.getsize(arc)} '+sh(f'file {arc}').strip())
    sh(f'7z x -y -o{X} {arc}'); os.remove(arc)
else:
    log.append(f'restored {len(have)} files from artifact')
files=sorted(p for p in glob.glob(f'{X}/**/*',recursive=True) if os.path.isfile(p))
import fitz, pytesseract
def ocr(img):
    try: return pytesseract.image_to_string(img,lang='rus+eng',config='--psm 6')
    except Exception as e: return ''
crops=[]; os.makedirs(f'{OUT}/crops',exist_ok=True)
for fi,p in enumerate(files):
    rel=os.path.relpath(p,X); ext=os.path.splitext(p)[1].lower()
    if ext=='.pdf':
        try: doc=fitz.open(p)
        except Exception as e: log.append(f'open fail {rel} {e}'); continue
        n_ok=0
        for pno,page in enumerate(doc):
            pr=page.rect; parea=pr.width*pr.height
            words=page.get_text('words')
            has_text=len(words)>5
            infos=page.get_image_info(xrefs=True)
            seen=[]
            for k,inf in enumerate(infos):
                b=fitz.Rect(inf['bbox']) & pr
                if b.is_empty: continue
                a=b.width*b.height
                if a<parea*0.006 or a>parea*0.55 or b.width<50 or b.height<50: continue
                if any(abs(b.x0-s.x0)<3 and abs(b.y0-s.y0)<3 for s in seen): continue
                seen.append(b)
                pix=page.get_pixmap(clip=b,dpi=150)
                im=Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')
                im.thumbnail((640,640))
                d=f'{OUT}/crops/{fi:03d}'; os.makedirs(d,exist_ok=True)
                fn=f'{fi:03d}/{pno+1:03d}_{k:02d}.jpg'; im.save(f'{OUT}/crops/{fn}',quality=82)
                # caption region: the photo itself grown a bit, plus a band below and to the sides
                g=fitz.Rect(b.x0-b.width*0.8,b.y0-b.height*0.5,b.x1+b.width*0.8,b.y1+b.height*1.0)&pr
                lines=[]
                if has_text:
                    for bl in page.get_text('dict',clip=g)['blocks']:
                        for ln in bl.get('lines',[]):
                            tx=' '.join(sp['text'] for sp in ln['spans']).strip()
                            if tx: lines.append([tx]+[round(v) for v in ln['bbox']])
                    src='text'
                else:
                    z=200/72; gp=page.get_pixmap(clip=g,dpi=200)
                    gi=Image.open(io.BytesIO(gp.tobytes('png'))).convert('L')
                    try:
                        dd=pytesseract.image_to_data(gi,lang='rus+eng',config='--psm 11',output_type=pytesseract.Output.DICT)
                        grp={}
                        for j,wt in enumerate(dd['text']):
                            if not wt.strip() or float(dd['conf'][j])<30: continue
                            key=(dd['block_num'][j],dd['par_num'][j],dd['line_num'][j])
                            x0=g.x0+dd['left'][j]/z; y0=g.y0+dd['top'][j]/z; x1=x0+dd['width'][j]/z; y1=y0+dd['height'][j]/z
                            if key in grp:
                                a=grp[key]; a[0]+=' '+wt; a[1]=min(a[1],x0); a[2]=min(a[2],y0); a[3]=max(a[3],x1); a[4]=max(a[4],y1)
                            else: grp[key]=[wt,x0,y0,x1,y1]
                        lines=[[a[0]]+[round(v) for v in a[1:]] for a in grp.values()]
                    except Exception as e: lines=[]
                    src='ocr'
                cap=' | '.join(l[0] for l in lines)
                crops.append({'f':fi,'file':rel,'page':pno+1,'img':fn,'bbox':[round(x) for x in b],'page_wh':[round(pr.width),round(pr.height)],
                              'cap':re.sub(r'\s+',' ',cap).strip()[:1500],'lines':lines,'src':src})
                n_ok+=1
        log.append(f'{rel}: {len(doc)} pages, {n_ok} photos')
    elif ext=='.docx':
        try:
            import docx
            from docx.oxml.ns import qn
            D=docx.Document(p); rels=D.part.rels; paras=D.paragraphs; n_ok=0
            texts=[pp.text for pp in paras]
            for i,pp in enumerate(paras):
                for bl in pp._p.iter(qn('a:blip')):
                    rid=bl.get(qn('r:embed'))
                    if not rid or rid not in rels: continue
                    data=rels[rid].target_part.blob
                    try: im=Image.open(io.BytesIO(data)).convert('RGB')
                    except Exception: continue
                    if im.width<120 or im.height<120: continue
                    im.thumbnail((640,640)); fn=f'{fi:03d}/d{i:04d}_{n_ok:03d}.jpg'
                    os.makedirs(f'{OUT}/crops/{fi:03d}',exist_ok=True); im.save(f'{OUT}/crops/{fn}',quality=82)
                    cap=' '.join(t for t in texts[max(0,i-2):i+4] if t.strip())
                    crops.append({'f':fi,'file':rel,'page':i,'img':fn,'cap':re.sub(r'\s+',' ',cap)[:600],'src':'docx'}); n_ok+=1
            log.append(f'{rel}: docx {n_ok} photos')
        except Exception as e: log.append(f'docx fail {rel} {e}')
json.dump(crops,open(f'{OUT}/crops.json','w'),ensure_ascii=False,indent=0)
open(f'{OUT}/log.txt','w').write('\n'.join(log)); print('\n'.join(log)); print('crops',len(crops))

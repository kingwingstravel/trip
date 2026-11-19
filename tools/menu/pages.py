"""Render whole menu pages (for restaurants whose photos show several dishes at once, e.g. Paradise)."""
import json, os, glob
import fitz
X='/tmp/w/x'; OUT='/tmp/menu_out'; os.makedirs(f'{OUT}/pages',exist_ok=True)
files=sorted(p for p in glob.glob(f'{X}/**/*',recursive=True) if os.path.isfile(p))
job=json.load(open('tools/menu/src_job.json'))
for fi in job.get('page_files',[]):
    doc=fitz.open(files[fi])
    for pno,page in enumerate(doc):
        z=min(2.2, 1800/max(page.rect.width,1))
        pix=page.get_pixmap(matrix=fitz.Matrix(z,z))
        pix.save(f'{OUT}/pages/{fi:03d}_{pno+1:03d}.jpg',jpg_quality=72)
print('pages done')

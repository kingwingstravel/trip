"""Fingerprint of a group's source: python3 srchash.py SHEET_VALUES.json [extra text]
Prints sha256 of the sheet values + extra (e.g. logo link) + template.html + build_guide.py.
Same value as g/<code>/src.sha -> nothing changed, do not republish."""
import sys,os,json,hashlib
here=os.path.dirname(os.path.abspath(__file__))
v=json.load(open(sys.argv[1],encoding='utf8'))
if isinstance(v,dict): v=v.get('values',v)
h=hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True).encode())
h.update((sys.argv[2] if len(sys.argv)>2 else '').encode())
for f in ('template.html','build_guide.py','claim_url.txt'):
    fp=os.path.join(here,f)
    if os.path.exists(fp): h.update(open(fp,'rb').read())
print(h.hexdigest())

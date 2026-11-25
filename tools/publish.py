"""Usage: python3 publish.py GUIDE.html CODE PIN "Title" OUT_REPO_DIR [LANG]
LANG (id/en/ru/ms/ko...) — language of the PIN screen (default id; English is always shown too).
Encrypts the guide page under the PIN (AES-GCM, key PBKDF2-SHA256) and writes OUT/g/CODE/index.html + manifest."""
import sys,os,json,base64,secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
src,code,pin,title,out=sys.argv[1:6]
lang=sys.argv[6] if len(sys.argv)>6 else 'id'
LK={'id':('Masukkan PIN dari agen Anda','Buka','PIN salah'),'ru':('Введите PIN от вашего агента','Открыть','Неверный PIN'),'ms':('Masukkan PIN daripada ejen anda','Buka','PIN salah'),'ko':('여행사에서 받은 PIN을 입력하세요','열기','PIN이 틀렸습니다'),'en':('Enter the PIN from your travel agent','Open','Wrong PIN')}
l1=LK.get(lang,LK['en']);l2=LK['en']
pinL=l1[0]+(' · '+l2[0] if l1!=l2 else '');openL=l1[1]+(' · '+l2[1] if l1!=l2 else '');wrongL=l1[2]+(' · '+l2[2] if l1!=l2 else '')
here=os.path.dirname(os.path.abspath(__file__))
h=open(src,encoding='utf8').read()
# 25.11.2026: «Логотип агентства» + файл = только бренд агента (King Wings нигде: экран PIN, значок, баннер, manifest)
import re
_m=re.search(r'"logo": \{"mode": "agent", "imgs": \["(data:image/[^"]+)"',h)
WL=_m.group(1).replace('\\/','/') if _m else None
inj=open(os.path.join(here,'pwa_inject.html')).read();ban=open(os.path.join(here,'banner.html')).read()
d=os.path.join(out,'g',code);os.makedirs(d,exist_ok=True)
ICON='../../icon-192.png';ICONS=[{"src":"../../icon-192.png","sizes":"192x192","type":"image/png"},{"src":"../../icon-512.png","sizes":"512x512","type":"image/png"}]
APPT='King Wings';LOGO_IMG='<img src="../../logo.png" alt="King Wings Travel DMC" style="width:11rem;max-width:70%;height:auto;display:block;margin:0 auto .3rem">'
if WL:
    from PIL import Image;import io
    if not os.path.exists(os.path.join(d,'icon-512.png')):  # свой значок можно положить заранее — тогда не трогаем
        im=Image.open(io.BytesIO(base64.b64decode(WL.split(',',1)[1]))).convert('RGB');bg=im.getpixel((2,2))
        for n in (192,512):
            c=Image.new('RGB',(n,n),bg);w=int(n*.9);hh=max(1,int(im.height*w/im.width));c.paste(im.resize((w,hh),Image.LANCZOS),((n-w)//2,(n-hh)//2));c.save(os.path.join(d,f'icon-{n}.png'))
    if not os.path.exists(os.path.join(d,'icon-192.png')):
        Image.open(os.path.join(d,'icon-512.png')).resize((192,192),Image.LANCZOS).save(os.path.join(d,'icon-192.png'))
    ICON='icon-192.png';ICONS=[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png"}]
    APPT='Trip Guide';LOGO_IMG=f'<img src="{WL}" alt="" style="width:15rem;max-width:85%;height:auto;display:block;margin:0 auto .5rem;border-radius:.5rem">'
    inj=inj.replace('content="King Wings"','content="Trip Guide"').replace('href="../../icon-192.png"','href="icon-192.png"')
    ban=ban.replace('Put King Wings on your home screen','Put the guide on your home screen').replace('Simpan King Wings di layar utama','Simpan panduan di layar utama').replace('Simpan King Wings di skrin utama','Simpan panduan di skrin utama').replace('Поставьте King Wings на главный экран','Поставьте путеводитель на главный экран')
    assert 'King Wings' not in inj+ban, 'King Wings остался в баннере'
h=h.replace('</head>',inj+'</head>',1)
h=h.replace('</body>',ban+'</body>',1)
IT=250000
salt=secrets.token_bytes(16);iv=secrets.token_bytes(12)
key=PBKDF2HMAC(hashes.SHA256(),32,salt,IT).derive(pin.encode())
ct=AESGCM(key).encrypt(iv,h.encode('utf8'),None)
b=lambda x:base64.b64encode(x).decode()
wrap=f'''<!DOCTYPE html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;700&display=swap"><script>/* 15.11: iPhone — без manifest, иначе значок «Домой» открывает адрес без PIN */if(!(/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1))){{const l=document.createElement("link");l.rel="manifest";l.href="manifest.webmanifest";document.head.appendChild(l)}}</script><meta name="theme-color" content="#2D3B62">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="{APPT}"><link rel="apple-touch-icon" href="{ICON}">
<style>body{{margin:0;font:16px/1.4 "IBM Plex Sans",system-ui,-apple-system,Segoe UI,sans-serif;background:#F0F6FF;color:#252E56;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.c{{background:#fff;border-radius:1.2rem;padding:1.6rem 1.3rem;width:min(22rem,90vw);box-shadow:0 8px 30px rgba(37,46,86,.12);text-align:center}}
.k{{font-weight:800;letter-spacing:.12em;font-size:.85rem;color:#2667A8}}h1{{font-size:1.3rem;margin:.6rem 0 1rem}}
input{{font:inherit;font-size:1.8rem;letter-spacing:.4em;text-align:center;width:100%;box-sizing:border-box;padding:.6rem;border:2px solid #D3DFEE;border-radius:.8rem}}
button{{font:inherit;font-weight:700;width:100%;min-height:3rem;margin-top:.9rem;border:0;border-radius:.8rem;background:#4EB1C1;color:#1C2642;font-size:1.05rem}}
.e{{color:#B3261E;min-height:1.4rem;margin-top:.6rem;font-size:.95rem}}.s{{color:#5B6475;font-size:.9rem}}</style></head>
<body><form class="c" id="f">{LOGO_IMG}<h1>{title}</h1>
<label for="p" class="s">{pinL}</label>
<input id="p" inputmode="numeric" autocomplete="off" maxlength="8" style="margin-top:.6rem">
<button>{openL}</button><div class="e" id="e"></div></form>
<script>
const D={{s:"{b(salt)}",i:"{b(iv)}",c:"{b(ct)}",n:{IT}}},K="kw_pin_{code}";
const u=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
async function open_(pin,quiet){{try{{
 const km=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveKey"]);
 const key=await crypto.subtle.deriveKey({{name:"PBKDF2",salt:u(D.s),iterations:D.n,hash:"SHA-256"}},km,{{name:"AES-GCM",length:256}},false,["decrypt"]);
 const pt=await crypto.subtle.decrypt({{name:"AES-GCM",iv:u(D.i)}},key,u(D.c));
 try{{localStorage.setItem(K,pin)}}catch(e){{}}
 try{{history.replaceState(null,"",location.pathname+"?p="+encodeURIComponent(pin))}}catch(e){{}}
 const html=new TextDecoder().decode(pt);document.open();document.write(html);document.close();return true;
}}catch(e){{if(!quiet)document.getElementById("e").textContent="{wrongL}";return false}}}}
document.getElementById("f").onsubmit=e=>{{e.preventDefault();document.getElementById("e").textContent="…";open_(document.getElementById("p").value.trim())}};
let saved=null;try{{saved=localStorage.getItem(K)}}catch(e){{}}
const sq=new URLSearchParams(location.search),qp=sq.get("p"),sp=sq.get("s"),sl=sq.get("l"),sm=sq.get("m"),spt=sq.get("pt");
if(spt){{try{{localStorage.setItem("kw_{code}_ptin",spt)}}catch(e){{}}}}
if(sp){{try{{localStorage.setItem("kw_{code}_s",sp)}}catch(e){{}}}}
try{{if(sl&&localStorage.getItem("kw_{code}_lang")===null)localStorage.setItem("kw_{code}_lang",JSON.stringify(sl));
if(sm&&!sp&&localStorage.getItem("kw_{code}_me")===null)localStorage.setItem("kw_{code}_me",JSON.stringify(sm.split(",")))}}catch(e){{}}
if(qp||sp||sl||sm||spt){{try{{history.replaceState(null,"",location.pathname)}}catch(e){{}}}}
if(qp){{open_(qp,true).then(ok=>{{if(!ok&&saved)open_(saved,true)}})}}
else if(saved)open_(saved,true);
if("serviceWorker" in navigator){{navigator.serviceWorker.register("../../sw.js",{{scope:"../../"}}).catch(()=>{{}});navigator.serviceWorker.ready.then(r=>{{if(r.active)r.active.postMessage({{kw:"keep",u:location.href}})}}).catch(()=>{{}})}}
</script></body></html>'''
open(os.path.join(d,'index.html'),'w',encoding='utf8').write(wrap)
json.dump({"name":(title if WL else "King Wings · "+title),"short_name":APPT,"start_url":"./","scope":"./","display":"standalone","background_color":"#F0F6FF","theme_color":"#2D3B62",
 "icons":ICONS},open(os.path.join(d,'manifest.webmanifest'),'w'),ensure_ascii=False)
print('ok',d,len(wrap))

"""Usage: python3 publish.py GUIDE.html CODE PIN "Title" OUT_REPO_DIR
Encrypts the guide page under the PIN (AES-GCM, key PBKDF2-SHA256) and writes OUT/g/CODE/index.html + manifest."""
import sys,os,json,base64,secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
src,code,pin,title,out=sys.argv[1:6]
here=os.path.dirname(os.path.abspath(__file__))
h=open(src,encoding='utf8').read()
h=h.replace('</head>',open(os.path.join(here,'pwa_inject.html')).read()+'</head>',1)
h=h.replace('</body>',open(os.path.join(here,'banner.html')).read()+'</body>',1)
IT=250000
salt=secrets.token_bytes(16);iv=secrets.token_bytes(12)
key=PBKDF2HMAC(hashes.SHA256(),32,salt,IT).derive(pin.encode())
ct=AESGCM(key).encrypt(iv,h.encode('utf8'),None)
b=lambda x:base64.b64encode(x).decode()
wrap=f'''<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>{title}</title>
<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#1A1F47">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="King Wings"><link rel="apple-touch-icon" href="../../icon-192.png">
<style>body{{margin:0;font:16px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;background:#EEF4F7;color:#1A1F47;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.c{{background:#fff;border-radius:1.2rem;padding:1.6rem 1.3rem;width:min(22rem,90vw);box-shadow:0 8px 30px rgba(26,31,71,.12);text-align:center}}
.k{{font-weight:800;letter-spacing:.12em;font-size:.85rem;color:#2F8FA8}}h1{{font-size:1.3rem;margin:.6rem 0 1rem}}
input{{font:inherit;font-size:1.8rem;letter-spacing:.4em;text-align:center;width:100%;box-sizing:border-box;padding:.6rem;border:2px solid #C9D6DE;border-radius:.8rem}}
button{{font:inherit;font-weight:700;width:100%;min-height:3rem;margin-top:.9rem;border:0;border-radius:.8rem;background:#1A1F47;color:#fff;font-size:1.05rem}}
.e{{color:#B3261E;min-height:1.4rem;margin-top:.6rem;font-size:.95rem}}.s{{color:#5B6475;font-size:.9rem}}</style></head>
<body><form class="c" id="f"><div class="k">KING WINGS TRAVEL</div><h1>{title}</h1>
<label for="p" class="s">Masukkan PIN dari agen Anda · Enter the PIN from your travel agent</label>
<input id="p" inputmode="numeric" autocomplete="off" maxlength="8" style="margin-top:.6rem">
<button>Buka · Open</button><div class="e" id="e"></div></form>
<script>
const D={{s:"{b(salt)}",i:"{b(iv)}",c:"{b(ct)}",n:{IT}}},K="kw_pin_{code}";
const u=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
async function open_(pin,quiet){{try{{
 const km=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveKey"]);
 const key=await crypto.subtle.deriveKey({{name:"PBKDF2",salt:u(D.s),iterations:D.n,hash:"SHA-256"}},km,{{name:"AES-GCM",length:256}},false,["decrypt"]);
 const pt=await crypto.subtle.decrypt({{name:"AES-GCM",iv:u(D.i)}},key,u(D.c));
 try{{localStorage.setItem(K,pin)}}catch(e){{}}
 const html=new TextDecoder().decode(pt);document.open();document.write(html);document.close();return true;
}}catch(e){{if(!quiet)document.getElementById("e").textContent="PIN salah · Wrong PIN";return false}}}}
document.getElementById("f").onsubmit=e=>{{e.preventDefault();document.getElementById("e").textContent="…";open_(document.getElementById("p").value.trim())}};
let saved=null;try{{saved=localStorage.getItem(K)}}catch(e){{}}
if(saved)open_(saved,true);
if("serviceWorker" in navigator)navigator.serviceWorker.register("../../sw.js",{{scope:"../../"}}).catch(()=>{{}});
</script></body></html>'''
d=os.path.join(out,'g',code);os.makedirs(d,exist_ok=True)
open(os.path.join(d,'index.html'),'w',encoding='utf8').write(wrap)
json.dump({"name":"King Wings · "+title,"short_name":"King Wings","start_url":"./","scope":"./","display":"standalone","background_color":"#EEF4F7","theme_color":"#1A1F47",
 "icons":[{"src":"../../icon-192.png","sizes":"192x192","type":"image/png"},{"src":"../../icon-512.png","sizes":"512x512","type":"image/png"}]},open(os.path.join(d,'manifest.webmanifest'),'w'),ensure_ascii=False)
print('ok',d,len(wrap))

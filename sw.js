const C="kw-trip-v3";
/* 16.11.2026: запросы к боту (фото, видео, проверка имени) НЕ трогаем и не кэшируем.
   Раньше при слабом интернете вместо списка видео отдавался сохранённый список фото (ignoreSearch: у бота один адрес). */
const BOT=/(^|\.)script\.google\.com$|(^|\.)googleusercontent\.com$/;
/* 16.11.2026: офлайн. Раньше страница группы попадала в кэш только со 2-го открытия —
   турист открыл один раз, ушёл без интернета → «не открывается». Теперь страница сохраняется сразу
   (при установке и по сообщению со страницы), а при слабом интернете через 4 с показывается сохранённая. */
const keep=urls=>caches.open(C).then(c=>Promise.all(urls.map(u=>{u=new URL(u,self.registration.scope);u.search="";u.hash="";
 return fetch(u.href,{cache:"no-cache"}).then(r=>{if(r.ok)return c.put(u.href,r)}).catch(()=>{})})));
const BASE=["logo.png","icon-192.png"];
self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k))))
 .then(()=>self.clients.claim())
 .then(()=>self.clients.matchAll({type:"window",includeUncontrolled:true}))
 .then(cs=>keep(BASE.concat(cs.map(x=>x.url).filter(u=>/\/g\/[^/]+\/?/.test(u)))))));
self.addEventListener("message",e=>{const d=e.data;if(d&&d.kw==="keep"&&d.u)e.waitUntil(keep(BASE.concat([d.u])))});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 let u;try{u=new URL(e.request.url)}catch(x){return}
 if(BOT.test(u.hostname))return;
 const net=caches.open(C).then(c=>fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r}));
 const old=()=>caches.match(e.request,{ignoreSearch:true});
 if(e.request.mode!=="navigate"){e.respondWith(net.catch(()=>old()));return}
 e.respondWith(new Promise(res=>{let done=false;const ok=r=>{if(!done&&r){done=true;res(r)}};
  net.then(ok).catch(()=>old().then(r=>{if(r)ok(r);else if(!done){done=true;res(Response.error())}}));
  setTimeout(()=>old().then(ok),4000)}));
});

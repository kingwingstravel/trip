const C="kw-trip-v2";
/* 16.11.2026: запросы к боту (фото, видео, проверка имени) НЕ трогаем и не кэшируем.
   Раньше при слабом интернете вместо списка видео отдавался сохранённый список фото (ignoreSearch: у бота один адрес). */
const BOT=/(^|\.)script\.google\.com$|(^|\.)googleusercontent\.com$/;
self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 let u;try{u=new URL(e.request.url)}catch(x){return}
 if(BOT.test(u.hostname))return;
 e.respondWith(caches.open(C).then(c=>fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r}).catch(()=>c.match(e.request,{ignoreSearch:true}))));
});

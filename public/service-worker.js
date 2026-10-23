// Network only: no app-shell, customer, photo, token, or API response caching.
// A new version activates without reloading a visitor's active form.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);
  if(request.method!=='GET'||request.mode!=='navigate'||request.headers.has('authorization')||url.origin!==scope.origin
    ||!['', 'index.html'].includes(url.pathname.slice(scope.pathname.length))||!url.pathname.startsWith(scope.pathname))return;
  event.respondWith(fetch(request,{cache:'no-store'}).catch(()=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#003965"><title>Connect to continue | Spray-Net</title><style>body{margin:0;padding:40px 24px;background:#f4f6f6;color:#003965;font:18px/1.6 system-ui,sans-serif;min-height:80vh;display:grid;place-items:center}main{max-width:440px}h1{line-height:1.2}a{color:inherit;font-weight:700;display:inline-block;padding:14px 0}</style><main><p>SPRAY-NET SOUTH CHARLOTTE</p><h1>Connect to continue.</h1><p>Please reconnect to Wi-Fi or your hotspot. Leads, consultations, and visualizations need an internet connection.</p><a href="">Try again</a></main></html>`,{
    status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"}
  })));
});

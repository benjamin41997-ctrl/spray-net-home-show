import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {setupTabletApp} from '../public/pwa.js';

function fixture({mode='tablet',standalone=false,ios=false,secure=true,fullscreen=true}={}){
  const win=new EventTarget(),doc=new EventTarget();
  Object.assign(win,{isSecureContext:secure,matchMedia:()=>({matches:standalone,addEventListener(){}})});
  let fullscreenCalls=0,registration;
  Object.assign(doc,{fullscreenEnabled:fullscreen,documentElement:{requestFullscreen:async options=>{assert.equal(options.navigationUI,'hide');fullscreenCalls++;doc.fullscreenElement=doc.documentElement;}}});
  const nav={standalone:ios,serviceWorker:{register:async(url,options)=>{registration={url,options};return {};}}};
  const elements=Object.fromEntries(['button','dialog','install','fullscreen','close','status'].map(key=>[key,Object.assign(new EventTarget(),{hidden:true,textContent:''})]));
  elements.dialog.showModal=()=>{elements.dialog.open=true;};elements.dialog.close=()=>{elements.dialog.open=false;};
  setupTabletApp({mode,...elements,window:win,document:doc,navigator:nav});
  const click=key=>elements[key].dispatchEvent(new Event('click'));
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return{win,doc,...elements,click,settle,get registration(){return registration;},get fullscreenCalls(){return fullscreenCalls;}};
}

test('tablet installation uses a stable repository-scoped worker without reloading an active visitor',async()=>{
  const f=fixture();await f.settle();assert.equal(f.button.hidden,false);
  assert.equal(f.registration.url.pathname.endsWith('/public/service-worker.js'),true);
  assert.equal(f.registration.options.scope,new URL('../public/',import.meta.url).href);
  assert.equal(f.registration.options.updateViaCache,'none');
  f.click('button');assert.equal(f.dialog.open,true);assert.equal(f.install.hidden,true);
  f.click('close');assert.equal(f.dialog.open,false);
  f.click('button');f.click('fullscreen');await f.settle();assert.equal(f.fullscreenCalls,1);assert.equal(f.dialog.open,false);
  assert.equal(f.fullscreen.hidden,true);
});

test('native install prompts are explicit, single use and hide after successful installation',async()=>{
  const f=fixture();let prompts=0;
  const event=new Event('beforeinstallprompt',{cancelable:true});
  event.prompt=async()=>{prompts++;};event.userChoice=Promise.resolve({outcome:'accepted'});
  f.win.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(prompts,0);assert.equal(f.install.hidden,false);
  f.click('button');f.click('install');await f.settle();assert.equal(prompts,1);assert.equal(f.button.hidden,true);assert.equal(f.dialog.open,false);
  f.click('install');await f.settle();assert.equal(prompts,1);
});

test('phone layouts and installed tablet apps have no installation clutter; denied fullscreen keeps instructions available',async()=>{
  const mobile=fixture({mode:'mobile'});await mobile.settle();assert.equal(mobile.registration,undefined);assert.equal(mobile.button.hidden,true);
  for(const options of [{standalone:true},{ios:true}])assert.equal(fixture(options).button.hidden,true);
  const insecure=fixture({secure:false});await insecure.settle();assert.equal(insecure.registration,undefined);
  const f=fixture();f.doc.documentElement.requestFullscreen=async()=>{throw new Error('Denied');};
  f.click('button');f.click('fullscreen');await f.settle();assert.equal(f.dialog.open,true);assert.match(f.status.textContent,/home-screen icon/);
});

test('manifest starts a public tablet session with in-scope identity and correctly sized branded icons',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../public/app.webmanifest',import.meta.url),'utf8'));
  const base=new URL('https://example.com/spray-net-home-show/app.webmanifest');
  const start=new URL(manifest.start_url,base);assert.equal(start.search,'?mode=tablet');assert.equal(start.hash,'');
  assert.equal(new URL(manifest.scope,base).pathname,'/spray-net-home-show/');
  assert.equal(new URL(manifest.id,base).pathname,'/spray-net-home-show/');
  assert.equal(manifest.display,'fullscreen');assert.deepEqual(manifest.display_override,['fullscreen','standalone']);
  for(const size of [192,512])assert.ok(manifest.icons.some(icon=>icon.sizes===`${size}x${size}`&&icon.purpose==='any'));
  for(const icon of [...manifest.icons,{src:'./assets/apple-touch-icon.png',sizes:'180x180'}]){
    const png=await readFile(new URL('../public/'+icon.src,import.meta.url));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes);
  }
});

test('worker never intercepts API/auth/media/other-repository traffic and makes no persistent caches',async()=>{
  const source=await readFile(new URL('../public/service-worker.js',import.meta.url),'utf8');
  const handlers=new Map(),calls=[];
  const self={registration:{scope:'https://example.com/spray-net-home-show/'},addEventListener:(name,fn)=>handlers.set(name,fn),skipWaiting:async()=>{},clients:{claim:async()=>{}}};
  vm.runInNewContext(source,{self,URL,Response,fetch:async(request,options)=>{calls.push({request,options});throw new Error('Offline');}});
  for(const request of [
    {url:'https://api.example/api/leads/secret/session',method:'GET',mode:'cors'},
    {url:'https://example.com/spray-net-home-show/api/private',method:'GET',mode:'navigate'},
    {url:'https://example.com/spray-net-home-show/admin.html',method:'GET',mode:'navigate'},
    {url:'https://example.com/spray-net-portfolio/',method:'GET',mode:'navigate'},
    {url:'https://example.com/spray-net-home-show/',method:'POST',mode:'navigate'},
    {url:'https://example.com/spray-net-home-show/',method:'GET',mode:'navigate',auth:true}
  ]){
    let intercepted=false;handlers.get('fetch')({request:{...request,headers:new Headers(request.auth?{Authorization:'Bearer private'}:{})},respondWith:()=>{intercepted=true;}});
    assert.equal(intercepted,false);
  }
  let pending;const url='https://example.com/spray-net-home-show/?mode=tablet';
  handlers.get('fetch')({request:{url,method:'GET',mode:'navigate',headers:new Headers()},respondWith:value=>{pending=value;}});
  const response=await pending;assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.match(await response.text(),/Connect to continue/);assert.equal(calls.length,1);assert.equal(calls[0].options.cache,'no-store');
  assert.doesNotMatch(source,/caches\.|indexedDB|localStorage|\.reload\(/);
});

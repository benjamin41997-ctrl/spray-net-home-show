import test from 'node:test';
import assert from 'node:assert/strict';
import {addressResponse} from '../backend/address-response.mjs';
import {addressSuggestions} from '../backend/address.mjs';
import {requestAddressSuggestions} from '../public/address-client.js';

const source=url=>new URL(url).hostname==='services.nconemap.gov'?'nc':String(url).includes('LC_Addresses')?'lancaster':'york';
const data={
 nc:{attributes:{st_address:'101 MAIN ST',post_comm:'BELMONT',post_code:'28012',state:'NC',county:'GASTON',ddlong:-80.9,ddlat:35.1}},
 york:{attributes:{WHOLE_ADDRESS:'101 MAIN ST',POST_COMM:'FORT MILL',POST_CODE:'29715',STATE:'SC',COUNTY:'York'},geometry:{x:-80.9,y:35.1}},
 lancaster:{attributes:{WHOLE_ADDR:'101 MAIN ST',POSTAL_TOW:'INDIAN LAND',POSTAL_ZIP:'29707',POSTAL_STA:'SC',COUNTY:'LANCASTER'},geometry:{x:-80.85,y:34.98}}
};
const req=()=>new Request('https://api.example/api/addresses/suggest',{headers:{Accept:'application/x-ndjson',Authorization:'Bearer private-visitor-token',Cookie:'private=cookie'}});
const parse=chunk=>JSON.parse(new TextDecoder().decode(chunk.value).trim());
async function drain(reader){const rows=[];while(true){const value=await reader.read();if(value.done)return rows;rows.push(parse(value));}}
function cacheFixture(){const entries=new Map();return{entries,async match(key){return entries.get(key.url)?.clone();},async put(key,value){entries.set(key.url,value.clone());}};}

test('stream sends a real first county immediately and later includes slower NC and SC matches',async()=>{
 const waiting=new Map(),headers=[];
 const response=await addressResponse({}, {query:'101 ma'},req(),undefined,{fetcher:(url,init)=>new Promise(resolve=>{
  waiting.set(source(url),resolve);headers.push(init.headers);
 })});
 assert.match(response.headers.get('Content-Type'),/application\/x-ndjson/);
 const reader=response.body.getReader();assert.equal(parse(await reader.read()).done,false);
 waiting.get('york')(Response.json({features:[data.york]}));
 const first=parse(await reader.read());assert.deepEqual(first.suggestions.map(value=>value.city),['Fort Mill']);assert.equal(first.done,false);
 assert.ok(waiting.has('nc'),'The first results arrived while NC is still unresolved.');
 waiting.get('nc')(Response.json({features:[data.nc]}));waiting.get('lancaster')(Response.json({features:[data.lancaster]}));
 const rows=await drain(reader),last=rows.at(-1);
 assert.equal(last.done,true);assert.deepEqual(last.suggestions.map(value=>value.city),['Belmont','Fort Mill','Indian Land']);
 assert.ok(!JSON.stringify(rows).includes('private'));for(const header of headers)assert.deepEqual(header,{Accept:'application/json'});
});

test('stream cancellation aborts every pending county; invalid input never starts a stream',async()=>{
 const signals=[],tasks=[],context={waitUntil:task=>tasks.push(task)};
 const response=await addressResponse({}, {query:'101 ma'},req(),context,{fetcher:(_,init)=>new Promise((_,reject)=>{
  signals.push(init.signal);init.signal.addEventListener('abort',()=>reject(new Error('provider-aborted')),{once:true});
 })});
 const reader=response.body.getReader();await reader.read();await reader.cancel();await Promise.all(tasks);
 assert.equal(signals.length,3);assert.ok(signals.every(signal=>signal.aborted));
 let calls=0;await assert.rejects(addressResponse({}, {query:'101 %'},req(),undefined,{fetcher:()=>{calls++;}}),error=>error.status===400);
 assert.equal(calls,0);
});

test('progressive responses retain a larger real candidate pool while older JSON stays limited to eight suggestions',async()=>{
 const fetcher=async url=>Response.json({features:Array.from({length:20},(_,index)=>{
  const record=structuredClone(data[source(url)]),key=source(url)==='nc'?'st_address':source(url)==='york'?'WHOLE_ADDRESS':'WHOLE_ADDR';
  record.attributes[key]=`101 MAIN STREET ${index}`;return record;
 })});
 const progressive=await addressResponse({}, {query:'101 ma'},req(),undefined,{fetcher});
 const rows=(await progressive.text()).trim().split('\n').map(JSON.parse);assert.equal(rows.at(-1).suggestions.length,60);
 assert.equal((await addressSuggestions({}, {query:'101 ma'},req(),fetcher)).suggestions.length,8);
});

test('a stream provider outage contains only a safe error and can be retried',async()=>{
 const response=await addressResponse({}, {query:'101 ma'},req(),undefined,{fetcher:async()=>{throw new Error('private upstream details');}});
 const text=await response.text(),rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(rows.at(-1).error.code,'ADDRESS_LOOKUP_UNAVAILABLE');assert.ok(!text.includes('private upstream'));
});

test('provider cache reuses normalized public matches under hashed keys without retaining contact fields or credentials',async()=>{
 const cache=cacheFixture(),request=req();let calls=0;
 const fetcher=async url=>{calls++;return Response.json({features:[data[source(url)]]});};
 const first=await addressSuggestions({}, {query:'101 ma',name:'Private Name',email:'private@example.com'},request,fetcher,{cache});
 const second=await addressSuggestions({}, {query:'101 MA'},request,fetcher,{cache});
 assert.deepEqual(first,second);assert.equal(calls,3);assert.equal(cache.entries.size,3);
 for(const [key,response] of cache.entries){
  assert.match(key,/^https:\/\/api\.example\/__address-cache\/v1\/[a-f0-9]{64}$/);
  assert.equal(response.headers.get('Cache-Control'),'public, max-age=600');
  const text=await response.clone().text();assert.ok(!/Private Name|private@example|Bearer|cookie|owner|ddlong/i.test(text));
 }
 let misses=0;await addressSuggestions({}, {query:'101 mai'},request,async url=>{misses++;return fetcher(url);},{cache});assert.equal(misses,3);
});

test('cache outages fall back to GIS; provider errors are not cached and empty results expire sooner',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({features:[]});};
 const broken={async match(){throw new Error('cache offline');},async put(){throw new Error('cache offline');}};
 assert.deepEqual((await addressSuggestions({}, {query:'101 ma'},req(),fetcher,{cache:broken})).suggestions,[]);assert.equal(calls,3);
 const cache=cacheFixture();await addressSuggestions({}, {query:'101 ma'},req(),fetcher,{cache});
 for(const response of cache.entries.values())assert.equal(response.headers.get('Cache-Control'),'public, max-age=30');
 const errors=cacheFixture();await assert.rejects(addressSuggestions({}, {query:'101 ma'},req(),async()=>{throw new Error('offline');},{cache:errors}));assert.equal(errors.entries.size,0);
});

test('address transport emits split streaming chunks progressively and keeps credentials out of its request',async()=>{
 const first={suggestions:[{display:'101 Main St, Belmont, NC 28012'}],done:false},last={...first,done:true};
 let output,complete;const ready=new Promise(resolve=>{complete=resolve;}),updates=[];
 const result=requestAddressSuggestions('https://api.example','101 ma',{onUpdate:value=>{updates.push(value);complete();},fetcher:async(url,init)=>{
  assert.equal(url,'https://api.example/api/addresses/suggest');assert.equal(init.headers.Accept,'application/x-ndjson');assert.equal(init.headers.Authorization,undefined);assert.deepEqual(JSON.parse(init.body),{query:'101 ma'});
  return new Response(new ReadableStream({start(controller){output=controller;}}),{headers:{'Content-Type':'application/x-ndjson'}});
 }});
 const encoded=new TextEncoder().encode(JSON.stringify(first)+'\n');output.enqueue(encoded.slice(0,17));output.enqueue(encoded.slice(17));
 await ready;assert.equal(updates.length,1);assert.equal(updates[0].done,false);
 output.enqueue(new TextEncoder().encode(JSON.stringify(last)+'\n'));output.close();assert.deepEqual(await result,last);
});

test('address transport supports older JSON and rejects failed or interrupted streams without inventing results',async()=>{
 const value={suggestions:[]};assert.deepEqual(await requestAddressSuggestions('https://api.example','101',{fetcher:async()=>Response.json(value)}),value);
 await assert.rejects(requestAddressSuggestions('https://api.example','101',{fetcher:async()=>Response.json({error:{code:'ADDRESS_RATE_LIMIT',message:'Busy'}},{status:429})}),error=>error.status===429 && error.code==='ADDRESS_RATE_LIMIT');
 for(const body of ['{"suggestions":[],"done":false}\n','not-json\n','{"suggestions":"bad","done":true}\n','x'.repeat(128*1024+1)])
  await assert.rejects(requestAddressSuggestions('https://api.example','101',{fetcher:async()=>new Response(body,{headers:{'Content-Type':'application/x-ndjson'}})}));
});

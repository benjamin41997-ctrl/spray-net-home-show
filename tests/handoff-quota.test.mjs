import test from 'node:test';
import assert from 'node:assert/strict';
import {tabletHandoff} from '../public/tablet-handoff.js';
import {parseStudioAccess} from '../public/access.js';
import {createVisitorStorage} from '../public/visitor-storage.js';
import {renderBalance} from '../public/render-balance.js';
const access={id:'550e8400-e29b-41d4-a716-446655440000',token:'a'.repeat(43)};
const store=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
test('the same booth QR switches from public capture to the exact saved private mobile project and back on reset',()=>{
  const base='https://show.example/home/?mode=tablet&v=release#old';
  const initial=tabletHandoff(base,null);assert.equal(initial.url,'https://show.example/home/?mode=mobile');assert.equal(initial.private,false);
  const handoff=tabletHandoff(base,access),url=new URL(handoff.url);assert.equal(handoff.private,true);assert.equal(url.search,'?mode=mobile');
  assert.deepEqual(parseStudioAccess(url.hash),access);assert.match(handoff.description,/private/);
  const second=tabletHandoff(base,{...access,id:'550e8400-e29b-41d4-a716-446655440001',token:'b'.repeat(43)});
  assert.notEqual(second.url,handoff.url);assert.equal(tabletHandoff(base,null).url,initial.url);
  assert.throws(()=>tabletHandoff(base,{id:'invalid',token:'invalid'}));
});
test('phone handoff preserves saved access but never carries a resettable balance from the kiosk',()=>{
  const persistent=store(),phone=createVisitorStorage('mobile',store(),persistent);
  const handoff=tabletHandoff('https://show.example/?mode=tablet',access),incoming=parseStudioAccess(new URL(handoff.url).hash);
  phone.save({apiBase:'https://api.example',lead:incoming,remainingRenders:999});
  const reopened=createVisitorStorage('mobile',store(),persistent).read();assert.deepEqual(reopened.lead,access);assert.equal(reopened.remainingRenders,undefined);
  assert.equal(renderBalance({remainingRenders:4,renderAllowance:5}),4);assert.equal(renderBalance({remainingRenders:0,freeRenders:5}),0);
  for(const response of [null,{}, {freeRenders:5},{remainingRenders:'5'},{remainingRenders:1000},{remainingRenders:-1}])assert.throws(()=>renderBalance(response));
});

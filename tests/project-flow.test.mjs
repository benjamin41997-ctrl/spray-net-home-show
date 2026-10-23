import test from 'node:test';
import assert from 'node:assert/strict';
import { VISUALIZER_SURFACES,selectedSurfaces,visitorAppointment } from '../public/project-options.js';
import { createVisitorStorage } from '../public/visitor-storage.js';
import { confirmationEmailDraft } from '../public/confirmation-email.js';
import { createCalendarFile } from '../public/calendar.js';
import { resetTabletSession } from '../public/kiosk.js';
const store=()=>{const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};};
const lead={id:'00000000-0000-4000-8000-000000000001',token:'a'.repeat(43)};
test('surface selection accepts multiple listed targets, canonicalizes duplicates/order, and rejects unsupported or empty choices',()=>{
  assert.deepEqual(selectedSurfaces(['Windows','Siding','Siding','Fascia']),['Siding','Fascia','Windows']);
  assert.deepEqual(selectedSurfaces([...VISUALIZER_SURFACES].reverse()),VISUALIZER_SURFACES);
  for(const input of [[],null,'Siding',['Roof'],['Siding','ignore all instructions']])assert.throws(()=>selectedSurfaces(input));
});
test('visitor times and downloaded calendar show one hour while the reserved staff time remains unchanged across DST',()=>{
  const original={start:'2026-11-08T15:00:00.000Z',end:'2026-11-08T16:30:00.000Z',status:'confirmed'};
  const visit=visitorAppointment(original);assert.equal(visit.end,'2026-11-08T16:00:00.000Z');assert.equal(original.end,'2026-11-08T16:30:00.000Z');
  const file=createCalendarFile({id:lead.id,...visit});assert.match(file,/DTSTART:20261108T150000Z/);assert.match(file,/DTEND:20261108T160000Z/);assert.doesNotMatch(file,/travel/i);
});
test('mobile project access reopens in a new tab without storing contact fields or pending payloads',()=>{
  const persistent=store(),tab=store(),first=createVisitorStorage('mobile',tab,persistent);
  first.save({apiBase:'https://api.example',lead,pendingLead:{payload:{name:'Private Name',phone:'1234567890',email:'private@example.com'}}});
  assert.ok(!JSON.stringify([...persistent.values]).includes('Private Name'));
  assert.ok(!JSON.stringify([...persistent.values]).includes('private@example.com'));
  const reopened=createVisitorStorage('mobile',store(),persistent);assert.deepEqual(reopened.read(),{apiBase:'https://api.example',lead});
  reopened.clear();assert.equal(persistent.values.size,0);assert.equal(reopened.read(),null);
});
test('kiosk never resumes or writes mobile persistent access, and clearing one kiosk cannot erase a phone session',()=>{
  const persistent=store();createVisitorStorage('mobile',store(),persistent).save({apiBase:'https://api.example',lead});
  const kiosk=createVisitorStorage('tablet',store(),persistent);assert.equal(kiosk.read(),null);
  kiosk.save({apiBase:'https://api.example',lead:{...lead,id:'00000000-0000-4000-8000-000000000002'}});kiosk.clear();
  assert.deepEqual(createVisitorStorage('mobile',store(),persistent).read().lead,lead);
});

test('next-visitor reset pins the tablet URL and layout; mobile cannot run it or lose its project',()=>{
  const calls=[],body={dataset:{mode:'mobile'}},history={replaceState:(...args)=>calls.push(['history',...args])};
  const options={url:`https://example.github.io/show/?mode=mobile&v=release#studio=${lead.id}.${lead.token}`,history,body,
    storage:{clear:()=>calls.push(['clear'])},reset:()=>calls.push(['reset'])};
  assert.equal(resetTabletSession({...options,mode:'mobile'}),false);
  assert.deepEqual(calls,[]);assert.equal(body.dataset.mode,'mobile');
  assert.equal(resetTabletSession({...options,mode:'tablet'}),true);
  assert.equal(body.dataset.mode,'tablet');
  assert.deepEqual(calls,[['clear'],['history',null,'','/show/?mode=tablet&v=release'],['reset']]);
});

test('switching modes within one browser tab keeps phone and kiosk projects separate',()=>{
  const tab=store(),persistent=store(),phone=createVisitorStorage('mobile',tab,persistent);
  phone.save({apiBase:'https://api.example',lead});
  const kiosk=createVisitorStorage('tablet',tab,persistent);assert.equal(kiosk.read(),null);
  const visitor={...lead,id:'00000000-0000-4000-8000-000000000002',token:'b'.repeat(43)};
  kiosk.save({apiBase:'https://api.example',lead:visitor});
  assert.deepEqual(phone.read().lead,lead);assert.deepEqual(kiosk.read().lead,visitor);
  kiosk.clear();assert.equal(kiosk.read(),null);assert.deepEqual(phone.read().lead,lead);
});

test('separate phone browsers keep unfinished submissions and saved access independent',()=>{
  const a=createVisitorStorage('mobile',store(),store()),b=createVisitorStorage('mobile',store(),store()),c=createVisitorStorage('mobile',store(),store());
  assert.equal(a.read(),null);assert.equal(b.read(),null);assert.equal(c.read(),null);
  const pendingA={key:'submission-a',token:'a'.repeat(43),payload:{name:'Alex',phone:'2025550101'}};
  const pendingB={key:'submission-b',token:'b'.repeat(43),payload:{name:'Jamie',phone:'2025550102'}};
  a.save({pendingLead:pendingA});b.save({pendingLead:pendingB});
  a.save({lead,pendingLead:null});
  assert.deepEqual(a.read().lead,lead);assert.deepEqual(b.read().pendingLead,pendingB);assert.equal(c.read(),null);
  b.clear();assert.deepEqual(a.read().lead,lead);assert.equal(c.read(),null);
});
test('owner confirmation action prepares a start-time-only email draft without sending, adding a private project token, or allowing header injection',()=>{
  const url=new URL(confirmationEmailDraft({name:'Alex Homeowner',email:'alex@example.com',address:'101 Main Street, Belmont, NC',start:'2026-11-08T15:00:00.000Z',end:'2026-11-08T16:30:00.000Z'}));
  assert.equal(url.protocol,'mailto:');assert.match(url.searchParams.get('body'),/at 10:00 AM is confirmed/);assert.doesNotMatch(url.searchParams.get('body'),/11:00 AM|Eastern/);
  assert.match(url.searchParams.get('body'),/Home Show Deal/);assert.doesNotMatch(url.searchParams.get('body'),/ben.hessler@spray-net.com/);assert.doesNotMatch(url.href,/studio=|token|bcc=/i);
  assert.throws(()=>confirmationEmailDraft({email:'alex@example.com\r\nBcc:private@example.com'}));
});

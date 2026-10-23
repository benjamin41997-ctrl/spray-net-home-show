import test from 'node:test';
import assert from 'node:assert/strict';
import { VISUALIZER_SURFACES,selectedSurfaces,visitorAppointment } from '../public/project-options.js';
import { createVisitorStorage } from '../public/visitor-storage.js';
import { confirmationEmailDraft } from '../public/confirmation-email.js';
import { createCalendarFile } from '../public/calendar.js';
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
test('owner confirmation action prepares a one-hour email draft without sending, adding a private project token, or allowing header injection',()=>{
  const url=new URL(confirmationEmailDraft({name:'Alex Homeowner',email:'alex@example.com',address:'101 Main Street, Belmont, NC',start:'2026-11-08T15:00:00.000Z',end:'2026-11-08T16:30:00.000Z'}));
  assert.equal(url.protocol,'mailto:');assert.match(url.searchParams.get('body'),/10:00 AM–11:00 AM Eastern/);
  assert.match(url.searchParams.get('body'),/ben.hessler@spray-net.com/);assert.doesNotMatch(url.href,/studio=|token|bcc=/i);
  assert.throws(()=>confirmationEmailDraft({email:'alex@example.com\r\nBcc:private@example.com'}));
});

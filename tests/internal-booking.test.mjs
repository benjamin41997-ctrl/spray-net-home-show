import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { bookingConfiguration, listConsultationSlots, bookConsultation, verifyConsultation,
  listAdminSchedule, createTimeBlock, deleteTimeBlock, cancelConsultation } from '../backend/internal-booking.mjs';

const schema = readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8');
const now = Date.parse('2026-10-26T12:00:00Z'), start = '2026-10-26T13:00:00.000Z';
function environment(extra = {}) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
  const DB = { sqlite, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results=statements.map(statement=>statement._runSync());sqlite.exec('COMMIT');return results; }
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }, prepare(sql) { const statement = sqlite.prepare(sql); let bindings=[];
    return { bind(...args) { bindings=args; return this; }, async first() { return statement.get(...bindings)||null; },
      async all() { return {results: statement.all(...bindings)}; },
      async run() { return {meta:{changes:Number(statement.run(...bindings).changes)}}; },
      _runSync() { return {meta:{changes:Number(statement.run(...bindings).changes)}}; } };
  }};
  return {DB,BOOKING_PROVIDER:'internal',...extra};
}
function lead(env, extra = {}) {
  const person={id:crypto.randomUUID(),first_name:'Alex',last_name:'Homeowner',phone:'5551234567',email:'alex@example.com',address:'12 Example Street',...extra};
  env.DB.sqlite.prepare(`INSERT INTO leads
    (id,token_hash,lead_identity,phone_normalized,event_id,first_name,last_name,email,phone,address,city,state,zip,service,timeline,notes,event_label,consent_at,consent_version,remaining_renders,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(person.id,'hash',person.id,'15551234567','show',person.first_name,
      person.last_name,person.email,person.phone,person.address,'Charlotte','NC','28201','','','','Show','2026-10-26','v1',3,'2026-10-26');
  return person;
}
const book=(env,person,extra={})=>bookConsultation(env,{lead:person,start,requestKey:'same-booking-request',...extra},{now});

test('internal calendar is available without Microsoft credentials and defaults to every day 08:00–19:00',()=>{
  const config=bookingConfiguration(environment());
  assert.equal(config.available,true); assert.equal(config.provider,'internal'); assert.equal(config.durationMinutes,90);
  assert.equal(config.bufferMinutes,30); assert.equal(config.workStart,480); assert.equal(config.workEnd,1140);
  assert.deepEqual(config.workDays,[0,1,2,3,4,5,6]); assert.equal(bookingConfiguration({}).available,false);
});

test('booking start date is enforced by Eastern calendar day for both slots and direct booking',async()=>{
  const env=environment({BOOKING_START_DATE:'2026-10-26'}),person=lead(env),earlier=Date.parse('2026-10-24T12:00:00Z');
  assert.equal(bookingConfiguration(env).startDate,'2026-10-26');
  const slots=await listConsultationSlots(env,{now:earlier});
  assert.equal(slots.slots[0].start,'2026-10-26T12:00:00.000Z'); // Monday08:00EDT
  await assert.rejects(bookConsultation(env,{lead:person,start:'2026-10-25T13:00:00.000Z',requestKey:'before-start-date'},{now:earlier}),error=>error.code==='INVALID_SLOT');
  assert.equal((await bookConsultation(env,{lead:person,start:'2026-10-26T12:00:00.000Z',requestKey:'on-start-date-key'},{now:earlier})).status,'confirmed');
  const later=await listConsultationSlots(env,{now:Date.parse('2026-11-02T12:00:00Z')});
  assert.equal(later.slots[0].start,'2026-11-02T13:00:00.000Z'); // currentday08:00EST, notstuckonOct26
});

test('invalid booking start dates fail closed, and DST is compared as Eastern dates',async()=>{
  for(const value of ['2026-02-30','2026-13-01','10/26/2026','2026-10-26T00:00:00Z',' 2026-10-26']) {
    const env=environment({BOOKING_START_DATE:value});assert.equal(bookingConfiguration(env).available,false);
    await assert.rejects(listConsultationSlots(env,{now}),error=>error.code==='BOOKING_UNAVAILABLE');
  }
  const env=environment({BOOKING_START_DATE:'2026-11-01'});
  const slots=await listConsultationSlots(env,{now:Date.parse('2026-10-31T12:00:00Z')});
  assert.equal(slots.slots[0].start,'2026-11-01T13:00:00.000Z'); // Sunday08:00ESTafterfallback
});
test('home-show availability includes November 8, respects DST and closes after the configured Eastern end date',async()=>{
  const env=environment({BOOKING_START_DATE:'2026-10-26',BOOKING_END_DATE:'2026-11-08',BOOKING_HORIZON_DAYS:'30'}),person=lead(env);
  const options={now:Date.parse('2026-10-22T12:00:00Z')},data=await listConsultationSlots(env,options);
  assert.equal(data.slots[0].start,'2026-10-26T12:00:00.000Z');
  const last=data.slots.at(-1);assert.equal(last.start,'2026-11-08T22:30:00.000Z');assert.equal(last.end,'2026-11-09T00:00:00.000Z');
  assert.equal((await bookConsultation(env,{lead:person,start:last.start,requestKey:'november-eight-booking'},options)).status,'confirmed');
  await assert.rejects(bookConsultation(env,{lead:lead(env,{phone:'5551239999'}),start:'2026-11-09T14:00:00.000Z',requestKey:'after-event-window'},options),error=>error.code==='INVALID_SLOT');
  assert.deepEqual((await listConsultationSlots(env,{now:Date.parse('2026-11-09T12:00:00Z')})).slots,[]);
  for(const end of ['2026-02-30','2026-10-25','Nov 8'])assert.equal(bookingConfiguration({...env,BOOKING_END_DATE:end}).available,false);
});

test('slot list uses real internal reservations and travel buffers, with latest start 17:30',async()=>{
  const env=environment(), person=lead(env); await book(env,person);
  const result=await listConsultationSlots(env,{now});
  assert.equal(result.slots[0].start,'2026-10-26T15:00:00.000Z'); // 11:00 after 09:00–10:30 +30min
  const monday=result.slots.filter(slot=>slot.start.startsWith('2026-10-26'));
  assert.equal(monday.at(-1).start,'2026-10-26T21:30:00.000Z'); // 17:30 EDT
  assert.equal(monday.at(-1).end,'2026-10-26T23:00:00.000Z');
  assert.equal(JSON.stringify(result).includes(person.phone),false); assert.equal(JSON.stringify(result).includes(person.address),false);
});

test('booking is authoritative in D1, needs a saved lead/address, and makes no external request',async()=>{
  const env=environment(), person=lead(env); let calls=0; const previous=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;throw new Error('No network allowed');};
  try{
    const booked=await book(env,person); assert.equal(booked.status,'confirmed'); assert.equal(calls,0);
    const row=env.DB.sqlite.prepare('SELECT * FROM consultation_bookings').get();
    assert.equal(row.graph_event_id,null); assert.equal(row.calendar_key,'internal:ben.hessler@spray-net.com');
    assert.equal((await verifyConsultation(env,row)).status,'confirmed');
  }finally{globalThis.fetch=previous;}
  await assert.rejects(bookConsultation(env,{lead:{...person,address:''},start,requestKey:'another-key'},{now}),error=>error.code==='INVALID_ADDRESS');
});

test('a phone-only lead stays saved but cannot book internally without a valid consultation email',async()=>{
  const env=environment(),person=lead(env,{email:''});
  for(const email of [undefined,'','   ','invalid']) {
    await assert.rejects(book(env,person,{email}),error=>error.code==='INVALID_EMAIL');
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM consultation_bookings').get().n,0);
    assert.equal(env.DB.sqlite.prepare('SELECT email FROM leads WHERE id=?').get(person.id).email,'');
  }
  assert.equal((await book(env,person,{email:'alex@example.com'})).status,'confirmed');
  assert.equal(env.DB.sqlite.prepare('SELECT email FROM leads WHERE id=?').get(person.id).email,'alex@example.com');
});

test('identical booking retries reuse the same row; changed address parts, slot or key never silently edit it',async()=>{
  const env=environment(),person=lead(env); const original=await book(env,person); assert.deepEqual(await book(env,person),original);
  for(const params of [{requestKey:'different-request'}, {start:'2026-10-26T15:00:00.000Z'}, {lead:{...person,address:'Different address'}},
    {lead:{...person,city:'Matthews'}},{lead:{...person,state:'SC'}},{lead:{...person,zip:'29708'}}])
    await assert.rejects(book(env,person,params),error=>error.code==='ALREADY_BOOKED');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM consultation_bookings').get().n,1);
});

test('phone-first appointment and booking contact details commit together or roll back together',async()=>{
  const env=environment(),person=lead(env,{address:''});
  const requested={...person,address:'New Booking Address',email:'optional@example.com',city:'Fort Mill',state:'sc',zip:'29708'};
  await book(env,requested);
  const saved=env.DB.sqlite.prepare('SELECT address,email,city,state,zip,consultation_preference FROM leads WHERE id=?').get(person.id);
  assert.equal(saved.address,requested.address);assert.equal(saved.email,requested.email);assert.equal(saved.consultation_preference,'schedule_now');
  assert.equal(saved.city,'Fort Mill');assert.equal(saved.state,'SC');assert.equal(saved.zip,'29708');
  const failing=environment(),another=lead(failing,{address:''});
  failing.DB.sqlite.exec("CREATE TRIGGER fail_contact_update BEFORE UPDATE ON leads BEGIN SELECT RAISE(ABORT,'test-contact-write-failure'); END;");
  await assert.rejects(book(failing,{...another,address:'Cannot Persist Address',city:'Fort Mill',state:'SC',zip:'29708'}),/test-contact-write-failure/);
  assert.equal(failing.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM consultation_bookings').get().n,0);
  assert.equal(failing.DB.sqlite.prepare('SELECT address FROM leads').get().address,'');
  assert.deepEqual({...failing.DB.sqlite.prepare('SELECT city,state,zip FROM leads').get()},{city:'Charlotte',state:'NC',zip:'28201'});
  assert.equal(failing.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM booking_calendar_locks').get().n,0);
});

test('concurrent visitors cannot reserve the same slot and SQL conflict checks survive an expired lease',async()=>{
  const env=environment(),a=lead(env),b=lead(env);
  const responses=await Promise.allSettled([book(env,a),book(env,b)]);
  assert.equal(responses.filter(response=>response.status==='fulfilled').length,1);
  assert.ok(responses.find(response=>response.status==='rejected').reason.code.match(/BOOKING_BUSY|SLOT_UNAVAILABLE/));
  env.DB.sqlite.prepare('INSERT OR REPLACE INTO booking_calendar_locks VALUES (?,?,?)').run('internal:ben.hessler@spray-net.com','expired-owner',0);
  const existing=env.DB.sqlite.prepare('SELECT lead_id FROM consultation_bookings').get(); const other=existing.lead_id===a.id?b:a;
  await assert.rejects(book(env,other),error=>error.code==='SLOT_UNAVAILABLE');
});

test('administrator cancellation revokes stale authorization immediately and preserves already-used render quota',async()=>{
  const env=environment(),person=lead(env); await book(env,person);
  const stale=env.DB.sqlite.prepare('SELECT * FROM consultation_bookings').get();
  env.DB.sqlite.prepare('UPDATE leads SET remaining_renders=1 WHERE id=?').run(person.id);
  assert.deepEqual(await cancelConsultation(env,person.id),{leadId:person.id,status:'cancelled',visualizerUnlocked:false});
  assert.equal((await verifyConsultation(env,stale)).status,'cancelled');
  await assert.rejects(book(env,person),error=>error.code==='BOOKING_CANCELLED');
  assert.equal((await book(env,person,{requestKey:'explicit-rebooking-key'})).status,'confirmed');
  assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders,1);
});

test('confirmed past consultations retain studio access until staff cancel them',async()=>{
  const env=environment(),person=lead(env); await book(env,person);
  const row=env.DB.sqlite.prepare('SELECT * FROM consultation_bookings').get();
  assert.equal((await verifyConsultation(env,row,{now:Date.parse('2027-01-01')})).status,'confirmed');
});

test('private time blocks remove availability and idempotent deletion restores it',async()=>{
  const env=environment(); const params={start,end:'2026-10-26T15:00:00.000Z',note:'Private travel time'};
  const block=await createTimeBlock(env,params,{now}); assert.deepEqual(await createTimeBlock(env,params,{now}),block);
  const slots=await listConsultationSlots(env,{now}); assert.equal(slots.slots[0].start,'2026-10-26T15:30:00.000Z');
  assert.equal(JSON.stringify(slots).includes(params.note),false);
  await assert.rejects(book(env,lead(env)),error=>error.code==='SLOT_UNAVAILABLE');
  assert.deepEqual(await deleteTimeBlock(env,block.id),{id:block.id,deleted:true});
  assert.deepEqual(await deleteTimeBlock(env,block.id),{id:block.id,deleted:true});
  assert.equal((await listConsultationSlots(env,{now})).slots[0].start,start);
});

test('a block cannot silently overlap a confirmed appointment or its travel buffer',async()=>{
  const env=environment(),person=lead(env); await book(env,person);
  await assert.rejects(createTimeBlock(env,{start:'2026-10-26T14:30:00.000Z',end:'2026-10-26T15:00:00.000Z'},{now}),error=>error.code==='BLOCK_CONFLICT');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM booking_time_blocks').get().n,0);
});

test('administrator schedule contains useful contact details but public slot metadata never does',async()=>{
  const env=environment(),person=lead(env,{email:'alex@example.com'}); await book(env,person);
  const block=await createTimeBlock(env,{start:'2026-10-27T16:00:00.000Z',end:'2026-10-27T17:00:00.000Z',note:'Lunch'},{now});
  const schedule=await listAdminSchedule(env,{now});
  assert.equal(schedule.bookings[0].leadId,person.id); assert.equal(schedule.bookings[0].address,person.address);
  assert.equal(schedule.bookings[0].name,'Alex Homeowner'); assert.deepEqual(schedule.blocks,[block]);
  await cancelConsultation(env,person.id); assert.equal((await listAdminSchedule(env,{now})).bookings.length,0);
});

test('block bounds and booking times reject invalid dates, absent time zones and unintended long closures',async()=>{
  const env=environment(),person=lead(env);
  for(const value of ['2026-10-26T13:00:00','2026-02-30T13:00:00Z','2026-10-26T24:00:00Z'])
    await assert.rejects(book(env,person,{start:value}),error=>error.code==='INVALID_SLOT');
  for(const params of [
    {start,end:'2026-12-01T13:00:00.000Z'},
    {start:'2027-07-01T13:00:00.000Z',end:'2027-07-01T14:00:00.000Z'},
    {start,end:'2026-10-26T14:00:00.000Z',note:'x'.repeat(501)},
  ]) await assert.rejects(createTimeBlock(env,params,{now}),error=>error.code==='INVALID_BLOCK');
});

test('same-calendar appointments respect 30-minute spacing and America/New_York daylight saving',async()=>{
  const env=environment(),a=lead(env),b=lead(env); await book(env,a);
  await assert.rejects(book(env,b,{start:'2026-10-26T14:30:00.000Z'}),error=>error.code==='SLOT_UNAVAILABLE');
  assert.equal((await book(env,b,{start:'2026-10-26T15:00:00.000Z'})).status,'confirmed');
  const slots=await listConsultationSlots(environment(),{now:Date.parse('2026-10-30T12:00:00Z')});
  assert.ok(slots.slots.some(slot=>slot.start==='2026-11-02T13:00:00.000Z')); // Monday08:00 EST
  assert.equal(slots.slots.some(slot=>slot.start==='2026-11-02T12:00:00.000Z'),false);
});

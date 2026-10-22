import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { BookingError, bookingConfiguration, listConsultationSlots, bookConsultation, verifyConsultation } from '../backend/booking.mjs';

const schema = readFileSync(new URL('../backend/schema.sql', import.meta.url), 'utf8');
const now = Date.parse('2026-10-26T12:00:00Z'); // Monday 08:00 in Charlotte.
const start = '2026-10-26T13:00:00.000Z';
function database() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
  return { sqlite, prepare(sql) {
    const statement = sqlite.prepare(sql); let bindings = [];
    return { bind(...args) { bindings = args; return this; }, async first() { return statement.get(...bindings) || null; },
      async all() { return { results: statement.all(...bindings) }; },
      async run() { return { meta: { changes: Number(statement.run(...bindings).changes) } }; } };
  } };
}
function environment(extra = {}) {
  return { DB: database(), MICROSOFT_TENANT_ID: 'organizations', MICROSOFT_CLIENT_ID: 'test-client',
    MICROSOFT_CLIENT_SECRET: 'test-client-secret-32-characters', MICROSOFT_REFRESH_TOKEN: 'bootstrap-refresh-token',
    OUTLOOK_CALENDAR_USER: 'ben.hessler@spray-net.com', ...extra };
}
function lead(env, extra = {}) {
  const person = { id: crypto.randomUUID(), first_name: 'Alex', last_name: 'Homeowner', phone: '(555) 123-4567',
    email: '', address: '12 Example St', service: 'Exterior siding', ...extra };
  // Insert a real trusted lead so SQLite enforces the module's foreign keys.
  env.DB.sqlite.prepare(`INSERT INTO leads
    (id,token_hash,lead_identity,phone_normalized,event_id,first_name,last_name,email,phone,address,city,state,zip,service,timeline,notes,event_label,consent_at,consent_version,remaining_renders,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(person.id,'hashed-token',person.id,'5551234567','show',person.first_name,person.last_name,person.email,
      person.phone,person.address,'Charlotte','NC','28201',person.service,'','','Show','2026-10-26','v1',3,'2026-10-26');
  return person;
}
function graphFixture({ busy = [], onPost, eventChange } = {}) {
  const events = new Map(); let posts = 0, tokenCalls = 0, eventGets = 0; const refreshes = [], seen = [];
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(url); seen.push({ url, method: init.method || 'GET' });
    assert.equal(init.redirect, 'error');
    if (parsed.hostname === 'login.microsoftonline.com') {
      tokenCalls++; const form = new URLSearchParams(init.body); refreshes.push(form.get('refresh_token'));
      assert.equal(form.get('grant_type'), 'refresh_token'); assert.ok(form.get('scope').includes('Calendars.ReadWrite'));
      return Response.json({ access_token: `server-access-token-${tokenCalls}`, refresh_token: `rotated-refresh-token-${tokenCalls}`, expires_in: 3600, token_type: 'Bearer' });
    }
    assert.equal(parsed.origin, 'https://graph.microsoft.com');
    assert.ok(init.headers.Authorization.startsWith('Bearer server-access-token-'));
    assert.ok(init.headers.Prefer.includes('outlook.timezone="UTC"'));
    if (parsed.pathname.endsWith('/calendarView')) return Response.json({ value: [...busy, ...events.values()] });
    if (parsed.pathname.endsWith('/events') && init.method === 'POST') {
      posts++; const body = JSON.parse(init.body);
      const event = { ...body, id: `provider-event-${posts}`, isOrganizer: true, isCancelled: false };
      events.set(event.id, event);
      if (onPost) return onPost(event, body, posts);
      return Response.json(event, { status: 201 });
    }
    if (parsed.pathname.includes('/events/')) {
      eventGets++; const id = decodeURIComponent(parsed.pathname.split('/events/')[1]);
      let event = events.get(id); if (eventChange) event = eventChange(event);
      return event ? Response.json(event) : Response.json({ error: 'private provider error' }, { status: 404 });
    }
    throw new Error(`Unexpected mocked request ${parsed.pathname}`);
  };
  return { fetcher, events, refreshes, seen, get posts() { return posts; }, get tokenCalls() { return tokenCalls; }, get eventGets() { return eventGets; } };
}
const interval = (start, end, extra = {}) => ({ id: 'private-busy-event', start: { dateTime: start, timeZone: 'UTC' },
  end: { dateTime: end, timeZone: 'UTC' }, showAs: 'busy', isCancelled: false, subject: 'Private calendar details', ...extra });
const book = (env, person, fixture, extra = {}) => bookConsultation(env,
  { lead: person, start, requestKey: 'unique-booking-request', ...extra }, { now, fetcher: fixture.fetcher });

test('booking fails closed without real operator setup; defaults honor Charlotte 90-minute consultation plus buffer', async () => {
  const config = bookingConfiguration(environment());
  assert.equal(config.available, true); assert.equal(config.durationMinutes, 90); assert.equal(config.bufferMinutes, 30);
  assert.equal(config.timeZone, 'America/New_York');
  assert.equal(bookingConfiguration(environment({ MICROSOFT_REFRESH_TOKEN: '' })).available, false);
  assert.equal(bookingConfiguration(environment({ MICROSOFT_CLIENT_SECRET: 'REPLACE_WITH_SECRET' })).available, false);
  assert.equal(bookingConfiguration(environment({ BOOKING_WORK_END: '08:00' })).available, false);
  await assert.rejects(listConsultationSlots(environment({ MICROSOFT_REFRESH_TOKEN: '' }), { fetcher() { assert.fail('No network without setup'); } }),
    error => error instanceof BookingError && error.status === 503);
});

test('slots use real busy intervals and a 30-minute gap, while exposing no calendar details', async () => {
  const env = environment(), fixture = graphFixture({ busy: [interval('2026-10-26T14:00:00Z','2026-10-26T15:00:00Z')] });
  const result = await listConsultationSlots(env, { now, fetcher: fixture.fetcher });
  assert.equal(result.slots[0].start, '2026-10-26T15:30:00.000Z');
  assert.equal(result.slots[0].end, '2026-10-26T17:00:00.000Z');
  assert.equal(JSON.stringify(result).includes('Private calendar details'), false);
  assert.equal(JSON.stringify(result).includes('private-busy-event'), false);
  assert.equal(result.slots.some(slot => new Date(slot.start).getUTCDay() === 0), false);
  assert.equal(fixture.seen.some(request => request.url.includes('/users/ben.hessler%40spray-net.com/calendar/calendarView')), true);
});

test('slot generation follows America/New_York across the autumn daylight-saving transition', async () => {
  const env = environment(), fixture = graphFixture();
  const result = await listConsultationSlots(env, { now: Date.parse('2026-10-30T12:00:00Z'), fetcher: fixture.fetcher });
  assert.ok(result.slots.some(slot => slot.start === '2026-10-30T13:00:00.000Z')); // Fri 09:00 EDT
  assert.ok(result.slots.some(slot => slot.start === '2026-11-02T14:00:00.000Z')); // Mon 09:00 EST
  assert.equal(result.slots.some(slot => slot.start === '2026-11-02T13:00:00.000Z'), false);
});

test('calendar pagination never follows an untrusted provider URL or treats a partial result as free', async () => {
  const env = environment(), fixture = graphFixture(); let calls = 0;
  const fetcher = async (url, init) => {
    if (url.includes('login.microsoftonline.com')) return fixture.fetcher(url, init);
    calls++; return Response.json({ value: [], '@odata.nextLink': 'https://evil.example/collect-tokens' });
  };
  await assert.rejects(listConsultationSlots(env, { now, fetcher }), BookingError); assert.equal(calls, 1);
});

test('phone-only booking creates a genuine server event and requires a matching Graph GET before confirmation', async () => {
  const env = environment(), person = lead(env), fixture = graphFixture();
  const result = await book(env, person, fixture);
  assert.deepEqual(result, { status: 'confirmed', start, end: '2026-10-26T14:30:00.000Z', timeZone: 'America/New_York' });
  const event = [...fixture.events.values()][0];
  assert.equal(event.attendees, undefined); assert.ok(event.body.content.includes(person.address));
  assert.equal(event.showAs, 'busy'); assert.equal(fixture.posts, 1); assert.equal(fixture.eventGets, 1);
  const row = env.DB.sqlite.prepare('SELECT * FROM consultation_bookings').get();
  assert.equal(row.status, 'confirmed'); assert.equal(row.graph_event_id, event.id); assert.equal(row.transaction_id, event.transactionId);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM booking_calendar_locks').get().n, 0);
});

test('retrying a confirmed request never creates a duplicate invitation or appointment', async () => {
  const env = environment(), person = lead(env, { email: 'alex@example.com' }), fixture = graphFixture();
  await book(env, person, fixture); const again = await book(env, person, fixture);
  assert.equal(again.status, 'confirmed'); assert.equal(fixture.posts, 1); assert.equal(fixture.eventGets, 2);
  assert.equal([...fixture.events.values()][0].attendees[0].emailAddress.address, person.email);
  await assert.rejects(book(env, person, fixture, { requestKey: 'a-different-request' }), error => error.code === 'ALREADY_BOOKED');
});

test('a lost create response stays pending, then recovers the existing Graph transaction without a second POST', async () => {
  const env = environment(), person = lead(env), fixture = graphFixture({ onPost() { throw new Error('connection lost after provider commit'); } });
  const first = await book(env, person, fixture); assert.equal(first.status, 'pending');
  assert.equal(env.DB.sqlite.prepare('SELECT status FROM consultation_bookings').get().status, 'pending');
  const retry = await book(env, person, fixture); assert.equal(retry.status, 'confirmed'); assert.equal(fixture.posts, 1);
});

test('private-link session recovery reconciles a pending server transaction read-only without the old browser request key', async () => {
  const env = environment(), person = lead(env), fixture = graphFixture({ onPost() { throw new Error('lost response after provider commit'); } });
  assert.equal((await book(env, person, fixture)).status, 'pending');
  const row = env.DB.sqlite.prepare('SELECT * FROM consultation_bookings').get();
  const recovered = await verifyConsultation(env, row, { fetcher: fixture.fetcher });
  assert.equal(recovered.status, 'confirmed'); assert.equal(fixture.posts, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT status FROM consultation_bookings').get().status, 'confirmed');
});

test('read-only pending recovery never creates an absent appointment', async () => {
  const env = environment(), person = lead(env); let fixture;
  fixture = graphFixture({ onPost(event) { fixture.events.delete(event.id); throw new Error('unknown outcome'); } });
  assert.equal((await book(env, person, fixture)).status, 'pending');
  const row = env.DB.sqlite.prepare('SELECT * FROM consultation_bookings').get();
  assert.equal((await verifyConsultation(env, row, { fetcher: fixture.fetcher })).status, 'pending');
  assert.equal(fixture.posts, 1);
});

test('uncertain pending requests keep their recovery key when the original time is now invalid or busy', async () => {
  for (const situation of ['past','busy']) {
    const env = environment(), person = lead(env); let fixture;
    fixture = graphFixture({ onPost(event) { fixture.events.delete(event.id); throw new Error('provider outcome unknown'); } });
    assert.equal((await book(env, person, fixture)).status, 'pending');
    if (situation === 'busy') fixture.events.set('external', interval('2026-10-26T13:00:00Z','2026-10-26T15:00:00Z'));
    const retryNow = situation === 'past' ? Date.parse('2026-10-27T12:00:00Z') : now;
    await assert.rejects(bookConsultation(env, { lead: person, start, requestKey: 'unique-booking-request' }, { now: retryNow, fetcher: fixture.fetcher }),
      error => error.code === 'BOOKING_REVIEW_REQUIRED' && error.message.includes('Keep this request'));
    const row = env.DB.sqlite.prepare('SELECT * FROM consultation_bookings').get();
    assert.equal(row.status, 'pending'); assert.equal(row.request_key, 'unique-booking-request'); assert.equal(fixture.posts, 1);
  }
});

test('a definite Graph rejection releases the uncreated hold instead of stranding the visitor pending', async () => {
  const env = environment(), person = lead(env); let fixture;
  fixture = graphFixture({ onPost(event) { fixture.events.delete(event.id); return Response.json({ error: 'permission denied' }, { status: 403 }); } });
  await assert.rejects(book(env, person, fixture), error => error.code === 'BOOKING_NOT_CREATED');
  assert.equal(env.DB.sqlite.prepare('SELECT status FROM consultation_bookings').get().status, 'cancelled');
});

test('concurrent requests for one calendar are serialized and a booked slot cannot be double-booked', async () => {
  const env = environment(), a = lead(env), b = lead(env); let finish, announce;
  const started = new Promise(resolve => { announce = resolve; });
  const fixture = graphFixture({ onPost(event) { announce(); return new Promise(resolve => { finish = () => resolve(Response.json(event, { status: 201 })); }); } });
  const first = book(env, a, fixture); await started;
  await assert.rejects(book(env, b, fixture, { requestKey: 'second-person-request' }), error => error.code === 'BOOKING_BUSY');
  finish(); assert.equal((await first).status, 'confirmed');
  await assert.rejects(book(env, b, fixture, { requestKey: 'second-person-request' }), error => error.code === 'SLOT_UNAVAILABLE');
  assert.equal(fixture.posts, 1);
});

test('Graph time mismatch never confirms or unlocks a pending booking', async () => {
  const env = environment(), person = lead(env), fixture = graphFixture({ eventChange(event) {
    return { ...event, start: { dateTime: '2026-10-26T15:00:00Z', timeZone: 'UTC' } };
  } });
  await assert.rejects(book(env, person, fixture), error => error.code === 'BOOKING_NOT_VERIFIED');
  assert.equal(env.DB.sqlite.prepare('SELECT status FROM consultation_bookings').get().status, 'pending');
});

test('deleted/cancelled/declined Graph appointments persistently revoke studio authorization', async () => {
  for (const mutation of ['deleted','cancelled','declined']) {
    const env = environment(), person = lead(env, { email: 'alex@example.com' }), fixture = graphFixture();
    await book(env, person, fixture);
    const row = env.DB.sqlite.prepare('SELECT * FROM consultation_bookings').get(), event = fixture.events.get(row.graph_event_id);
    if (mutation === 'deleted') fixture.events.delete(row.graph_event_id);
    if (mutation === 'cancelled') event.isCancelled = true;
    if (mutation === 'declined') event.attendees[0].status = { response: 'declined' };
    const result = await verifyConsultation(env, row, { fetcher: fixture.fetcher });
    assert.equal(result.status, 'cancelled');
    assert.equal(env.DB.sqlite.prepare('SELECT status FROM consultation_bookings').get().status, 'cancelled');
  }
});

test('provider outage never returns a stale confirmed authorization', async () => {
  const env = environment(), person = lead(env), fixture = graphFixture(); await book(env, person, fixture);
  const row = env.DB.sqlite.prepare('SELECT * FROM consultation_bookings').get();
  await assert.rejects(verifyConsultation(env, row, { fetcher: async () => Response.json({ error: 'private upstream error' }, { status: 503 }) }),
    error => error instanceof BookingError && error.status === 503 && !error.message.includes('private upstream'));
});

test('rotated OAuth tokens are encrypted at rest and the next refresh uses the rotated token', async () => {
  const env = environment(), fixture = graphFixture();
  await listConsultationSlots(env, { now, fetcher: fixture.fetcher });
  const record = env.DB.sqlite.prepare('SELECT * FROM booking_tokens').get();
  assert.equal(record.refresh_cipher.includes('rotated-refresh-token'), false); assert.equal(record.access_cipher.includes('server-access-token'), false);
  assert.equal(JSON.stringify(record).includes(env.MICROSOFT_CLIENT_SECRET), false);
  env.DB.sqlite.exec('UPDATE booking_tokens SET expires_at=0');
  await listConsultationSlots(env, { now, fetcher: fixture.fetcher });
  assert.deepEqual(fixture.refreshes, ['bootstrap-refresh-token','rotated-refresh-token-1']);
  env.DB.sqlite.exec('UPDATE booking_tokens SET expires_at=0');
  await assert.rejects(listConsultationSlots({ ...env, MICROSOFT_CLIENT_SECRET: 'changed-client-secret-without-reauthorization' }, { now, fetcher: fixture.fetcher }),
    error => error.code === 'BOOKING_AUTH_SETUP');
});

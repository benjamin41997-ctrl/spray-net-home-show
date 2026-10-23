import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import worker, { validateLead, normalizePhone, detectImage, csvCell, configuration, callRenderer, hash } from '../backend/worker.mjs';

const schema = readFileSync(new URL('../backend/schema.sql', import.meta.url), 'utf8');
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
const base64Jpeg = Buffer.from(jpeg).toString('base64');
const origin = 'https://example.github.io';
const sample = () => ({ firstName: 'Alex', lastName: 'Homeowner', email: 'Alex@example.com', phone: '(555) 123-4567',
  address: '12 Example St', city: 'Tampa', state: 'FL', zip: '33602', service: 'Exterior siding',
  timeline: 'Within 3 months', notes: '', event: 'October Home Show', contactConsent: true });

function database(initialSchema = schema) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(initialSchema);
  return { sqlite, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement._runSync()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }, prepare(sql) {
    const statement = sqlite.prepare(sql); let bindings = [];
    return {
      bind(...values) { bindings = values; return this; },
      async first() { return statement.get(...bindings) || null; },
      async all() { return { results: statement.all(...bindings) }; },
      async run() { const result = statement.run(...bindings); return { meta: { changes: Number(result.changes) } }; },
      _runSync() { const result = statement.run(...bindings); return { meta: { changes: Number(result.changes) } }; },
    };
  } };
}
function bucket() {
  const files = new Map();
  return { files,
    async put(key, data) { files.set(key, new Uint8Array(data)); },
    async delete(key) { files.delete(key); },
    async get(key) {
      const bytes = files.get(key); if (!bytes) return null;
      return { body: new Blob([bytes]).stream(), async arrayBuffer() { return bytes.slice().buffer; } };
    },
  };
}
function environment(extra = {}) {
  return { DB: database(), PHOTOS: bucket(), ALLOWED_ORIGINS: origin,
    RATE_LIMIT_SALT: 'a-unique-random-salt-for-tests-32', ADMIN_TOKEN: 'a-unique-administrator-secret-for-tests-32',
    EVENT_ID: 'show-1', FREE_RENDERS: '3', DAILY_RENDER_LIMIT: '50', LEADS_PER_IP_HOUR: '30',
    MICROSOFT_TENANT_ID: 'organizations', MICROSOFT_CLIENT_ID: 'test-client',
    MICROSOFT_CLIENT_SECRET: 'test-client-secret-32-characters-long', MICROSOFT_REFRESH_TOKEN: 'test-refresh-token',
    BOOKING_DURATION_MINUTES: '90', BOOKING_BUFFER_MINUTES: '30',
    RENDER_API_URL: 'https://renderer.example/api', RENDER_API_KEY: 'test-server-secret', ...extra };
}
async function request(env, path, { method = 'GET', body, token, key, headers = {} } = {}) {
  const init = { method, headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.8', ...headers } };
  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
    if (!(body instanceof FormData)) init.headers['Content-Type'] = 'application/json';
  }
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (key) init.headers['Idempotency-Key'] = key;
  return worker.fetch(new Request(`https://api.example${path}`, init), env);
}
async function lead(env, data = sample()) {
  const response = await request(env, '/api/leads', { method: 'POST', body: data });
  assert.equal(response.status, 201); return response.json();
}
async function photo(env, person, bytes = jpeg) {
  // Upload-focused tests begin with an already server-confirmed mocked Outlook event.
  if (!env.DB.sqlite.prepare('SELECT lead_id FROM consultation_bookings WHERE lead_id=?').get(person.id)) confirmBooking(env, person);
  const form = new FormData(); form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'home.jpg');
  const response = await request(env, `/api/leads/${person.id}/photos`, { method: 'POST', body: form, token: person.token });
  assert.equal(response.status, 201); return response.json();
}
const settings = photoId => ({ photoId, colorName: 'Warm white', colorHex: '#F2EFE5', surface: 'siding' });
function renderedResponse() { return new Response(JSON.stringify({ image_base64: base64Jpeg, mime_type: 'image/jpeg' })); }
const calendarEvents = new Map();
const calendarUnavailable = new Set();
let graphCreates = 0;
let calendarViewEvents = [];
function confirmBooking(env, person, status = 'confirmed') {
  const id = `mock-event-${crypto.randomUUID()}`, start = '2026-11-02T15:00:00.000Z', end = '2026-11-02T16:30:00.000Z';
  const transactionId = crypto.randomUUID(), requestKey = crypto.randomUUID();
  const digest = value => createHash('sha256').update(value).digest('hex');
  const calendarKey = digest(JSON.stringify([env.MICROSOFT_TENANT_ID, env.MICROSOFT_CLIENT_ID,
    env.OUTLOOK_CALENDAR_USER || 'me', digest(env.MICROSOFT_REFRESH_TOKEN)]));
  env.DB.sqlite.prepare(`INSERT INTO consultation_bookings
    (lead_id,calendar_key,status,graph_event_id,transaction_id,start_at,end_at,time_zone,request_key,input_hash,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(lead_id) DO UPDATE SET status=excluded.status,graph_event_id=excluded.graph_event_id,
    transaction_id=excluded.transaction_id,start_at=excluded.start_at,end_at=excluded.end_at`)
    .run(person.id, calendarKey, status, status === 'pending' ? null : id, transactionId, start, end, 'America/New_York', requestKey, 'test-input-hash', new Date().toISOString());
  calendarEvents.set(id, { id, isCancelled: false, isOrganizer: true, transactionId,
    start: { dateTime: start, timeZone: 'UTC' }, end: { dateTime: end, timeZone: 'UTC' }, attendees: [] });
  return id;
}
async function calendarFetch(url, init, fallback) {
  const target = new URL(url);
  if (target.hostname === 'login.microsoftonline.com') return new Response(JSON.stringify({
    access_token: 'test-access-token', refresh_token: 'test-rotated-refresh', expires_in: 3600 }));
  if (target.hostname === 'graph.microsoft.com') {
    const id = decodeURIComponent(target.pathname.split('/').at(-1));
    if (calendarUnavailable.has(id)) return new Response(JSON.stringify({ error: { code: 'ServiceUnavailable' } }), { status: 503 });
    if (calendarEvents.has(id)) return new Response(JSON.stringify(calendarEvents.get(id)));
    if (target.pathname.endsWith('/calendarView')) return new Response(JSON.stringify({ value: calendarViewEvents }));
    if (target.pathname.endsWith('/events') && init?.method === 'POST') {
      graphCreates++; const event = { ...JSON.parse(init.body), id: `created-test-event-${crypto.randomUUID()}`,
        isCancelled: false, isOrganizer: true };
      calendarEvents.set(event.id, event); return new Response(JSON.stringify(event), { status: 201 });
    }
    throw new Error(`Unexpected mocked Graph route ${target.pathname}`);
  }
  if (fallback) return fallback(url, init);
  throw new Error('Unexpected outbound request in backend tests.');
}
globalThis.fetch = (url, init) => calendarFetch(url, init);
async function withFetch(fetcher, work) {
  const previous = globalThis.fetch; globalThis.fetch = (url, init) => calendarFetch(url, init, fetcher);
  try { return await work(); } finally { globalThis.fetch = previous; }
}

test('owner dashboard requires the administrator key and never exposes visitor credentials or object storage paths',async()=>{
  const env=environment(),person=await lead(env);
  for(const token of [undefined,person.token,'wrong-administrator-token-32-characters'])
    assert.equal((await request(env,'/api/admin/leads',{token})).status,401);
  const response=await request(env,'/api/admin/leads',{token:env.ADMIN_TOKEN});assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const data=await response.json();assert.equal(data.total,1);assert.equal(data.leads[0].name,'Alex Homeowner');
  assert.equal(data.leads[0].visitCount,0);assert.equal(data.leads[0].lastAccessedAt,null);
  assert.ok(!JSON.stringify(data).includes(person.token));assert.ok(!JSON.stringify(data).includes(env.ADMIN_TOKEN));
  assert.ok(!/token_hash|request_key|input_hash|object_key|graph_event_id/.test(JSON.stringify(data)));
  const denied=await request(env,'/api/admin/leads',{token:env.ADMIN_TOKEN,headers:{Origin:'https://evil.example'}});assert.equal(denied.status,403);
});

test('authenticated project visits count page opens idempotently and ignore supplied counts, identities and timestamps',async()=>{
  const env=environment(),person=await lead(env),other=await lead(env,{...sample(),phone:'7045550192'}),visitId=crypto.randomUUID();
  const path=`/api/leads/${person.id}/visits`,body={visitId,leadId:other.id,accessedAt:'2099-01-01T00:00:00Z',count:999};
  assert.equal((await request(env,path,{method:'POST',body,token:other.token})).status,401);
  for(const bad of [null,{},[],{visitId:'bad'}])assert.equal((await request(env,path,{method:'POST',body:bad,token:person.token})).status,400);
  const replies=await Promise.all([request(env,path,{method:'POST',body,token:person.token}),request(env,path,{method:'POST',body,token:person.token})]);
  assert.deepEqual((await Promise.all(replies.map(response=>response.json()))).map(row=>row.recorded).sort(),[false,true]);
  const before=env.DB.sqlite.prepare('SELECT * FROM lead_visits WHERE lead_id=?').get(person.id);
  assert.equal(before.visit_id,visitId);assert.ok(Date.parse(before.accessed_at)<=Date.now());
  await request(env,path,{method:'POST',body,token:person.token});
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM lead_visits').get().n,1);
  assert.equal(env.DB.sqlite.prepare('SELECT accessed_at FROM lead_visits').get().accessed_at,before.accessed_at);
  await request(env,path,{method:'POST',body:{visitId:crypto.randomUUID()},token:person.token});
  const dashboard=await(await request(env,'/api/admin/leads',{token:env.ADMIN_TOKEN})).json();
  assert.equal(dashboard.leads.find(row=>row.id===person.id).visitCount,2);
  assert.equal(dashboard.leads.find(row=>row.id===other.id).visitCount,0);
  await request(env,'/api/admin/leads',{token:env.ADMIN_TOKEN});
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM lead_visits').get().n,2,'Owner reads never count as customer visits.');
});

test('owner stages reflect authoritative booking, upload and completed render records with cancellation taking precedence',async()=>{
  const env=environment(),people=[];
  for(let index=0;index<7;index++)people.push(await lead(env,{...sample(),phone:`70455501${String(index).padStart(2,'0')}`}));
  await request(env,`/api/leads/${people[1].id}/consultation`,{method:'POST',body:{consultationPreference:'schedule_now'},token:people[1].token});
  confirmBooking(env,people[2],'pending');confirmBooking(env,people[3]);await photo(env,people[4]);
  const uploaded=await photo(env,people[5]);
  await withFetch(async()=>renderedResponse(),async()=>{
    const response=await request(env,`/api/leads/${people[5].id}/renders`,{method:'POST',body:settings(uploaded.id),token:people[5].token,key:crypto.randomUUID()});assert.equal(response.status,201);
  });
  await photo(env,people[6]);confirmBooking(env,people[6],'cancelled');
  const data=await(await request(env,'/api/admin/leads',{token:env.ADMIN_TOKEN})).json();
  const stages=['lead_submitted','consultation_requested','booking_pending','consultation_booked','photos_uploaded','visualizations_created','consultation_cancelled'];
  people.forEach((person,index)=>assert.equal(data.leads.find(row=>row.id===person.id).stage,stages[index]));
  assert.deepEqual(data.overview,{total:7,booked:3,needsBooking:4,visualizerUsed:1});
  const filtered=await(await request(env,'/api/admin/leads?stage=visualizations_created',{token:env.ADMIN_TOKEN})).json();assert.equal(filtered.total,1);assert.equal(filtered.leads[0].id,people[5].id);
});

test('owner search is bound literal text, stages are allowlisted, and pagination reaches every saved lead',async()=>{
  const env=environment({LEADS_PER_IP_HOUR:'1000'});
  for(let index=0;index<51;index++)await lead(env,{...sample(),name:'',firstName:`Visitor ${index}`,phone:`704555${String(index).padStart(4,'0')}`});
  const first=await(await request(env,'/api/admin/leads',{token:env.ADMIN_TOKEN})).json();
  const second=await(await request(env,'/api/admin/leads?page=2',{token:env.ADMIN_TOKEN})).json();
  assert.equal(first.leads.length,50);assert.equal(second.leads.length,1);assert.equal(new Set([...first.leads,...second.leads].map(row=>row.id)).size,51);
  const found=await(await request(env,'/api/admin/leads?q=Visitor%2050',{token:env.ADMIN_TOKEN})).json();assert.equal(found.total,1);
  const injection=await(await request(env,'/api/admin/leads?q='+encodeURIComponent("%' OR 1=1 --"),{token:env.ADMIN_TOKEN})).json();assert.equal(injection.total,0);
  for(const suffix of ['?page=0','?page=1.5','?stage=made_up','?q='+'a'.repeat(161)])assert.equal((await request(env,'/api/admin/leads'+suffix,{token:env.ADMIN_TOKEN})).status,400);
});

test('activity migration is additive, repeatable and preserves old leads without inventing historical visits',async()=>{
  const env=environment(),person=await lead(env);
  const before=env.DB.sqlite.prepare('SELECT token_hash,created_at FROM leads WHERE id=?').get(person.id);
  env.DB.sqlite.exec('DROP TABLE lead_visits;DROP TABLE app_metadata;');
  const migration=readFileSync(new URL('../backend/migrations/0004_owner_activity.sql',import.meta.url),'utf8');
  env.DB.sqlite.exec(migration);const started=env.DB.sqlite.prepare('SELECT value FROM app_metadata').get().value;env.DB.sqlite.exec(migration);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT token_hash,created_at FROM leads WHERE id=?').get(person.id),before);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM lead_visits').get().n,0);
  assert.equal(env.DB.sqlite.prepare('SELECT value FROM app_metadata').get().value,started);
});

test('readiness fails closed for missing bindings, secrets, schema; CORS requires exact origins', async () => {
  const unconfigured = await request({}, '/api/health', { headers: { Origin: '' } });
  assert.deepEqual(await unconfigured.json(), { ready: false, renderAvailable: false, freeRenders: 3,
    addressSuggestionsAvailable: false, bookingAvailable: false, consultationMinutes: 90, travelBufferMinutes: 30, timeZone: 'America/New_York' });
  assert.equal(configuration(environment({ RATE_LIMIT_SALT: 'REPLACE_WITH_RANDOM_RATE_LIMIT_SALT' })).ready, false);
  const env = environment();
  assert.deepEqual(await (await request(env, '/api/health')).json(), { ready: true, renderAvailable: true, freeRenders: 3,
    addressSuggestionsAvailable: true, bookingAvailable: true, consultationMinutes: 90, travelBufferMinutes: 30, timeZone: 'America/New_York' });
  const denied = await request(env, '/api/health', { headers: { Origin: `${origin}.evil.example` } });
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  const allowed = await request(env, '/api/health'); assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await request(env, '/api/leads', { method: 'OPTIONS' })).status, 204);
  env.DB.sqlite.exec('DROP TABLE leads');
  assert.equal((await (await request(env, '/api/health')).json()).ready, false);
});

function addressFixture(url) {
  const target = new URL(url);
  if (target.hostname === 'services.nconemap.gov') return new Response(JSON.stringify({ features: [{ attributes: {
    st_address: '101 MAIN ST', post_comm: 'BELMONT', post_code: '28012', state: 'NC', county: 'GASTON',
  }, geometry: { x: -80.9, y: 35.1 } }] }));
  if (target.href.startsWith('https://services1.arcgis.com/2AGLxyiJoNiVHKwq/')) return new Response(JSON.stringify({ features: [{ attributes: {
    WHOLE_ADDRESS: '101 MAIN ST', POST_COMM: 'FORT MILL', POST_CODE: 29715, STATE: 'SC', COUNTY: 'York',
  }, geometry: { x: -80.9, y: 35.1 } }] }));
  if (target.href.startsWith('https://services3.arcgis.com/rJcpRneDUBgTeCT3/')) return new Response(JSON.stringify({ features: [{ attributes: {
    WHOLE_ADDR: '101 MAIN ST', ADDR_HN: 101, ST_NAME: 'MAIN', POSTAL_TOW: 'INDIAN LAND', POSTAL_STA: 'SC', POSTAL_ZIP: 29707, COUNTY: 'LANCASTER',
  }, geometry: { x: -80.8, y: 34.95 } }] }));
  return new Response(JSON.stringify({ features: [] }));
}

test('public address suggestions return structured fixed-provider results before lead capture with exact CORS and no credentials forwarded', async () => {
  const env = environment(); let calls = 0;
  await withFetch(async (url, init) => {
    calls++; const target = new URL(url);
    assert.equal(target.protocol, 'https:'); assert.ok(target.hostname.endsWith('arcgis.com') || target.hostname === 'services.nconemap.gov');
    const headers = new Headers(init.headers); assert.equal(headers.get('Authorization'), null);
    assert.equal(headers.get('CF-Connecting-IP'), null); assert.equal(headers.get('Cookie'), null);
    assert.equal(JSON.stringify(init).includes(env.ADMIN_TOKEN), false); assert.equal(target.href.includes(env.ADMIN_TOKEN), false);
    return addressFixture(url);
  }, async () => {
    const response = await request(env, '/api/addresses/suggest', { method: 'POST', body: { query: '101 Main', apiBase: 'https://evil.example' }, token: env.ADMIN_TOKEN });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Cache-Control'), 'no-store'); const result = await response.json();
    assert.ok(result.suggestions.some(item => item.city === 'Belmont' && item.state === 'NC' && item.zip === '28012'));
    assert.ok(result.suggestions.some(item => item.city === 'Fort Mill' && item.state === 'SC' && item.zip === '29715'));
    assert.ok(result.suggestions.some(item => item.city === 'Indian Land' && item.state === 'SC' && item.zip === '29707'));
    for (const item of result.suggestions) {
      assert.equal(typeof item.display, 'string'); assert.equal(item.street, '101 Main St');
      assert.deepEqual(Object.keys(item).sort(), ['city','display','state','street','zip']);
    }
    assert.ok(result.sources.length >= 2); assert.ok(calls >= 2 && calls <= 3);
    const rejected = await request(env, '/api/addresses/suggest', { method: 'POST', body: { query: '101 Main' }, headers: { Origin: 'https://evil.example' } });
    assert.equal(rejected.status, 403); assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 0);
    for (const row of env.DB.sqlite.prepare('SELECT * FROM rate_limits').all()) {
      assert.match(row.bucket, /^[0-9a-f]{64}$/); assert.equal(JSON.stringify(row).includes('101 Main'), false);
      assert.equal(JSON.stringify(row).includes('203.0.113.8'), false);
    }
  });
});

test('address endpoint rejects invalid bodies, short or missing numbered prefixes and wrong methods without outbound requests', async () => {
  const env = environment(); let calls = 0;
  await withFetch(async () => { calls++; throw new Error('Invalid address input must not trigger an outbound request.'); }, async () => {
    assert.equal((await request(env, '/api/addresses/suggest')).status, 405);
    for (const body of [null, [], {}, { query: '' }, { query: '1 M' }, { query: 'Main Street' }, { query: 'https://evil.example' }, { query: '101 Main', callback: 'https://evil.example', padding: 'x'.repeat(17000) }]) {
      const response = await request(env, '/api/addresses/suggest', { method: 'POST', body });
      assert.ok([400,413].includes(response.status));
    }
    const wrongType = await worker.fetch(new Request('https://api.example/api/addresses/suggest', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '101 Main' }), env);
    assert.equal(wrongType.status, 415);
    const notReady = await request({}, '/api/addresses/suggest', { method: 'POST', body: { query: '101 Main' }, headers: { Origin: '' } });
    assert.equal(notReady.status, 503); assert.equal(calls, 0);
  });
});

test('address provider failures stay safe and cannot return partial success when every source fails', async () => {
  const env = environment(); let calls = 0;
  await withFetch(async () => { calls++; return new Response(JSON.stringify({ error: {
    code: 'upstream-error-private', message: `secret-upstream-message ${env.ADMIN_TOKEN}`,
  } }), { status: 500, headers: { 'x-request-id': 'upstream-request-private' } }); }, async () => {
    const response = await request(env, '/api/addresses/suggest', { method: 'POST', body: { query: '101 Main' } });
    assert.equal(response.status, 503); const text = await response.text();
    assert.equal(JSON.parse(text).error.code, 'ADDRESS_LOOKUP_UNAVAILABLE');
    for (const value of ['upstream-error-private','secret-upstream-message',env.ADMIN_TOKEN,'upstream-request-private']) assert.equal(text.includes(value), false);
    assert.ok(calls >= 2 && calls <= 3);
  });
});

test('address suggestions enforce independent per-minute IP and global upstream request caps with hashed buckets', async () => {
  const body = { query: '101 Main' };
  for (const scope of ['ip','global']) {
    const env = environment(), minute = Math.floor(Date.now() / 60000), ip = '203.0.113.8';
    const key = await hash(scope === 'ip' ? `${env.RATE_LIMIT_SALT}:addresses:ip:${ip}:${minute}` : `${env.RATE_LIMIT_SALT}:addresses:global:${minute}`);
    env.DB.sqlite.prepare('INSERT INTO rate_limits(bucket,attempts,expires_at) VALUES (?,?,?)').run(key, scope === 'ip' ? 59 : 119, (minute+2)*60000);
    let calls = 0;
    await withFetch(async url => { calls++; return addressFixture(url); }, async () => {
      assert.equal((await request(env, '/api/addresses/suggest', { method: 'POST', body })).status, 200);
      const used = calls;
      const blocked = await request(env, '/api/addresses/suggest', { method: 'POST', body,
        headers: scope === 'global' ? { 'CF-Connecting-IP': '203.0.113.9' } : {} });
      assert.equal(blocked.status, 429); assert.equal((await blocked.json()).error.code, 'ADDRESS_RATE_LIMIT'); assert.equal(calls, used);
      assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 0);
    });
  }
});

test('lead validation requires only name, phone and consent, checking optional fields when present', () => {
  assert.throws(() => validateLead({ ...sample(), contactConsent: false }), /agree/);
  const minimal = validateLead({ name: '  Ana de la Cruz  ', phone: '(704) 555-0199', contactConsent: true });
  assert.equal(minimal.firstName, 'Ana'); assert.equal(minimal.lastName, 'de la Cruz');
  for (const field of ['email', 'address', 'city', 'state', 'zip', 'service']) assert.equal(minimal[field], '');
  assert.equal(validateLead({ fullName: 'Prince', phone: '7045550199', contactConsent: true }).lastName, '');
  assert.throws(() => validateLead({ phone: '7045550199', contactConsent: true }), /name/);
  assert.throws(() => validateLead({ ...sample(), email: 'bad' }), /email/);
  assert.throws(() => validateLead({ ...sample(), phone: '111' }), /phone/);
  assert.throws(() => validateLead({ ...sample(), zip: 'abc' }), /ZIP/);
  assert.throws(() => validateLead({ ...sample(), state: 'North Carolina' }), /state/);
  assert.throws(() => validateLead({ ...sample(), address: 'a'.repeat(181) }), /street address/);
  assert.equal(normalizePhone('(704) 555-0199'), normalizePhone('+1 704-555-0199'));
  assert.equal(validateLead({ ...sample(), state: 'fl' }).state, 'FL');
  assert.equal(validateLead(sample()).consultationPreference, 'contact_me');
  for (const preference of ['booked', 'confirmed', 'contact', '', null, true, ['schedule_now']]) {
    assert.throws(() => validateLead({ ...sample(), consultationPreference: preference }), /schedule a consultation/);
  }
});

test('compact captures save separate blank-email leads, allow shared optional email and track mobile/tablet mode', async () => {
  const env = environment();
  const people = [
    { name: 'Mobile Visitor', phone: '7045550101', captureMode: 'mobile' },
    { fullName: 'Tablet Visitor', phone: '7045550102', captureMode: 'tablet' },
    { firstName: 'Same', phone: '7045550103', email: 'household@example.com' },
    { firstName: 'Household', phone: '7045550104', email: 'household@example.com' },
  ];
  for (const person of people) {
    const saved = await lead(env, { ...person, contactConsent: true });
    assert.equal(saved.visualizerUnlocked, false); assert.deepEqual(saved.booking, { status: 'none' });
    const session = await (await request(env, `/api/leads/${saved.id}/session`, { token: saved.token })).json();
    assert.equal(session.lead.phone, person.phone); assert.equal(session.lead.email, person.email || '');
    assert.equal(session.visualizerUnlocked, false); assert.deepEqual(session.photos, []);
    assert.equal(env.DB.sqlite.prepare('SELECT capture_mode FROM leads WHERE id=?').get(saved.id).capture_mode, person.captureMode || 'mobile');
  }
  const duplicate = await request(env, '/api/leads', { method: 'POST', body: { name: 'Changed name', phone: '+1 (704) 555-0101', email: 'changed@example.com', contactConsent: true } });
  assert.equal(duplicate.status, 409); assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 4);
  const csv = await (await request(env, '/api/admin/leads.csv', { token: env.ADMIN_TOKEN })).text();
  assert.ok(csv.includes('"capture_mode"')); assert.ok(csv.includes('"tablet"'));
});

test('phone identity migration preserves duplicate-phone legacy leads, tokens and dependent media without destructive rebuilds', async () => {
  const legacySchema = schema
    .replace('  lead_identity TEXT NOT NULL,\n  phone_normalized TEXT NOT NULL,', '  email_normalized TEXT NOT NULL,')
    .replace(/  capture_mode TEXT[^\n]+\n/, '')
    .replace('UNIQUE (lead_identity, event_id)', 'UNIQUE (email_normalized, event_id)')
    .replace('CREATE INDEX IF NOT EXISTS leads_phone_event ON leads(phone_normalized, event_id);', '');
  const env = environment({ DB: database(legacySchema) });
  const owners = [];
  for (let n = 0; n < 2; n++) {
    const person = { id: crypto.randomUUID(), token: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') };
    person.tokenHash = await hash(person.token); owners.push(person);
    env.DB.sqlite.prepare(`INSERT INTO leads (id,token_hash,email_normalized,event_id,first_name,last_name,email,phone,address,city,state,zip,service,event_label,consent_at,consent_version,remaining_renders,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(person.id, person.tokenHash, `legacy${n}@example.com`, 'show-1', 'Legacy', String(n), `legacy${n}@example.com`,
      n ? '+1 704\u00a0555\t0199' : '(704) 555-0199', '12 Prior Street', '', '', '', '', 'Old show', '2026-10-01', 'old-consent', 3, '2026-10-01');
  }
  const photoId = crypto.randomUUID(), renderId = crypto.randomUUID(), photoKey = `photos/${owners[0].id}/${photoId}`, renderKey = `renders/${owners[0].id}/${renderId}`;
  env.DB.sqlite.prepare(`INSERT INTO photos (id,lead_id,object_key,content_hash,status,mime_type,byte_length,created_at)
    VALUES (?,?,?,?,'ready','image/jpeg',?,'2026-10-01')`).run(photoId, owners[0].id, photoKey, 'legacy-photo-hash', jpeg.length);
  env.DB.sqlite.prepare(`INSERT INTO renders (id,lead_id,photo_id,request_key,input_hash,status,day,daily_limit,color_name,color_hex,surface,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending','2026-10-01',50,'White','#FFFFFF','siding','2026-10-01','2026-10-01')`)
    .run(renderId, owners[0].id, photoId, 'legacy-render-key', 'legacy-input');
  env.DB.sqlite.prepare("UPDATE renders SET status='completed',object_key=?,mime_type='image/jpeg' WHERE id=?").run(renderKey, renderId);
  await env.PHOTOS.put(photoKey, jpeg); await env.PHOTOS.put(renderKey, jpeg);
  env.DB.sqlite.exec(readFileSync(new URL('../backend/migrations/0002_phone_identity_booking.sql', import.meta.url), 'utf8'));
  for (const owner of owners) {
    const row = env.DB.sqlite.prepare('SELECT * FROM leads WHERE id=?').get(owner.id);
    assert.equal(row.token_hash, owner.tokenHash); assert.equal(row.phone_normalized, '17045550199');
    assert.equal(row.lead_identity, `legacy:${owner.id}`); assert.equal(row.capture_mode, 'unknown');
    const recovered = await request(env, `/api/leads/${owner.id}/session`, { token: owner.token });
    assert.equal(recovered.status, 200); assert.equal((await recovered.json()).lead.name, `Legacy ${owners.indexOf(owner)}`);
  }
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM renders').get().n, 1); assert.equal(env.PHOTOS.files.size, 2);
  assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads WHERE id=?').get(owners[0].id).remaining_renders, 2);
  assert.deepEqual(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  const duplicate = await request(env, '/api/leads', { method: 'POST', body: { name: 'New capture', phone: '+1 7045550199', contactConsent: true } });
  assert.equal(duplicate.status, 409);
  await lead(env, { name: 'New phone-only visitor', phone: '7045550201', contactConsent: true });
});

test('all studio routes require an Outlook-confirmed booking and relock on cancellation or verification outage', async () => {
  const env = environment(), person = await lead(env, { name: 'Phone Only', phone: '7045550202', contactConsent: true });
  let providerCalls = 0;
  const fakePhoto = crypto.randomUUID(), fakeRender = crypto.randomUUID();
  const studioRoutes = (photoId, renderId) => [
    [`/api/leads/${person.id}/photos`, { method: 'POST', body: (() => { const form = new FormData(); form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'home.jpg'); return form; })() }],
    [`/api/leads/${person.id}/photos/${photoId}`, {}],
    [`/api/leads/${person.id}/renders`, { method: 'POST', body: settings(photoId), key: crypto.randomUUID() }],
    [`/api/leads/${person.id}/renders/${renderId}`, {}],
    [`/api/leads/${person.id}/renders/${renderId}/image`, {}],
  ];
  async function blocked(routes, expectedStatus = 403) {
    for (const [path, options] of routes) {
      const response = await request(env, path, { ...options, token: person.token });
      assert.equal(response.status, expectedStatus, path);
      if (expectedStatus === 403) assert.equal((await response.json()).error.code, 'BOOKING_REQUIRED');
    }
  }
  await withFetch(async () => { providerCalls++; return renderedResponse(); }, async () => {
    const sessionPath = `/api/leads/${person.id}/session`;
    const before = await (await request(env, sessionPath, { token: person.token })).json();
    assert.equal(before.visualizerUnlocked, false); assert.deepEqual(before.booking, { status: 'none' });
    await blocked(studioRoutes(fakePhoto, fakeRender));
    await request(env, `/api/leads/${person.id}/consultation`, { method: 'POST', body: { consultationPreference: 'schedule_now' }, token: person.token });
    await blocked(studioRoutes(fakePhoto, fakeRender));
    confirmBooking(env, person, 'pending'); await blocked(studioRoutes(fakePhoto, fakeRender));
    assert.equal(providerCalls, 0); assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_attempts').get().n, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads WHERE id=?').get(person.id).remaining_renders, 3);
    const eventId = confirmBooking(env, person);
    const booked = await (await request(env, sessionPath, { token: person.token })).json();
    assert.equal(booked.booking.status, 'confirmed'); assert.equal(booked.visualizerUnlocked, true);
    const uploaded = await photo(env, person);
    const render = await (await request(env, `/api/leads/${person.id}/renders`, { method: 'POST', body: settings(uploaded.id), key: crypto.randomUUID(), token: person.token })).json();
    assert.equal(render.status, 'completed'); assert.equal(providerCalls, 1);
    calendarUnavailable.add(eventId); await blocked(studioRoutes(uploaded.id, render.id), 503);
    assert.equal((await request(env, sessionPath, { token: person.token })).status, 503); calendarUnavailable.delete(eventId);
    calendarEvents.get(eventId).isCancelled = true;
    const cancelled = await (await request(env, sessionPath, { token: person.token })).json();
    assert.equal(cancelled.booking.status, 'cancelled'); assert.equal(cancelled.visualizerUnlocked, false);
    assert.deepEqual(cancelled.photos, []); assert.deepEqual(cancelled.renders, []);
    await blocked(studioRoutes(uploaded.id, render.id));
    assert.equal(providerCalls, 1); assert.equal(env.DB.sqlite.prepare('SELECT attempts FROM daily_attempts').get().attempts, 1);
    assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads WHERE id=?').get(person.id).remaining_renders, 2);
  });
});

test('new-device authenticated session reconciles a pending Outlook transaction by reads alone and fails closed on read outage', async () => {
  const env = environment(), person = await lead(env), eventId = confirmBooking(env, person, 'pending');
  const sessionPath = `/api/leads/${person.id}/session`, beforeCreates = graphCreates;
  let renderCalls = 0;
  await withFetch(async () => { renderCalls++; return renderedResponse(); }, async () => {
    try {
      // A new device has only the private lead token, never the original client booking request key.
      const pending = await (await request(env, sessionPath, { token: person.token })).json();
      assert.equal(pending.booking.status, 'pending'); assert.equal(pending.visualizerUnlocked, false);
      calendarViewEvents = [calendarEvents.get(eventId)];
      const recovered = await request(env, sessionPath, { token: person.token }); assert.equal(recovered.status, 200);
      const confirmed = await recovered.json(); assert.equal(confirmed.booking.status, 'confirmed'); assert.equal(confirmed.visualizerUnlocked, true);
      const row = env.DB.sqlite.prepare('SELECT * FROM consultation_bookings WHERE lead_id=?').get(person.id);
      assert.equal(row.status, 'confirmed'); assert.equal(row.graph_event_id, eventId);

      // Even a saved event ID is insufficient if Outlook cannot verify a pending record.
      env.DB.sqlite.prepare("UPDATE consultation_bookings SET status='pending' WHERE lead_id=?").run(person.id);
      calendarUnavailable.add(eventId);
      const outage = await request(env, sessionPath, { token: person.token }); assert.equal(outage.status, 503);
      assert.equal(env.DB.sqlite.prepare('SELECT status FROM consultation_bookings WHERE lead_id=?').get(person.id).status, 'pending');
      assert.equal(graphCreates, beforeCreates); assert.equal(renderCalls, 0);
      assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads WHERE id=?').get(person.id).remaining_renders, 3);
      assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_attempts').get().n, 0);
    } finally { calendarViewEvents = []; calendarUnavailable.delete(eventId); }
  });
});

test('booking route requires a project address after compact lead capture and validates optional booking email before Graph', async () => {
  const env = environment(), person = await lead(env, { name: 'Compact Lead', phone: '7045550203', contactConsent: true });
  for (const body of [{}, { address: '' }, { address: 'x'.repeat(181) }]) {
    const response = await request(env, `/api/leads/${person.id}/consultation/book`, { method: 'POST', body, token: person.token });
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVALID_ADDRESS');
  }
  const email = await request(env, `/api/leads/${person.id}/consultation/book`, { method: 'POST', body: { address: '12 Test Street', email: 'invalid' }, token: person.token });
  assert.equal(email.status, 400); assert.equal((await email.json()).error.code, 'INVALID_EMAIL');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM consultation_bookings').get().n, 0);
});

test('authenticated phone-only lead chooses a real adapter slot and unlocks only after verified mocked Outlook confirmation', async () => {
  const env = environment(), person = await lead(env, { fullName: 'Booking Visitor', phone: '7045550204', contactConsent: true });
  const base = `/api/leads/${person.id}/consultation`, beforeCreates = graphCreates;
  assert.equal((await request(env, `${base}/slots`)).status, 401);
  const slots = await request(env, `${base}/slots`, { token: person.token }); assert.equal(slots.status, 200);
  const choices = await slots.json(); assert.equal(choices.bookingAvailable, true); assert.ok(choices.slots.length > 0);
  assert.equal(choices.durationMinutes, 90); assert.equal(choices.bufferMinutes, 30);
  const options = { method: 'POST', token: person.token, key: crypto.randomUUID(), body: {
    start: choices.slots[0].start, address: '  44 Test Project Lane  ', city: 'Matthews', state: 'nc', zip: '28105' } };
  const booked = await request(env, `${base}/book`, options); assert.equal(booked.status, 200);
  const result = await booked.json(); assert.equal(result.booking.status, 'confirmed'); assert.equal(result.visualizerUnlocked, true);
  assert.equal(Date.parse(result.booking.end) - Date.parse(result.booking.start), 90 * 60000); assert.equal(graphCreates, beforeCreates + 1);
  const repeated = await request(env, `${base}/book`, options); assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), result); assert.equal(graphCreates, beforeCreates + 1);
  const row = env.DB.sqlite.prepare('SELECT * FROM leads WHERE id=?').get(person.id);
  assert.equal(row.address, '44 Test Project Lane'); assert.equal(row.email, ''); assert.equal(row.consultation_preference, 'schedule_now');
  assert.equal(row.city, 'Matthews'); assert.equal(row.state, 'NC'); assert.equal(row.zip, '28105');
  assert.equal(row.remaining_renders, 3); assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_attempts').get().n, 0);
  const stored = env.DB.sqlite.prepare('SELECT * FROM consultation_bookings WHERE lead_id=?').get(person.id);
  assert.equal(stored.status, 'confirmed'); assert.equal(stored.attendee_email, '');
  const event = calendarEvents.get(stored.graph_event_id); assert.equal(event.attendees, undefined);
  assert.match(event.body.content, /44 Test Project Lane/);
  const session = await (await request(env, `/api/leads/${person.id}/session`, { token: person.token })).json();
  assert.equal(session.visualizerUnlocked, true); assert.equal(session.lead.address, '44 Test Project Lane');
});

test('structured address selections persist from initial capture and booking updates without stale manual-edit parts', async () => {
  const cases = [
    { label: 'unchanged address preserves selected parts for older clients', update: {}, expected: ['Charlotte', 'NC', '28277'] },
    { label: 'new selected address replaces every part', update: { address: ' 22 New Road, Fort Mill, SC 29708 ', city: ' Fort Mill ', state: 'sc', zip: '29708' }, expected: ['Fort Mill', 'SC', '29708'] },
    { label: 'manual new address clears stale parts for older clients', update: { address: 'Unstructured new address' }, expected: ['', '', ''] },
    { label: 'manual edit explicitly clears the selection', update: { address: 'Manual address', city: '', state: '', zip: '' }, expected: ['', '', ''] },
    { label: 'explicit empty parts clear even an unchanged display address', update: { city: '', state: '', zip: '' }, expected: ['', '', ''] },
  ];
  for (const item of cases) {
    const env = environment({ BOOKING_PROVIDER: 'internal' });
    const person = await lead(env, { name: 'Address Visitor', phone: '7045550401', address: '11 Original Street, Charlotte, NC 28277',
      city: 'Charlotte', state: 'nc', zip: '28277', contactConsent: true });
    const initial = await (await request(env, `/api/leads/${person.id}/session`, { token: person.token })).json();
    assert.equal(initial.lead.city, 'Charlotte'); assert.equal(initial.lead.state, 'NC'); assert.equal(initial.lead.zip, '28277');
    const slots = await (await request(env, `/api/leads/${person.id}/consultation/slots`, { token: person.token })).json();
    const options = { method: 'POST', token: person.token, key: crypto.randomUUID(), body: { start: slots.slots[0].start, ...item.update } };
    const response = await request(env, `/api/leads/${person.id}/consultation/book`, options);
    assert.equal(response.status, 200, item.label); assert.equal((await response.json()).visualizerUnlocked, true);
    const row = env.DB.sqlite.prepare('SELECT address,city,state,zip FROM leads WHERE id=?').get(person.id);
    assert.deepEqual([row.city, row.state, row.zip], item.expected, item.label);
    assert.equal(row.address, (item.update.address || initial.lead.address).trim());
    const recovered = await (await request(env, `/api/leads/${person.id}/session`, { token: person.token })).json();
    assert.deepEqual([recovered.lead.city, recovered.lead.state, recovered.lead.zip], item.expected);
    assert.equal((await request(env, `/api/leads/${person.id}/consultation/book`, options)).status, 200, 'Identical request remains idempotent.');
    const changed = await request(env, `/api/leads/${person.id}/consultation/book`, {
      ...options, body: { ...options.body, city: 'Changed City', state: 'VA', zip: '22101' } });
    assert.equal(changed.status, 409); assert.equal((await changed.json()).error.code, 'ALREADY_BOOKED');
    assert.deepEqual(Object.assign({}, env.DB.sqlite.prepare('SELECT address,city,state,zip FROM leads WHERE id=?').get(person.id)), Object.assign({}, row));
  }
});

test('booking rejects invalid optional city state ZIP before reserving or changing saved contact fields', async () => {
  const env = environment({ BOOKING_PROVIDER: 'internal' }), person = await lead(env, {
    name: 'Address Validation', phone: '7045550402', address: '11 Original Street', city: 'Charlotte', state: 'NC', zip: '28277', contactConsent: true });
  const initial = env.DB.sqlite.prepare('SELECT address,city,state,zip FROM leads WHERE id=?').get(person.id);
  for (const parts of [{ city: 'a'.repeat(101) }, { city: [] }, { state: 'North Carolina' }, { state: '1C' }, { zip: 'bad' }, { zip: '123456' }]) {
    const response = await request(env, `/api/leads/${person.id}/consultation/book`, { method: 'POST', token: person.token,
      key: crypto.randomUUID(), body: { address: '12 New Street', start: '2026-11-01T15:00:00.000Z', ...parts } });
    assert.equal(response.status, 400);
    assert.deepEqual(env.DB.sqlite.prepare('SELECT address,city,state,zip FROM leads WHERE id=?').get(person.id), initial);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM consultation_bookings').get().n, 0);
  }
});

test('internal scheduler dispatch confirms in D1 without Microsoft credentials and staff can block, list and cancel privately', async () => {
  const env = environment({ BOOKING_PROVIDER: 'internal', MICROSOFT_TENANT_ID: '', MICROSOFT_CLIENT_ID: '',
    MICROSOFT_CLIENT_SECRET: '', MICROSOFT_REFRESH_TOKEN: '' });
  let externalCalls = 0;
  await withFetch(async () => { externalCalls++; throw new Error('Internal scheduling must not contact a provider.'); }, async () => {
    const health = await (await request(env, '/api/health')).json();
    assert.equal(health.ready, true); assert.equal(health.bookingAvailable, true);
    const person = await lead(env, { name: 'Internal Visitor', phone: '7045550301', contactConsent: true });
    const slotsPath = `/api/leads/${person.id}/consultation/slots`;
    const initial = await (await request(env, slotsPath, { token: person.token })).json(); assert.ok(initial.slots.length > 0);
    const blockedSlot = initial.slots[0], blockBody = { start: blockedSlot.start, end: blockedSlot.end, note: 'Team unavailable' };
    const protectedRoutes = [
      ['/api/admin/bookings', {}], ['/api/admin/blocks', { method: 'POST', body: blockBody }],
      [`/api/admin/blocks/${crypto.randomUUID()}`, { method: 'DELETE' }],
      [`/api/admin/bookings/${person.id}/cancel`, { method: 'POST' }],
    ];
    for (const token of [undefined, 'forged-administrator-token-with-enough-characters', person.token]) {
      for (const [path, options] of protectedRoutes) assert.equal((await request(env, path, { ...options, token })).status, 401);
    }
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM booking_time_blocks').get().n, 0);
    const created = await request(env, '/api/admin/blocks', { method: 'POST', body: blockBody, token: env.ADMIN_TOKEN });
    assert.equal(created.status, 201); const block = await created.json();
    assert.match(block.id, /^[0-9a-f-]{36}$/); assert.equal(block.start, blockedSlot.start); assert.equal(block.note, 'Team unavailable');
    const duplicate = await request(env, '/api/admin/blocks', { method: 'POST', body: blockBody, token: env.ADMIN_TOKEN });
    assert.equal(duplicate.status, 201); assert.equal((await duplicate.json()).id, block.id);
    const remaining = await (await request(env, slotsPath, { token: person.token })).json();
    assert.equal(remaining.slots.some(slot => slot.start === blockedSlot.start), false); assert.ok(remaining.slots.length > 0);
    const chosen = remaining.slots[0];
    const booked = await request(env, `/api/leads/${person.id}/consultation/book`, { method: 'POST', token: person.token,
      key: crypto.randomUUID(), body: { start: chosen.start, address: '17 Internal Project Road' } });
    assert.equal(booked.status, 200); const booking = await booked.json();
    assert.equal(booking.booking.status, 'confirmed'); assert.equal(booking.visualizerUnlocked, true);
    const stored = env.DB.sqlite.prepare('SELECT * FROM consultation_bookings WHERE lead_id=?').get(person.id);
    assert.equal(stored.graph_event_id, null); assert.match(stored.calendar_key, /^internal:/);
    const listedResponse = await request(env, '/api/admin/bookings', { token: env.ADMIN_TOKEN });
    assert.equal(listedResponse.headers.get('Cache-Control'), 'no-store'); const listed = await listedResponse.json();
    const appointment = listed.bookings.find(item => item.leadId === person.id);
    assert.equal(appointment.name, 'Internal Visitor'); assert.equal(appointment.phone, '7045550301');
    assert.equal(appointment.email, ''); assert.equal(appointment.address, '17 Internal Project Road');
    assert.equal(appointment.status, 'confirmed'); assert.equal(appointment.start, chosen.start); assert.equal(appointment.timeZone, 'America/New_York');
    assert.equal(listed.blocks.some(item => item.id === block.id), true);
    for (const secret of [person.token, env.ADMIN_TOKEN, env.RATE_LIMIT_SALT]) assert.equal(JSON.stringify(listed).includes(secret), false);
    const conflict = await request(env, '/api/admin/blocks', { method: 'POST', token: env.ADMIN_TOKEN,
      body: { start: chosen.start, end: chosen.end, note: 'Cannot block a confirmed appointment' } });
    assert.equal(conflict.status, 409);
    const cancelled = await request(env, `/api/admin/bookings/${person.id}/cancel`, { method: 'POST', token: env.ADMIN_TOKEN });
    assert.equal(cancelled.status, 200); assert.deepEqual(await cancelled.json(), { leadId: person.id, status: 'cancelled', visualizerUnlocked: false });
    const session = await (await request(env, `/api/leads/${person.id}/session`, { token: person.token })).json();
    assert.equal(session.visualizerUnlocked, false); assert.equal(session.booking.status, 'cancelled');
    const denied = await request(env, `/api/leads/${person.id}/renders`, { method: 'POST', token: person.token,
      key: crypto.randomUUID(), body: settings(crypto.randomUUID()) }); assert.equal(denied.status, 403);
    for (let retry = 0; retry < 2; retry++) {
      const removed = await request(env, `/api/admin/blocks/${block.id}`, { method: 'DELETE', token: env.ADMIN_TOKEN });
      assert.equal(removed.status, 200); assert.deepEqual(await removed.json(), { id: block.id, deleted: true });
    }
    const final = await (await request(env, '/api/admin/bookings', { token: env.ADMIN_TOKEN })).json();
    assert.deepEqual(final.bookings, []); assert.deepEqual(final.blocks, []);
    assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads WHERE id=?').get(person.id).remaining_renders, 3);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_attempts').get().n, 0); assert.equal(externalCalls, 0);
    const preflight = await request(env, '/api/admin/blocks', { method: 'OPTIONS' });
    assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /DELETE/);
  });
});

test('staff internal endpoints reject Graph mode, malformed blocks and unavailable administrator authorization', async () => {
  const graph = environment();
  const unavailable = await request({ ...graph, ADMIN_TOKEN: '' }, '/api/admin/bookings', { token: graph.ADMIN_TOKEN });
  assert.equal(unavailable.status, 503);
  const wrongProvider = await request(graph, '/api/admin/bookings', { token: graph.ADMIN_TOKEN });
  assert.equal(wrongProvider.status, 409); assert.equal((await wrongProvider.json()).error.code, 'INTERNAL_SCHEDULER_REQUIRED');
  const env = environment({ BOOKING_PROVIDER: 'internal' });
  const start = new Date(Date.now() + 86400000).toISOString(), end = new Date(Date.now() + 90000000).toISOString();
  for (const body of [null, [], {}, { start, end: start }, { start, end: '2026-02-30T15:00:00.000Z' },
    { start: start.replace('Z', ''), end }, { start, end, note: 'x'.repeat(501) }]) {
    const response = await request(env, '/api/admin/blocks', { method: 'POST', body, token: env.ADMIN_TOKEN });
    assert.equal(response.status, 400); const error = await response.json();
    assert.equal(JSON.stringify(error).includes(env.ADMIN_TOKEN), false);
  }
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM booking_time_blocks').get().n, 0);
});

test('internal scheduling block migration is additive and leaves existing lead authentication and media intact', async () => {
  const env = environment(), person = await lead(env), uploaded = await photo(env, person);
  const before = env.DB.sqlite.prepare('SELECT token_hash,remaining_renders FROM leads WHERE id=?').get(person.id);
  env.DB.sqlite.exec('DROP TABLE booking_time_blocks');
  env.DB.sqlite.exec(readFileSync(new URL('../backend/migrations/0003_internal_schedule_blocks.sql', import.meta.url), 'utf8'));
  assert.deepEqual(env.DB.sqlite.prepare('SELECT token_hash,remaining_renders FROM leads WHERE id=?').get(person.id), before);
  assert.equal((await request(env, `/api/leads/${person.id}/session`, { token: person.token })).status, 200);
  assert.equal(env.DB.sqlite.prepare('SELECT id FROM photos WHERE id=?').get(uploaded.id).id, uploaded.id);
  assert.equal(env.PHOTOS.files.size, 1); assert.deepEqual(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('consultation preference saves, recovers and exports intent for both choices without claiming a booking', async () => {
  const env = environment();
  const invalid = await request(env, '/api/leads', { method: 'POST', body: { ...sample(), consultationPreference: 'booked' } });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_CONSULTATION_PREFERENCE');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 0);
  for (const preference of ['contact_me', 'schedule_now']) {
    const person = await lead(env, { ...sample(), phone: preference === 'contact_me' ? '7045550101' : '7045550102', email: `${preference}@example.com`, consultationPreference: preference });
    assert.equal(person.consultationPreference, preference);
    const row = env.DB.sqlite.prepare('SELECT * FROM leads WHERE id=?').get(person.id);
    assert.equal(row.consultation_preference, preference); assert.equal(row.remaining_renders, 3);
    const response = await request(env, `/api/leads/${person.id}/session`, { token: person.token });
    assert.equal(response.status, 200); const session = await response.json();
    assert.equal(session.consultationPreference, preference); assert.equal(session.remainingRenders, 3);
    assert.deepEqual(session.photos, []); assert.deepEqual(session.renders, []);
    assert.equal('booked' in session, false); assert.equal('bookingStatus' in session, false);
  }
  const exported = await request(env, '/api/admin/leads.csv', { token: env.ADMIN_TOKEN });
  assert.equal(exported.status, 200); const csv = await exported.text();
  const rows = csv.replace(/^\uFEFF/, '').split('\r\n').map(line => line.split(',').map(cell => cell.slice(1, -1)));
  const preferenceColumn = rows[0].indexOf('consultation_preference'), emailColumn = rows[0].indexOf('email');
  assert.ok(preferenceColumn >= 0);
  for (const preference of ['contact_me', 'schedule_now']) {
    assert.equal(rows.find(row => row[emailColumn] === `${preference}@example.com`)[preferenceColumn], preference);
  }
  assert.equal(rows[0].includes('booked'), false); assert.equal(rows[0].includes('booking_status'), false);
});

test('saved lead can request a consultation idempotently without another lead, booking or render charge', async () => {
  const env = environment(), person = await lead(env), other = await lead(env, { ...sample(), phone: '7045550102', email: 'another@example.com' });
  const path = `/api/leads/${person.id}/consultation`, body = { consultationPreference: 'schedule_now' };
  let providerCalls = 0;
  await withFetch(async () => { providerCalls++; return renderedResponse(); }, async () => {
    for (const token of [undefined, 'forged-visitor-token-with-enough-characters', other.token]) {
      const response = await request(env, path, { method: 'POST', body, token });
      assert.equal(response.status, 401);
    }
    assert.equal(env.DB.sqlite.prepare('SELECT consultation_preference FROM leads WHERE id=?').get(person.id).consultation_preference, 'contact_me');
    const invalid = await request(env, path, { method: 'POST', body: { consultationPreference: 'booked' }, token: person.token });
    assert.equal(invalid.status, 400);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(env, path, { method: 'POST', body, token: person.token });
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), body);
    }
    const session = await (await request(env, `/api/leads/${person.id}/session`, { token: person.token })).json();
    assert.equal(session.consultationPreference, 'schedule_now'); assert.equal(session.remainingRenders, 3);
    assert.equal('booked' in session, false); assert.equal('bookingStatus' in session, false);
    const csv = await (await request(env, '/api/admin/leads.csv', { token: env.ADMIN_TOKEN })).text();
    assert.ok(csv.includes('"consultation_preference"')); assert.ok(csv.includes('"schedule_now"'));
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 2);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM renders').get().n, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_attempts').get().n, 0);
    assert.equal(providerCalls, 0);
  });
});

test('lead submission stores a hashed token, deduplicates normalized phone per server event, records consent', async () => {
  const env = environment(), person = await lead(env);
  const row = env.DB.sqlite.prepare('SELECT * FROM leads').get();
  assert.equal(row.token_hash, await hash(person.token)); assert.notEqual(row.token_hash, person.token);
  assert.equal(row.consent_version, '2026-10-21-v1'); assert.ok(row.consent_at);
  const duplicate = await request(env, '/api/leads', { method: 'POST', body: { ...sample(), phone: '+1 555-123-4567', email: 'different@example.com', event: 'changed by visitor' } });
  assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).token, undefined);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1);
  const nextEvent = await lead({ ...env, EVENT_ID: 'show-2' }); assert.notEqual(nextEvent.id, person.id);
});

test('lead rate limit hashes IP and expires old buckets', async () => {
  const env = environment({ LEADS_PER_IP_HOUR: '1' }); await lead(env);
  const response = await request(env, '/api/leads', { method: 'POST', body: { ...sample(), email: 'other@example.com' } });
  assert.equal(response.status, 429);
  const row = env.DB.sqlite.prepare('SELECT * FROM rate_limits').get();
  assert.match(row.bucket, /^[0-9a-f]{64}$/); assert.equal(row.bucket.includes('203.0.113.8'), false);
});

test('lost lead response can be retried with the same client token, key and payload, never taken over', async () => {
  const env = environment(), clientToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const options = { method: 'POST', body: sample(), key: crypto.randomUUID(), headers: { 'X-Lead-Token': clientToken } };
  const first = await request(env, '/api/leads', options); assert.equal(first.status, 201);
  const original = await first.json(); assert.equal(original.token, clientToken);
  const retry = await request(env, '/api/leads', options); assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), original);
  const changed = await request(env, '/api/leads', { ...options, body: { ...sample(), firstName: 'Changed' } });
  assert.equal(changed.status, 409);
  const changedIntent = await request(env, '/api/leads', { ...options, body: { ...sample(), consultationPreference: 'schedule_now' } });
  assert.equal(changedIntent.status, 409);
  const takeover = await request(env, '/api/leads', { ...options, headers: { 'X-Lead-Token': 'a'.repeat(43) } });
  assert.equal(takeover.status, 409); assert.equal((await takeover.text()).includes(clientToken), false);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1);
});

test('post-lead studio requires a saved lead and its bearer on every session, photo and render route', async () => {
  const env = environment(); let providerCalls = 0;
  const forgedToken = 'unregistered-visitor-token-with-enough-characters';
  function protectedRoutes(personId, photoId, renderId) {
    const upload = new FormData();
    upload.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'home.jpg');
    return [
      [`/api/leads/${personId}/session`, {}],
      [`/api/leads/${personId}/consultation`, { method: 'POST', body: { consultationPreference: 'schedule_now' } }],
      [`/api/leads/${personId}/photos`, { method: 'POST', body: upload }],
      [`/api/leads/${personId}/photos/${photoId}`, {}],
      [`/api/leads/${personId}/renders`, { method: 'POST', body: settings(photoId), key: crypto.randomUUID() }],
      [`/api/leads/${personId}/renders/${renderId}`, {}],
      [`/api/leads/${personId}/renders/${renderId}/image`, {}],
    ];
  }
  async function denied(routes, tokens) {
    for (const token of tokens) for (const [path, options] of routes) {
      const response = await request(env, path, { ...options, token });
      assert.equal(response.status, 401, `${options.method || 'GET'} ${path} must require the saved lead's bearer`);
      assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
    }
  }
  const count = table => env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  await withFetch(async () => { providerCalls++; return renderedResponse(); }, async () => {
    // No valid submission exists. Guessed IDs and a syntactically valid forged bearer cannot unlock the perk.
    await denied(protectedRoutes(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()), [undefined, forgedToken]);
    const invalid = await request(env, '/api/leads', { method: 'POST', body: { ...sample(), contactConsent: false } });
    assert.equal(invalid.status, 400);
    assert.equal(count('leads'), 0); assert.equal(count('photos'), 0); assert.equal(count('renders'), 0);
    assert.equal(count('daily_attempts'), 0); assert.equal(env.PHOTOS.files.size, 0); assert.equal(providerCalls, 0);

    // Saving a lead enables its own session; an additional saved lead still cannot access this visitor's studio.
    const person = await lead(env), other = await lead(env, { ...sample(), phone: '7045550102', email: 'another@example.com' });
    const uploaded = await photo(env, person);
    const routes = protectedRoutes(person.id, uploaded.id, crypto.randomUUID());
    await denied(routes, [undefined, forgedToken, other.token]);
    assert.equal((await request(env, `/api/leads/${person.id}/session`, { token: person.token })).status, 200);
    assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads WHERE id=?').get(person.id).remaining_renders, 3);
    assert.equal(count('renders'), 0); assert.equal(count('daily_attempts'), 0); assert.equal(providerCalls, 0);

    // A real authenticated render proves the positive path, then its actual metadata and bytes stay private.
    const completed = await request(env, `/api/leads/${person.id}/renders`, {
      method: 'POST', body: settings(uploaded.id), token: person.token, key: crypto.randomUUID() });
    assert.equal(completed.status, 201); const render = await completed.json();
    assert.equal(providerCalls, 1); assert.equal(render.remainingRenders, 2);
    await denied(protectedRoutes(person.id, uploaded.id, render.id), [undefined, forgedToken, other.token]);
    assert.equal(providerCalls, 1); assert.equal(count('renders'), 1); assert.equal(count('photos'), 1);
    assert.equal(env.DB.sqlite.prepare('SELECT attempts FROM daily_attempts').get().attempts, 1);
    assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads WHERE id=?').get(person.id).remaining_renders, 2);
  });
});

test('private photo upload checks magic bytes, MIME, size, ownership and eight-photo limit', async () => {
  assert.equal(detectImage(jpeg), 'image/jpeg'); assert.equal(detectImage(new Uint8Array([1, 2, 3])), null);
  const env = environment(), person = await lead(env), uploaded = await photo(env, person);
  assert.equal((await request(env, uploaded.url)).status, 401);
  assert.equal((await request(env, uploaded.url, { token: 'a-different-visitor-token-that-is-long-enough' })).status, 401);
  const image = await request(env, uploaded.url, { token: person.token });
  assert.equal(image.status, 200); assert.equal(image.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), jpeg);
  const bad = new FormData(); bad.append('photo', new Blob(['<svg onload=evil()>'], { type: 'image/png' }), 'evil.png');
  assert.equal((await request(env, `/api/leads/${person.id}/photos`, { method: 'POST', body: bad, token: person.token })).status, 415);
  const tooLarge = new FormData(); tooLarge.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'home.jpg');
  assert.equal((await request(env, `/api/leads/${person.id}/photos`, { method: 'POST', body: tooLarge, token: person.token,
    headers: { 'Content-Length': String(12 * 1024 * 1024) } })).status, 413);
  const duplicate = new FormData(); duplicate.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'home.jpg');
  const retried = await request(env, `/api/leads/${person.id}/photos`, { method: 'POST', body: duplicate, token: person.token });
  assert.equal(retried.status, 200); assert.equal((await retried.json()).id, uploaded.id);
  for (let i = 0; i < 7; i++) await photo(env, person, new Uint8Array([...jpeg, i]));
  const ninth = new FormData(); ninth.append('photo', new Blob([new Uint8Array([...jpeg, 99])], { type: 'image/jpeg' }), 'home.jpg');
  assert.equal((await request(env, `/api/leads/${person.id}/photos`, { method: 'POST', body: ninth, token: person.token })).status, 429);
});

test('authenticated session recovers its own lead, confirmed booking, photos, render history and budget without bearer leakage', async () => {
  const env = environment(), person = await lead(env), uploaded = await photo(env, person);
  let render;
  await withFetch(async () => renderedResponse(), async () => {
    render = await (await request(env, `/api/leads/${person.id}/renders`, {
      method: 'POST', body: settings(uploaded.id), token: person.token, key: 'session-render-key' })).json();
  });
  const path = `/api/leads/${person.id}/session`;
  assert.equal((await request(env, path)).status, 401);
  const recovered = await (await request(env, path, { token: person.token })).json();
  assert.equal(recovered.remainingRenders, 2); assert.deepEqual(recovered.photos, [uploaded]);
  assert.equal(recovered.renders[0].id, render.id); assert.equal(recovered.renders[0].colorHex, '#F2EFE5');
  assert.equal(recovered.renders[0].imageUrl, render.imageUrl);
  assert.equal(recovered.lead.email, sample().email); assert.equal(recovered.lead.phone, sample().phone);
  assert.equal(recovered.lead.address, sample().address); assert.equal(recovered.booking.status, 'confirmed');
  assert.equal(recovered.visualizerUnlocked, true); assert.equal(JSON.stringify(recovered).includes(person.token), false);
});

test('concurrent render requests reserve credits atomically and enforce three total', async () => {
  const env = environment(), person = await lead(env), uploaded = await photo(env, person); let calls = 0;
  await withFetch(async () => { calls++; return renderedResponse(); }, async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, (_, i) => request(env, `/api/leads/${person.id}/renders`,
      { method: 'POST', body: settings(uploaded.id), token: person.token, key: `preview-key-${i}` })));
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 201, 201, 429]); assert.equal(calls, 3);
  });
  assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders, 0);
  assert.equal(env.DB.sqlite.prepare('SELECT attempts FROM daily_attempts').get().attempts, 3);
});

test('idempotency avoids a second paid call, pending retry is safe, mismatched reuse fails', async () => {
  const env = environment(), person = await lead(env), uploaded = await photo(env, person); let finish, calls = 0;
  let announceStarted;
  const started = new Promise(resolve => { announceStarted = resolve; });
  await withFetch(() => { calls++; announceStarted(); return new Promise(resolve => { finish = resolve; }); }, async () => {
    const options = { method: 'POST', body: settings(uploaded.id), token: person.token, key: 'same-request-key' };
    const first = request(env, `/api/leads/${person.id}/renders`, options);
    await started; assert.equal(calls, 1);
    const pending = await request(env, `/api/leads/${person.id}/renders`, options);
    assert.equal(pending.status, 202); assert.equal((await pending.json()).status, 'pending');
    finish(renderedResponse());
    const completed = await (await first).json();
    assert.equal(completed.status, 'completed'); assert.equal(completed.remainingRenders, 2);
    const retry = await request(env, `/api/leads/${person.id}/renders`, options);
    assert.equal(retry.status, 200); assert.equal((await retry.json()).id, completed.id); assert.equal(calls, 1);
    const mismatch = await request(env, `/api/leads/${person.id}/renders`, { ...options, body: { ...options.body, colorHex: '#000000' } });
    assert.equal(mismatch.status, 409);
    assert.equal((await request(env, completed.imageUrl)).status, 401);
    assert.equal((await request(env, completed.imageUrl, { token: person.token })).status, 200);
  });
});

test('failed upstream refunds visitor once while daily paid-attempt cap is retained', async () => {
  const env = environment({ DAILY_RENDER_LIMIT: '1' }), person = await lead(env), uploaded = await photo(env, person);
  await withFetch(async () => new Response('provider-specific secret or error', { status: 500 }), async () => {
    const options = { method: 'POST', body: settings(uploaded.id), token: person.token, key: 'failed-render-key' };
    const response = await request(env, `/api/leads/${person.id}/renders`, options);
    assert.equal(response.status, 502); assert.equal((await response.text()).includes('provider-specific'), false);
    assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders, 3);
    const retry = await request(env, `/api/leads/${person.id}/renders`, options);
    assert.equal((await retry.json()).status, 'failed');
    assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders, 3);
    const capped = await request(env, `/api/leads/${person.id}/renders`, { ...options, key: 'new-render-request' });
    assert.equal(capped.status, 429); assert.equal((await capped.json()).error.code, 'DAILY_CAP');
    assert.equal(env.DB.sqlite.prepare('SELECT attempts FROM daily_attempts').get().attempts, 1);
  });
});

test('provider failures store only safe classified codes, refund once and never expose provider metadata', async () => {
  const cases = [
    { status: 401, providerCode: 'invalid_api_key', expected: 'RENDER_AUTH' },
    { status: 403, providerCode: 'model_not_found', expected: 'RENDER_AUTH' },
    { status: 429, providerCode: 'insufficient_quota', expected: 'RENDER_BILLING' },
    { status: 429, providerCode: 'billing_hard_limit_reached', expected: 'RENDER_BILLING' },
    { status: 429, providerType: 'insufficient_quota', expected: 'RENDER_BILLING' },
    { status: 429, providerCode: 'rate_limit_exceeded', expected: 'RENDER_RATE_LIMIT' },
    { status: 404, providerCode: 'model_not_found', expected: 'RENDER_MODEL_UNAVAILABLE' },
    { status: 400, providerCode: 'invalid_image', expected: 'RENDER_INVALID_REQUEST' },
    { status: 500, providerCode: 'internal_error', expected: 'RENDER_FAILED' },
    { status: 400, raw: '<html>upstream-body-private-value</html>', expected: 'RENDER_INVALID_REQUEST' },
    { status: 429, raw: 'upstream-body-private-value'.repeat(1000), expected: 'RENDER_RATE_LIMIT' },
    { status: 500, raw: 'upstream-body-private-value'.repeat(1000), declaredLength: 1000000, expected: 'RENDER_FAILED' },
  ];
  for (const item of cases) {
    const env = environment(), person = await lead(env), uploaded = await photo(env, person);
    const privateValues = ['upstream-body-private-value', 'upstream-request-private-id', person.token, env.RENDER_API_KEY, base64Jpeg];
    let calls = 0;
    await withFetch(async () => {
      calls++;
      return new Response(item.raw ?? JSON.stringify({ error: { code: item.providerCode, type: item.providerType,
        message: privateValues.join(' '), request_id: 'upstream-request-private-id', photo: base64Jpeg } }), {
        status: item.status, headers: { 'Content-Type': 'application/json', 'x-request-id': 'upstream-request-private-id',
          ...(item.declaredLength ? { 'Content-Length': String(item.declaredLength) } : {}) } });
    }, async () => {
      const options = { method: 'POST', body: settings(uploaded.id), token: person.token, key: crypto.randomUUID() };
      const response = await request(env, `/api/leads/${person.id}/renders`, options);
      assert.equal(response.status, 502, item.expected); const text = await response.text();
      const result = JSON.parse(text); assert.equal(result.error.code, item.expected);
      assert.match(result.error.message, /credit has been restored/);
      assert.equal(response.headers.get('x-request-id'), null);
      for (const value of privateValues) assert.equal(text.includes(value), false, item.expected);
      const stored = env.DB.sqlite.prepare('SELECT status,error_code FROM renders').get();
      assert.equal(stored.status, 'failed'); assert.equal(stored.error_code, item.expected);
      assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders, 3);
      assert.equal(env.DB.sqlite.prepare('SELECT attempts FROM daily_attempts').get().attempts, 1);
      const retry = await request(env, `/api/leads/${person.id}/renders`, options); assert.equal(retry.status, 200);
      const recovered = await retry.text(); assert.equal(JSON.parse(recovered).error.code, item.expected);
      for (const value of privateValues) assert.equal(recovered.includes(value), false);
      assert.equal(calls, 1); assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders, 3);
    });
  }
});

test('interrupted pending render recovers visitor budget once after five minutes', async () => {
  const env = environment(), person = await lead(env), uploaded = await photo(env, person);
  const id = crypto.randomUUID(), old = new Date(Date.now() - 10 * 60000).toISOString();
  env.DB.sqlite.prepare(`INSERT INTO renders (id,lead_id,photo_id,request_key,input_hash,status,day,daily_limit,color_name,color_hex,surface,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?)`).run(id, person.id, uploaded.id, 'stale-key', 'hash', old.slice(0, 10), 50, 'White', '#FFFFFF', 'siding', old, old);
  assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders, 2);
  const path = `/api/leads/${person.id}/renders/${id}`;
  const response = await request(env, path, { token: person.token });
  assert.equal((await response.json()).status, 'failed');
  await request(env, path, { token: person.token });
  assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders, 3);
});

test('CSV requires separate admin credential and prevents spreadsheet formula injection', async () => {
  const env = environment(), person = await lead(env, { ...sample(), notes: '=HYPERLINK("https://evil.example","click")', phone: '+15551234567' });
  assert.equal((await request(env, '/api/admin/leads.csv')).status, 401);
  assert.equal((await request(env, '/api/admin/leads.csv', { token: person.token })).status, 401);
  const response = await request(env, '/api/admin/leads.csv', { token: env.ADMIN_TOKEN });
  assert.equal(response.status, 200); const csv = await response.text();
  assert.ok(csv.includes('"\'=HYPERLINK(""https://evil.example"",""click"")"'));
  assert.ok(csv.includes('"\'+15551234567"')); assert.equal(csv.includes(person.token), false);
  assert.equal(csv.includes('token_hash'), false);
  assert.equal(csvCell('normal,"quoted"'), '"normal,""quoted"""');
  assert.equal(csvCell('  =1+1'), '"\'  =1+1"');
});

test('renderer adapter uses server secrets and validates inline output; no URL fetch', async () => {
  const env = environment(); let calls = 0;
  const result = await callRenderer(env, { bytes: jpeg, mime: 'image/jpeg' }, settings('photo'), async (url, init) => {
    calls++; assert.equal(url, env.RENDER_API_URL); assert.equal(init.headers.Authorization, `Bearer ${env.RENDER_API_KEY}`);
    assert.equal(init.redirect, 'manual'); assert.equal(JSON.parse(init.body).image_base64, base64Jpeg); return renderedResponse();
  });
  assert.deepEqual(result.bytes, jpeg); assert.equal(calls, 1);
  await assert.rejects(callRenderer(env, { bytes: jpeg, mime: 'image/jpeg' }, settings('photo'), async () =>
    new Response(JSON.stringify({ image_url: 'http://169.254.169.254/secret' }))), /unsupported image/);
  const openai = { ...env, RENDER_API_URL: '', RENDER_API_KEY: '', OPENAI_API_KEY: 'server-only-openai-key' };
  await callRenderer(openai, { bytes: jpeg, mime: 'image/jpeg' }, { ...settings('photo'), surface: 'Cabinets' }, async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits'); assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('model'), 'gpt-image-1.5'); assert.equal(init.body.get('n'), '1');
    assert.equal(init.body.get('image[]').type, 'image/jpeg');
    assert.match(init.body.get('prompt'), /Change only the Cabinets/);
    assert.match(init.body.get('prompt'), /Preserve the exact scene geometry/);
    assert.doesNotMatch(init.body.get('prompt'), /exterior repaint/);
    assert.equal(init.headers.Authorization, 'Bearer server-only-openai-key');
    return new Response(JSON.stringify({ data: [{ b64_json: base64Jpeg }] }));
  });
});

test('disabled renderer does not consume visitor credit or pretend a render succeeded', async () => {
  const env = environment({ RENDER_API_URL: '', RENDER_API_KEY: '' }), person = await lead(env), uploaded = await photo(env, person);
  const response = await request(env, `/api/leads/${person.id}/renders`, {
    method: 'POST', body: settings(uploaded.id), token: person.token, key: 'disabled-render-key' });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'RENDER_UNAVAILABLE');
  assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders, 3);
});

test('RENDER_ENABLED false disables configured providers before any image request, reservation or charge', async () => {
  for (const provider of [
    {}, { RENDER_API_URL: '', RENDER_API_KEY: '', OPENAI_API_KEY: 'test-only-server-image-key' },
  ]) {
    const env = environment({ ...provider, RENDER_ENABLED: 'false' }), person = await lead(env), uploaded = await photo(env, person);
    assert.equal(configuration(env).renderEnabled, false); assert.equal(configuration(env).renderAvailable, false);
    assert.equal(configuration({ ...env, RENDER_ENABLED: undefined }).renderEnabled, true);
    const health = await (await request(env, '/api/health')).json(); assert.equal(health.ready, true); assert.equal(health.renderAvailable, false);
    let calls = 0;
    await withFetch(async () => { calls++; throw new Error('No image request may be sent while disabled.'); }, async () => {
      const response = await request(env, `/api/leads/${person.id}/renders`, {
        method: 'POST', body: settings(uploaded.id), token: person.token, key: crypto.randomUUID() });
      assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'RENDER_UNAVAILABLE');
      await assert.rejects(callRenderer(env, { bytes: jpeg, mime: 'image/jpeg' }, settings(uploaded.id), async () => {calls++;}),
        error => error.code === 'RENDER_UNAVAILABLE');
      assert.equal(calls, 0);
    });
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM renders').get().n, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_attempts').get().n, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT remaining_renders FROM leads').get().remaining_renders, 3);
  }
});

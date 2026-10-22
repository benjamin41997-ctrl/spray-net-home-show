import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { validateLead, detectImage, csvCell, configuration, callRenderer, hash } from '../backend/worker.mjs';

const schema = readFileSync(new URL('../backend/schema.sql', import.meta.url), 'utf8');
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
const base64Jpeg = Buffer.from(jpeg).toString('base64');
const origin = 'https://example.github.io';
const sample = () => ({ firstName: 'Alex', lastName: 'Homeowner', email: 'Alex@example.com', phone: '(555) 123-4567',
  address: '12 Example St', city: 'Tampa', state: 'FL', zip: '33602', service: 'Exterior siding',
  timeline: 'Within 3 months', notes: '', event: 'October Home Show', contactConsent: true });

function database() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
  return { sqlite, prepare(sql) {
    const statement = sqlite.prepare(sql); let bindings = [];
    return {
      bind(...values) { bindings = values; return this; },
      async first() { return statement.get(...bindings) || null; },
      async all() { return { results: statement.all(...bindings) }; },
      async run() { const result = statement.run(...bindings); return { meta: { changes: Number(result.changes) } }; },
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
  const form = new FormData(); form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'home.jpg');
  const response = await request(env, `/api/leads/${person.id}/photos`, { method: 'POST', body: form, token: person.token });
  assert.equal(response.status, 201); return response.json();
}
const settings = photoId => ({ photoId, colorName: 'Warm white', colorHex: '#F2EFE5', surface: 'siding' });
function renderedResponse() { return new Response(JSON.stringify({ image_base64: base64Jpeg, mime_type: 'image/jpeg' })); }
async function withFetch(fetcher, work) {
  const previous = globalThis.fetch; globalThis.fetch = fetcher;
  try { return await work(); } finally { globalThis.fetch = previous; }
}

test('readiness fails closed for missing bindings, secrets, schema; CORS requires exact origins', async () => {
  const unconfigured = await request({}, '/api/health', { headers: { Origin: '' } });
  assert.deepEqual(await unconfigured.json(), { ready: false, renderAvailable: false, freeRenders: 3 });
  assert.equal(configuration(environment({ RATE_LIMIT_SALT: 'REPLACE_WITH_RANDOM_RATE_LIMIT_SALT' })).ready, false);
  const env = environment();
  assert.deepEqual(await (await request(env, '/api/health')).json(), { ready: true, renderAvailable: true, freeRenders: 3 });
  const denied = await request(env, '/api/health', { headers: { Origin: `${origin}.evil.example` } });
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  const allowed = await request(env, '/api/health'); assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await request(env, '/api/leads', { method: 'OPTIONS' })).status, 204);
  env.DB.sqlite.exec('DROP TABLE leads');
  assert.equal((await (await request(env, '/api/health')).json()).ready, false);
});

test('lead validation requires consent, complete contact details and a US ZIP', () => {
  assert.throws(() => validateLead({ ...sample(), contactConsent: false }), /agree/);
  assert.throws(() => validateLead({ ...sample(), address: '' }), /street address/);
  assert.throws(() => validateLead({ ...sample(), email: 'bad' }), /email/);
  assert.throws(() => validateLead({ ...sample(), phone: '111' }), /phone/);
  assert.throws(() => validateLead({ ...sample(), zip: 'abc' }), /ZIP/);
  assert.equal(validateLead({ ...sample(), state: 'fl' }).state, 'FL');
});

test('lead submission stores a hashed token, deduplicates normalized email per server event, records consent', async () => {
  const env = environment(), person = await lead(env);
  const row = env.DB.sqlite.prepare('SELECT * FROM leads').get();
  assert.equal(row.token_hash, await hash(person.token)); assert.notEqual(row.token_hash, person.token);
  assert.equal(row.consent_version, '2026-10-21-v1'); assert.ok(row.consent_at);
  const duplicate = await request(env, '/api/leads', { method: 'POST', body: { ...sample(), email: 'alex@EXAMPLE.com', event: 'changed by visitor' } });
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
  const takeover = await request(env, '/api/leads', { ...options, headers: { 'X-Lead-Token': 'a'.repeat(43) } });
  assert.equal(takeover.status, 409); assert.equal((await takeover.text()).includes(clientToken), false);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1);
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

test('session metadata recovers saved photos, render history and budget without contact details', async () => {
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
  for (const value of [sample().email, sample().phone, sample().address, person.token]) assert.equal(JSON.stringify(recovered).includes(value), false);
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
    assert.equal(init.redirect, 'error'); assert.equal(JSON.parse(init.body).image_base64, base64Jpeg); return renderedResponse();
  });
  assert.deepEqual(result.bytes, jpeg); assert.equal(calls, 1);
  await assert.rejects(callRenderer(env, { bytes: jpeg, mime: 'image/jpeg' }, settings('photo'), async () =>
    new Response(JSON.stringify({ image_url: 'http://169.254.169.254/secret' }))), /unsupported image/);
  const openai = { ...env, RENDER_API_URL: '', RENDER_API_KEY: '', OPENAI_API_KEY: 'server-only-openai-key' };
  await callRenderer(openai, { bytes: jpeg, mime: 'image/jpeg' }, settings('photo'), async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits'); assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('model'), 'gpt-image-1.5'); assert.equal(init.body.get('n'), '1');
    assert.equal(init.body.get('image[]').type, 'image/jpeg');
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { AddressError, addressSuggestions } from '../backend/address.mjs';

const feature = (attributes, x = -80.9, y = 35.1) => ({ attributes, geometry: { x, y } });
const fixtures = () => ({
  nc: [{ attributes: { st_address: '101 MAIN STREET', post_comm: 'BELMONT', post_code: '28012', state: 'NC', county: 'GASTON', ddlong: -80.9, ddlat: 35.1, owner: 'Never returned' } }],
  york: [feature({ WHOLE_ADDRESS: '101 MAIN ST E', POST_COMM: 'FORT MILL', POST_CODE: 29715, STATE: 'SC', COUNTY: 'York' })],
  lancaster: [feature({ WHOLE_ADDR: '101 MAPLE DRIVE', POSTAL_TOW: 'INDIAN LAND', POSTAL_ZIP: 29707, POSTAL_STA: 'SC', COUNTY: 'LANCASTER' }, -80.85, 34.98)],
});
const source = url => url.hostname === 'services.nconemap.gov' ? 'nc' : url.pathname.includes('LC_Addresses') ? 'lancaster' : 'york';
function fakeFetch(data = fixtures(), observe = () => {}) {
  return async (value, init) => { const url = new URL(value); observe(url, init); return Response.json({ features: data[source(url)] || [] }); };
}

test('queries three fixed public layers and returns only normalized address fields with attribution', async () => {
  const seen = [];
  const request = new Request('https://example.test/api/addresses/suggest', { headers: { Authorization: 'Bearer private', Cookie: 'private=secret', 'CF-Connecting-IP': '192.0.2.5' } });
  const result = await addressSuggestions({}, { query: '101 ma' }, request, fakeFetch(fixtures(), (url, init) => {
    seen.push(url);
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual');
    assert.deepEqual(init.headers, { Accept: 'application/json' });
    assert.equal(url.searchParams.get('returnGeometry'), String(source(url) !== 'nc'));
    assert.equal(url.searchParams.get('outSR'), '4326');
    assert.equal(url.searchParams.get('geometry'), '-81.5,34.65,-80.25,35.8');
    assert.equal(url.searchParams.get('resultRecordCount'), '20');
    assert.ok(!url.search.includes('private')); assert.ok(!url.search.includes('owner'));
    const where = url.searchParams.get('where');
    assert.match(where, /(?:add_number = '101'|ADD_NUMBER = 101|ADDR_HN = 101)/);
    assert.match(where, /LIKE 'MA%'/); assert.match(where, /UPPER\(.+\) IN \(/);
  }));
  assert.equal(seen.length, 3); assert.equal(result.suggestions.length, 3);
  assert.deepEqual(result.suggestions[0], { display: '101 Main Street, Belmont, NC 28012', street: '101 Main Street', city: 'Belmont', state: 'NC', zip: '28012' });
  assert.deepEqual(result.suggestions.map(item => item.city), ['Belmont', 'Fort Mill', 'Indian Land']);
  assert.equal(result.sources.length, 3);
  assert.ok(!JSON.stringify(result).includes('Never returned'));
  for (const item of result.suggestions) assert.deepEqual(Object.keys(item), ['display', 'street', 'city', 'state', 'zip']);
});

test('invalid, too broad, injection wildcard and oversized prefixes make no external request', async () => {
  let calls = 0;
  for (const query of ['', '10', 'ma', '12 m', '1234567', '101 ma%', '101 ma_', '101 ma;DROP', '101 ma\n', '<101 main>', '0 main', '000', '1 a', '101 main, Belmont, VA 28012', '101 main, Belmont, NC, 28012', '101 ' + 'm'.repeat(121)]) {
    await assert.rejects(addressSuggestions({}, { query }, undefined, async () => { calls++; }), error => error instanceof AddressError && error.status === 400 && error.code === 'ADDRESS_QUERY_INVALID');
  }
  assert.equal(calls, 0);
});

test('apostrophes are SQL escaped, no-space house prefix works and explicit city is a separate filter', async () => {
  const seen = [];
  await addressSuggestions({}, { query: "101o'connell, Belmont NC 28012" }, undefined, fakeFetch(undefined, url => seen.push(url.searchParams.get('where'))));
  assert.equal(seen.length, 1); // Explicit NC state avoids the two SC sources.
  for (const where of seen) { assert.match(where, /O''CONNELL%/); assert.match(where, /LIKE 'BELMONT%'/); }
  const result = await addressSuggestions({}, { q: '101main st' }, undefined, fakeFetch());
  assert.equal(result.suggestions[0].city, 'Belmont');
});

test('three-digit house numbers alone return only actual exact-house matches without street wildcards', async () => {
  const data = fixtures(), seen = [];
  data.nc.push({ attributes: { ...data.nc[0].attributes, st_address: '1010 MAIN STREET' } });
  const result = await addressSuggestions({}, { query: '101' }, undefined, fakeFetch(data, url => seen.push(url.searchParams.get('where'))));
  assert.equal(result.suggestions.length, 3);
  assert.ok(result.suggestions.every(item => /^101 /.test(item.street)));
  for (const where of seen) assert.ok(!where.includes('LIKE'));
  assert.equal((await addressSuggestions({}, { query: '101 m' }, undefined, fakeFetch())).suggestions.length, 3);
  let calls = 0;
  await addressSuggestions({}, { query: '1 ma' }, undefined, fakeFetch({}, () => calls++));
  assert.equal(calls, 3); // Short house numbers still require two street letters.
});

test('complete two-comma addresses and safe street-type/city boundaries produce the same match', async () => {
  for (const query of ['101 Main Street, Belmont, NC 28012', '101 Main Street Belmont', '101 Main St Belmont NC 28012', '101 Main Street Bel']) {
    const result = await addressSuggestions({}, { query }, undefined, fakeFetch());
    assert.deepEqual(result.suggestions.map(item => item.display), ['101 Main Street, Belmont, NC 28012'], query);
  }
  const wrongZip = await addressSuggestions({}, { query: '101 Main Street, Belmont, NC 28099' }, undefined, fakeFetch());
  assert.deepEqual(wrongZip.suggestions, []);
  const data = fixtures();
  data.nc[0].attributes.st_address = '101 ROAD RUNNER LANE';
  const roadName = await addressSuggestions({}, { query: '101 Road Runner Lane' }, undefined, fakeFetch(data));
  assert.equal(roadName.suggestions[0].street, '101 Road Runner Lane');
});

test('matches actual exact house numbers with common suffix/direction abbreviations', async () => {
  const data = fixtures();
  data.nc.unshift(feature({ st_address: '1010 MAIN ST', post_comm: 'BELMONT', post_code: '28012', state: 'NC', county: 'GASTON' }));
  data.nc.push(feature({ st_address: '101 NORTH MAIN STREET', post_comm: 'BELMONT', post_code: '28012', state: 'NC', county: 'GASTON' }));
  const result = await addressSuggestions({}, { query: '101 main st' }, undefined, fakeFetch(data));
  assert.equal(result.suggestions.length, 3);
  assert.ok(result.suggestions.some(item => item.street === '101 North Main Street'));
  assert.ok(result.suggestions.every(item => item.street.startsWith('101 ')));
  const directional = await addressSuggestions({}, { query: '101 n main' }, undefined, fakeFetch(data));
  assert.deepEqual(directional.suggestions.map(item => item.street), ['101 North Main Street']);
});

test('excludes wrong state/county, outside metro, missing geometry, incomplete and nonmatching records', async () => {
  const data = fixtures(), original = data.nc[0];
  data.nc.push(...[
    { ...original, geometry: { x: -78, y: 35.1 } }, { attributes: { ...original.attributes, ddlong: null, ddlat: null } },
    feature({ ...original.attributes, state: 'VA' }), feature({ ...original.attributes, county: 'WAKE' }),
    feature({ ...original.attributes, post_code: null }), feature({ ...original.attributes, post_comm: '' }),
    feature({ ...original.attributes, st_address: '101 OTHER STREET' }),
  ]);
  data.york.push(feature({ ...data.york[0].attributes, COUNTY: 'Chester' }), feature(data.york[0].attributes, -80.9, 34.2));
  const result = await addressSuggestions({}, { query: '101 ma' }, undefined, fakeFetch(data));
  assert.equal(result.suggestions.length, 3);
});

test('deduplicates identical actual addresses and bounds total suggestions', async () => {
  const data = fixtures();
  data.nc = Array.from({ length: 30 }, (_, index) => feature({ ...data.nc[0].attributes, st_address: `101 MAIN STREET ${index}` }));
  data.york.push(data.york[0]);
  const result = await addressSuggestions({}, { query: '101 ma' }, undefined, fakeFetch(data));
  assert.equal(result.suggestions.length, 8);
  assert.equal(new Set(result.suggestions.map(item => item.display)).size, 8);
  assert.ok(!result.suggestions.some(item => item.street.endsWith('29')));
  assert.ok(result.suggestions.some(item => item.city === 'Fort Mill'));
});

test('source errors fail softly while healthy empty sources are a valid empty response', async () => {
  const data = fixtures();
  const result = await addressSuggestions({}, { query: '101 ma' }, undefined, async (url, init) => {
    if (source(new URL(url)) === 'nc') return Response.json({ error: { code: 500, message: 'Private upstream details' } });
    return fakeFetch(data)(url, init);
  });
  assert.deepEqual(result.suggestions.map(item => item.city), ['Fort Mill', 'Indian Land']);
  assert.deepEqual(result.sources.map(item => item.id), ['york-sc', 'lancaster-sc']);
  const empty = await addressSuggestions({}, { query: '101 ma' }, undefined, fakeFetch({}));
  assert.deepEqual(empty.suggestions, []); assert.equal(empty.sources.length, 3);
});

test('malformed and oversized responses are bounded and never exposed to the visitor', async () => {
  const responses = [() => new Response('{bad'), () => new Response('x'.repeat(128 * 1024 + 1)), () => new Response('{}', { headers: { 'Content-Length': '200000' } })];
  let calls = 0;
  await assert.rejects(addressSuggestions({}, { query: '101 ma' }, undefined, async () => responses[calls++]()), error => {
    assert.equal(error.status, 503); assert.equal(error.code, 'ADDRESS_LOOKUP_UNAVAILABLE');
    assert.ok(!error.message.includes('bad')); return true;
  });
});

test('aborted requests perform no lookup and an in-flight abort is not reported as an empty match', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(addressSuggestions({}, { query: '101 ma' }, new Request('https://example.test', { signal: controller.signal }), async () => { calls++; }), error => error.code === 'ADDRESS_LOOKUP_CANCELLED');
  assert.equal(calls, 0);
  const active = new AbortController();
  const pending = addressSuggestions({}, { query: '101 ma' }, new Request('https://example.test', { signal: active.signal }), async (_, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })));
  active.abort();
  await assert.rejects(pending, error => error.code === 'ADDRESS_LOOKUP_CANCELLED');
});

test('first real suggestions get 400ms grace for other sources, preserve source order and abort pending work', async () => {
  const data = fixtures(), aborted = [], before = Date.now();
  const result = await addressSuggestions({}, { query: '101 ma' }, undefined, async (value, init) => {
    const id = source(new URL(value));
    if (id === 'nc') return new Promise(() => init.signal.addEventListener('abort', () => aborted.push(id), { once: true }));
    if (id === 'lancaster') await new Promise(resolve => setTimeout(resolve, 120));
    return Response.json({ features: data[id] });
  });
  assert.ok(Date.now() - before >= 350);
  assert.ok(Date.now() - before < 1200);
  assert.deepEqual(result.suggestions.map(item => item.city), ['Fort Mill', 'Indian Land']);
  assert.deepEqual(result.sources.map(item => item.id), ['york-sc', 'lancaster-sc']);
  assert.deepEqual(aborted, ['nc']);
});

test('an empty fast source does not start the result grace period', async () => {
  const data = fixtures(), before = Date.now();
  const result = await addressSuggestions({}, { query: '101 ma' }, undefined, async value => {
    const id = source(new URL(value));
    if (id === 'nc') return Response.json({ features: [] });
    if (id === 'lancaster') return new Promise(() => {});
    await new Promise(resolve => setTimeout(resolve, 450));
    return Response.json({ features: data.york });
  });
  assert.ok(Date.now() - before >= 800);
  assert.ok(Date.now() - before < 1600);
  assert.equal(result.suggestions[0].city, 'Fort Mill');
  assert.deepEqual(result.sources.map(item => item.id), ['nc-addressnc', 'york-sc']);
});

test('all slow providers time out together after four seconds', async () => {
  const before = Date.now();
  await assert.rejects(addressSuggestions({}, { query: '101 ma' }, undefined, async () => new Promise(() => {})), error => error.status === 503);
  assert.ok(Date.now() - before < 5500);
});

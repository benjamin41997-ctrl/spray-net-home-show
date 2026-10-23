/** Public government address-point lookup. No geocoder keys or lead data are used.
 * Typed address prefixes go only to the three fixed, public GIS layers below.
 * Raw feature attributes and coordinates never leave this module.
 */
const BOX = [-81.5, 34.65, -80.25, 35.8];
const TIMEOUT_MS = 4000;
const RESULT_GRACE_MS = 400;
const MAX_BYTES = 128 * 1024;
const MAX_FEATURES = 20;
const MAX_SUGGESTIONS = 8;
const NC_COUNTIES = ['GASTON', 'MECKLENBURG', 'UNION', 'CABARRUS', 'IREDELL', 'LINCOLN', 'CATAWBA', 'CLEVELAND', 'ROWAN', 'STANLY'];
const providers = [
  { id: 'nc-addressnc', label: 'NC OneMap / AddressNC',
    url: 'https://services.nconemap.gov/secure/rest/services/AddressNC/NC1Map_Addresses/FeatureServer/0',
    number: 'add_number', name: 'st_name', street: 'st_address', city: 'post_comm', state: 'state', zip: 'post_code', county: 'county',
    stateValue: 'NC', counties: NC_COUNTIES, numericNumber: false },
  { id: 'york-sc', label: 'York County, SC GIS',
    url: 'https://services1.arcgis.com/2AGLxyiJoNiVHKwq/arcgis/rest/services/Addresses/FeatureServer/0',
    number: 'ADD_NUMBER', name: 'ST_NAME', street: 'WHOLE_ADDRESS', city: 'POST_COMM', state: 'STATE', zip: 'POST_CODE', county: 'COUNTY',
    stateValue: 'SC', counties: ['YORK'], numericNumber: true },
  { id: 'lancaster-sc', label: 'Lancaster County, SC GIS',
    url: 'https://services3.arcgis.com/rJcpRneDUBgTeCT3/arcgis/rest/services/LC_Addresses/FeatureServer/0',
    number: 'ADDR_HN', name: 'ST_NAME', street: 'WHOLE_ADDR', city: 'POSTAL_TOW', state: 'POSTAL_STA', zip: 'POSTAL_ZIP', county: 'COUNTY',
    stateValue: 'SC', counties: ['LANCASTER'], numericNumber: true },
];
const abbreviations = new Map(Object.entries({ NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
  STREET: 'ST', ROAD: 'RD', DRIVE: 'DR', COURT: 'CT', LANE: 'LN', AVENUE: 'AVE', BOULEVARD: 'BLVD', CIRCLE: 'CIR', PLACE: 'PL', PARKWAY: 'PKWY', TERRACE: 'TER', TRAIL: 'TRL', HIGHWAY: 'HWY' }));
const directions = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const suffixes = new Set(['ST', 'RD', 'DR', 'CT', 'LN', 'AVE', 'BLVD', 'CIR', 'PL', 'PKWY', 'TER', 'TRL', 'HWY']);

export class AddressError extends Error {
  constructor(status, code, message) { super(message); this.name = 'AddressError'; this.status = status; this.code = code; }
}
const invalid = () => { throw new AddressError(400, 'ADDRESS_QUERY_INVALID', 'Enter at least three house-number digits, or a house number and street letters, to see local address suggestions.'); };
const cancelled = () => { throw new AddressError(408, 'ADDRESS_LOOKUP_CANCELLED', 'Address lookup was cancelled.'); };
const clean = (value, max = 200) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f<>]/.test(value) ? value.trim().replace(/\s+/g, ' ') : '';
const upper = value => clean(value).toUpperCase();
const sql = value => value.replaceAll("'", "''");
const words = value => upper(value).replaceAll('.', '').split(' ').filter(Boolean).map(word => abbreviations.get(word) || word);
const comparable = value => words(value).join(' ');
const title = value => value.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, space, letter) => space + letter.toUpperCase());

function parseQuery(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
  const raw = body.query ?? body.q;
  if (typeof raw !== 'string' || raw.length > 120 || raw.trim().length < 3 || !/^[0-9A-Za-z .,'#-]+$/.test(raw)) invalid();
  const parts = raw.trim().replace(/\s+/g, ' ').toUpperCase().split(',').map(part => part.trim());
  if (parts.length > 3 || parts.some(part => !part)) invalid();
  let streetPart = parts[0], city = parts[1] || '', state = '', zip = '';
  if (parts.length === 3) {
    const region = /^(NC|SC)(?:\s+(\d{5}(?:-\d{4})?))?$/.exec(parts[2]);
    if (!region) invalid();
    state = region[1]; zip = region[2] || '';
  } else {
    // A complete pasted address may end with its state/ZIP without a comma.
    const tail = /\s+(NC|SC)(?:\s+(\d{5}(?:-\d{4})?))?$/.exec(city || streetPart);
    if (tail) {
      state = tail[1]; zip = tail[2] || '';
      if (city) city = city.slice(0, tail.index).trim();
      else streetPart = streetPart.slice(0, tail.index).trim();
    }
  }
  const match = /^(\d{1,6})(?:\s*([A-Z].*))?$/.exec(streetPart);
  if (!match) invalid();
  const number = match[1]; let street = (match[2] || '').trim();
  const letters = (street.match(/[A-Z]/g) || []).length;
  if (/^0+$/.test(number) || (number.length < 3 && letters < 2)) invalid();
  // Infer a city only after an explicit street-type token, never from a
  // street-name word. Keep a following direction with the street.
  if (!city && parts.length === 1 && street) {
    const tokens = street.split(' '), canonical = tokens.map(token => comparable(token));
    let end = -1;
    for (let index = 1; index < canonical.length - 1; index++) if (suffixes.has(canonical[index])) end = index;
    if (end >= 0) {
      if (directions.has(canonical[end + 1])) end++;
      const remainder = tokens.slice(end + 1).join(' ');
      if (remainder && /^[A-Z .'-]+$/.test(remainder) && !/^(APT|UNIT|SUITE|STE|BUILDING|BLDG)\b/.test(remainder)) {
        city = remainder; street = tokens.slice(0, end + 1).join(' ');
      }
    }
  }
  const streetWords = words(street), nameWords = [...streetWords];
  if (directions.has(nameWords[0])) nameWords.shift();
  if (suffixes.has(nameWords.at(-1))) nameWords.pop();
  const name = nameWords.join(' ');
  if (number.length < 3 && (name.match(/[A-Z]/g) || []).length < 2) invalid();
  if (city && !/^[A-Z .'-]+$/.test(city)) invalid();
  return { number, street, name, city, state, zip, comparable: streetWords.join(' ') };
}

export function validateAddressQuery(body) { parseQuery(body); }

function queryUrl(provider, query) {
  const number = provider.numericNumber ? String(Number(query.number)) : `'${sql(query.number)}'`;
  const where = `${provider.number} = ${number} AND UPPER(${provider.state}) = '${provider.stateValue}'`
    + ` AND UPPER(${provider.county}) IN (${provider.counties.map(county => `'${county}'`).join(',')})`
    + (query.street ? ` AND (${query.name ? `UPPER(${provider.name}) LIKE '${sql(query.name)}%' OR ` : ''}UPPER(${provider.street}) LIKE '${sql(`${query.number} ${query.street}`)}%')` : '')
    + (query.city ? ` AND UPPER(${provider.city}) LIKE '${sql(query.city)}%'` : '')
    + (query.zip ? ` AND ${provider.zip} ${provider.numericNumber ? `= ${Number(query.zip.slice(0, 5))}` : `LIKE '${query.zip.slice(0, 5)}%'`}` : '');
  const url = new URL(`${provider.url}/query`);
  const coordinateFields = provider.id === 'nc-addressnc' ? ['ddlong', 'ddlat'] : [];
  url.search = new URLSearchParams({ f: 'json', where, outFields: [provider.street, provider.city, provider.state, provider.zip, provider.county, ...coordinateFields].join(','),
    returnGeometry: String(provider.id !== 'nc-addressnc'), outSR: '4326', geometry: BOX.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', resultRecordCount: String(MAX_FEATURES) }).toString();
  return url;
}

async function boundedJson(response) {
  if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_BYTES || !response.body) throw new Error('Address source unavailable');
  const reader = response.body.getReader();
  let bytes = 0, text = ''; const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Address response too large');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const json = JSON.parse(text);
    if (!json || json.error || !Array.isArray(json.features)) throw new Error('Invalid address response');
    return json.features.slice(0, MAX_FEATURES);
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

function candidate(feature, provider, query) {
  const attributes = feature?.attributes;
  const x = feature?.geometry?.x ?? attributes?.ddlong, y = feature?.geometry?.y ?? attributes?.ddlat;
  if (!attributes || !Number.isFinite(x) || !Number.isFinite(y) || x < BOX[0] || x > BOX[2] || y < BOX[1] || y > BOX[3]) return null;
  const state = upper(attributes[provider.state]);
  if (state !== provider.stateValue || !provider.counties.includes(upper(attributes[provider.county]))) return null;
  const street = clean(attributes[provider.street]), city = clean(attributes[provider.city], 100);
  const zip = String(attributes[provider.zip] ?? '').trim();
  if (!street || !city || !/^\d{5}(?:-\d{4})?$/.test(zip)) return null;
  if ((query.state && query.state !== state) || (query.zip && query.zip.slice(0, 5) !== zip.slice(0, 5))) return null;
  const match = /^(\d{1,6})\s+(.+)$/.exec(street);
  if (!match || match[1] !== query.number) return null;
  const streetWords = words(match[2]), normalized = streetWords.join(' ');
  const withoutDirection = directions.has(streetWords[0]) ? streetWords.slice(1).join(' ') : normalized;
  if (!normalized.startsWith(query.comparable) && !withoutDirection.startsWith(query.comparable)
    && !upper(match[2]).startsWith(query.street)) return null;
  if (query.city && !upper(city).startsWith(query.city)) return null;
  const formattedStreet = title(street), formattedCity = title(city);
  return { display: `${formattedStreet}, ${formattedCity}, ${state} ${zip}`, street: formattedStreet, city: formattedCity, state, zip };
}

async function lookup(provider, query, request, fetcher, options) {
  const controller = new AbortController();
  let rejectAbort;
  const abort = new Promise((_, reject) => { rejectAbort = reject; });
  const stop = () => { controller.abort(); rejectAbort(new Error('Address source stopped')); };
  request?.signal?.addEventListener('abort', stop, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Address source timeout')); }, TIMEOUT_MS); });
  try {
    if (request?.signal?.aborted) throw new Error('Address lookup cancelled');
    const work = (async () => {
      // Cache only normalized public GIS matches, under a hashed query key.
      // No contact details, visitor tokens, cookies or incoming headers enter it.
      let cacheKey;
      if (options.cache) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([provider.id,query])));
        const key = [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
        cacheKey = new Request(new URL(`/__address-cache/v1/${key}`, request?.url || 'https://address-cache.invalid'));
        try {
          const cached = await options.cache.match(cacheKey);
          if (cached?.ok) {
            const value = await cached.json();
            if (Array.isArray(value.suggestions) && value.suggestions.length <= MAX_FEATURES)
              return {provider,suggestions:value.suggestions};
          }
        } catch { /* Cache outages must not disable address lookup. */ }
      }
      const response = await fetcher(queryUrl(provider, query), { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual', signal: controller.signal });
      const features = await boundedJson(response);
      const suggestions = features.map(feature => candidate(feature, provider, query)).filter(Boolean);
      suggestions.sort((a, b) => a.display.localeCompare(b.display));
      if (cacheKey && !controller.signal.aborted) {
        const write = Promise.resolve().then(()=>options.cache.put(cacheKey,new Response(JSON.stringify({suggestions}),{
          headers:{'Content-Type':'application/json','Cache-Control':`public, max-age=${suggestions.length?600:30}`}
        }))).catch(()=>{});
        if (options.waitUntil) options.waitUntil(write); else await write;
      }
      return { provider, suggestions };
    })();
    return await Promise.race([work, timeout, abort]);
  } finally { clearTimeout(timer); request?.signal?.removeEventListener('abort', stop); }
}

/** Fixed public sources only. env is reserved for route compatibility; no keys. */
export async function addressSuggestions(env, body, request, fetcher = fetch, options = {}) {
  const query = parseQuery(body);
  if (request?.signal?.aborted) cancelled();
  const selectedProviders = providers.filter(provider => !query.state || provider.stateValue === query.state);
  const controller = new AbortController();
  const results = new Array(selectedProviders.length);
  const limit=options.onUpdate?MAX_FEATURES*selectedProviders.length:MAX_SUGGESTIONS;
  function snapshot() {
    const successful = results.filter(result => result?.status === 'fulfilled').map(result => result.value);
    // Interleave sources so a broad NC prefix does not hide nearby SC results.
    const suggestions = [], seen = new Set();
    for (let index = 0; index < MAX_FEATURES && suggestions.length < limit; index++) {
      for (const result of successful) {
        const value = result.suggestions[index];
        if (!value) continue;
        const key = comparable(value.display);
        if (!seen.has(key)) { suggestions.push(value); seen.add(key); }
        if (suggestions.length >= limit) break;
      }
    }
    return {suggestions,sources:successful.map(({provider})=>({id:provider.id,label:provider.label,url:provider.url}))};
  }
  // A slow county must not hold back addresses already found elsewhere. Once
  // there is a real match, allow 400ms for other sources, then stop pending work.
  await new Promise(resolve => {
    let remaining = selectedProviders.length, finished = false, grace;
    const finish = () => {
      if (finished) return;
      finished = true; clearTimeout(grace); request?.signal?.removeEventListener('abort', finish);
      controller.abort(); resolve();
    };
    request?.signal?.addEventListener('abort', finish, { once: true });
    selectedProviders.forEach((provider, index) => {
      lookup(provider, query, { signal: controller.signal, url: request?.url }, fetcher, options).then(value => {
        if (finished) return;
        results[index] = { status: 'fulfilled', value };
        if (options.onUpdate) options.onUpdate(snapshot());
        // Streaming callers receive each source immediately, then retain all
        // later counties rather than cutting off slower NC/SC matches.
        else if (value.suggestions.length && !grace) grace = setTimeout(finish, RESULT_GRACE_MS);
      }, () => {
        if (!finished) results[index] = { status: 'rejected' };
      }).finally(() => { if (!finished && --remaining === 0) finish(); });
    });
  });
  if (request?.signal?.aborted) cancelled();
  const successful = results.filter(result => result?.status === 'fulfilled').map(result => result.value);
  if (!successful.length) throw new AddressError(503, 'ADDRESS_LOOKUP_UNAVAILABLE', 'Address suggestions are temporarily unavailable. You can type the complete address instead.');
  return snapshot();
}

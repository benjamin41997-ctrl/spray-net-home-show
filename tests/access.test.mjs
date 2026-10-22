import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingUrl, createStudioLink, parseStudioAccess, sameStudioAccess } from '../public/access.js';

const id = '550e8400-e29b-41d4-a716-446655440000';
const token = 'X'.repeat(43);

test('private studio links round-trip only the existing lead ID and token', () => {
  const link = createStudioLink('https://example.github.io/home-show/', { id, token });
  const url = new URL(link);
  assert.deepEqual(parseStudioAccess(url.hash), { id, token });
  assert.equal(link, `https://example.github.io/home-show/#studio=${id}.${token}`);
});

test('studio link retains origin/path and discards existing query/hash and contact PII', () => {
  const lead = { id, token, firstName: 'PrivatePerson', email: 'private@example.com', phone: '5551234567', address: '19 Secret Street',
    apiBase: 'https://untrusted.example' };
  const page = 'https://example.github.io/spray-net/home/?email=private%40example.com&source=show#old';
  const url = new URL(createStudioLink(page, lead));
  assert.equal(url.origin, 'https://example.github.io'); assert.equal(url.pathname, '/spray-net/home/');
  assert.equal(url.search, '');
  for (const value of [lead.firstName, lead.email, lead.phone, lead.address, lead.apiBase]) assert.equal(url.href.includes(value), false);
  assert.deepEqual(Object.keys(parseStudioAccess(url.hash)), ['id', 'token']);
});

test('studio fragments reject invalid IDs, invalid tokens, extra parameters and API destinations', () => {
  for (const value of [undefined, null, '', '#', `studio=${id}.${token}`, `#studio=not-a-uuid.${token}`,
    `#studio=${id}.${token.slice(1)}`, `#studio=${id}.${token}x`, `#studio=${id}.${'!'.repeat(43)}`,
    `#studio=${id}.${token}&apiBase=https://evil.example`, `#studio=${id}.${token}?apiBase=https://evil.example`,
    `#studio=${id}.${token}.extra`, `#studio=${id}%2e${token}`, `#studio=https://evil.example`,
    '#studio=eyJhcGlCYXNlIjoiaHR0cHM6Ly9ldmlsLmV4YW1wbGUifQ']) assert.equal(parseStudioAccess(value), null);
  assert.deepEqual(parseStudioAccess(`#studio=${id.toUpperCase()}.${token}`), { id, token });
});

test('saved pending work matches only the exact valid lead and token, with normalized UUID case', () => {
  const access = { id, token };
  assert.equal(sameStudioAccess(access, { id: id.toUpperCase(), token }), true);
  assert.equal(sameStudioAccess(access, { id, token: token.toLowerCase() }), false);
  assert.equal(sameStudioAccess(access, { id: '550e8400-e29b-41d4-a716-446655440001', token }), false);
  for (const invalid of [null, undefined, {}, [], { id: 'bad', token }, { id, token: 'short' },
    { id, token: { toString: () => token } }]) {
    assert.equal(sameStudioAccess(access, invalid), false);
    assert.equal(sameStudioAccess(invalid, access), false);
    assert.equal(sameStudioAccess(invalid, invalid), false);
  }
});

test('studio creation rejects unsafe page URLs and malformed saved sessions', () => {
  for (const value of ['http://example.com/', 'javascript:alert(1)', '//example.com/', '/relative/',
    'https://user:password@example.com/', 'https://user@example.com/', '', null])
    assert.throws(() => createStudioLink(value, { id, token }), TypeError);
  for (const lead of [null, {}, { id: 'broken', token }, { id, token: 'too-short' }])
    assert.throws(() => createStudioLink('https://example.com/', lead), TypeError);
});

test('configured booking URLs preserve ordinary public business routing without adding lead data', () => {
  const configured = 'https://cal.example/consultation?calendar=charlotte&event_type=estimate&event_name=consultation&utm_source=home-show&hide_gdpr_banner=1';
  assert.equal(bookingUrl(configured), configured);
  assert.equal(bookingUrl('https://cal.example/consultation'), 'https://cal.example/consultation');
  assert.equal(bookingUrl(''), ''); assert.equal(bookingUrl(undefined), '');
});

test('booking URL validation rejects insecure destinations, credentials and sensitive query data', () => {
  for (const value of ['http://cal.example/', 'javascript:alert(1)', '/relative', 'https://user:pass@cal.example/',
    'https://user@cal.example/', 'https://cal.example/?email=private%40example.com',
    'https://cal.example/?contact_phone=5551234567', 'https://cal.example/?first_name=Private',
    'https://cal.example/?customer.name=Private', 'https://cal.example/?token=visitor-token',
    'https://cal.example/?accessToken=visitor-token', 'https://cal.example/?userEmail=private%40example.com',
    'https://cal.example/?api_key=secret', 'https://cal.example/?x=private%40example.com',
    'https://cal.example/#access_token=secret']) assert.equal(bookingUrl(value), '');
});

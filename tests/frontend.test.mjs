import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePhoto, splitName, safeApiBase, privateMediaUrl, contactValues, MAX_PHOTOS } from '../public/lib.js';

test('uploads accept supported nonempty photos up to the exact 10 MB limit', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(validatePhoto({ type, size: 10 * 1024 * 1024 }), '');
  }
  assert.equal(MAX_PHOTOS, 3);
});
test('uploads explain unsupported HEIC, empty, and oversized files', () => {
  assert.match(validatePhoto({ type: 'image/heic', size: 20 }), /JPG|HEIC/);
  assert.match(validatePhoto({ type: 'image/png', size: 0 }), /empty/);
  assert.match(validatePhoto({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }), /10 MB/);
});
test('contact picker preserves a compound surname and maps the first shared values', () => {
  assert.deepEqual(contactValues({ name: ['  Ana  de la Cruz  '], email: ['ana@example.com', 'other@example.com'],
    tel: ['+1 704 555 0199'], address: [{ addressLine: ['123 Main Street', 'Unit 2'], city: 'Charlotte', region: 'NC', postalCode: '28202' }] }),
  { firstName: 'Ana', lastName: 'de la Cruz', email: 'ana@example.com', phone: '+1 704 555 0199',
    address: '123 Main Street Unit 2', city: 'Charlotte', state: 'NC', zip: '28202' });
});
test('missing contact details remain blank rather than fabricated', () => {
  assert.deepEqual(contactValues({}), { firstName: '', lastName: '', email: '', phone: '' });
  assert.deepEqual(splitName('Prince'), { firstName: 'Prince', lastName: '' });
  assert.deepEqual(contactValues({ address: [{}] }), { firstName: '', lastName: '', email: '', phone: '', address: '', city: '', state: '', zip: '' });
});
test('API configuration preserves preview mode and normalizes an HTTPS origin', () => {
  assert.equal(safeApiBase('', 'https://show.example'), '');
  assert.equal(safeApiBase('https://api.example/', 'https://show.example'), 'https://api.example');
  assert.equal(safeApiBase('http://localhost:8787/', 'https://show.example'), 'http://localhost:8787');
  assert.equal(safeApiBase('http://127.0.0.1:8787', 'https://show.example'), 'http://127.0.0.1:8787');
});
test('API configuration rejects insecure remote hosts, URL credentials, query strings and fragments', () => {
  for (const value of ['http://api.example', 'javascript:alert(1)', 'https://user:secret@api.example',
    'https://api.example?key=value', 'https://api.example#token']) {
    assert.throws(() => safeApiBase(value, 'https://show.example'));
  }
});
test('private images resolve only beneath the API lead route on the configured origin', () => {
  assert.equal(privateMediaUrl('/api/leads/lead-id/renders/render-id/image', 'https://api.example', 'https://show.example'),
    'https://api.example/api/leads/lead-id/renders/render-id/image');
  assert.equal(privateMediaUrl('/api/leads/id/photos/id', '', 'https://show.example'), 'https://show.example/api/leads/id/photos/id');
  for (const value of ['https://evil.example/api/leads/id', '//evil.example/api/leads/id', '/api/admin/leads.csv',
    '/api/leads/../../admin/leads.csv', 'data:image/png;base64,AAAA', 'javascript:alert(1)']) {
    assert.throws(() => privateMediaUrl(value, 'https://api.example', 'https://show.example'));
  }
});

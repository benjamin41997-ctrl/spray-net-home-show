import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createQrMatrix, renderQr } from '../public/qr.js';

const mobile = 'https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=mobile';
// Synthetic fixture only. It is not an issued lead or a usable credential.
const privateProject = `${mobile}#studio=123e4567-e89b-42d3-a456-426614174000.${'A'.repeat(43)}`;
const fixtures = [
  ['https://example.com/', 2, 'c0183ef005087abc43b27fbfd3532b2a01bcd08c36d4e00aca1c64f9f6766d6a'],
  [mobile, 5, 'bd504821ab6317eef2e3c3be81bdfe06418ee21715210be9ca419d7497977dc2'],
  [privateProject, 9, '51f3d92528de9cbe1b77304857434c4256eae9c357095a3d4cd2136e6e493346'],
];

test('pinned local QR encoder matches independently decoded URL fixtures', () => {
  // All three reference matrices were decoded with the existing independent
  // jsQR decoder during implementation; no decoder is a runtime/test dependency.
  for (const [url, version, hash] of fixtures) {
    const matrix = createQrMatrix(url);
    assert.equal(matrix.version, version);
    assert.equal(matrix.size, version * 4 + 17);
    assert.equal(matrix.modules.length, matrix.size ** 2);
    assert.ok(matrix.modules.every(value => value === 0 || value === 1));
    assert.equal(createHash('sha256').update(matrix.modules).digest('hex'), hash);
  }
});

test('private access fragment is preserved in the encoded matrix', () => {
  const publicMatrix = createQrMatrix(mobile);
  const privateMatrix = createQrMatrix(privateProject);
  const changedToken = createQrMatrix(privateProject.slice(0, -1) + 'B');
  assert.notDeepEqual(privateMatrix.modules, publicMatrix.modules);
  assert.notDeepEqual(privateMatrix.modules, changedToken.modules);
});

test('QR URLs require HTTPS or a loopback-only local development origin', () => {
  for (const url of ['http://localhost:4173/?mode=mobile', 'http://127.0.0.1:4173/', 'http://[::1]:4173/'])
    assert.ok(createQrMatrix(url).size > 0);
  for (const url of ['http://example.com/', 'http://192.168.1.2/', 'http://localhost.evil.example/', 'https://user:password@example.com/', 'javascript:alert(1)', '/relative', '', null, 'https://example.com/' + 'x'.repeat(2048)])
    assert.throws(() => createQrMatrix(url), TypeError);
});

function fixtureContainer() {
  const document = { createElementNS(namespace, tag) { return new Element(namespace, tag); } };
  class Element {
    constructor(namespace, tag) { this.namespaceURI = namespace; this.tagName = tag; this.attributes = {}; this.children = []; this.ownerDocument = document; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    set innerHTML(_) { throw new Error('HTML insertion is forbidden.'); }
  }
  return new Element(null, 'div');
}

test('SVG uses safe DOM creation, a quiet zone, and no URL-bearing attributes', () => {
  const container = fixtureContainer();
  const svg = renderQr(container, privateProject, { label: 'Scan to reopen your private project' });
  const matrix = createQrMatrix(privateProject);
  assert.equal(container.children[0], svg);
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(svg.attributes.role, 'img');
  assert.equal(svg.attributes['aria-label'], 'Scan to reopen your private project');
  assert.equal(svg.attributes.viewBox, `0 0 ${matrix.size + 8} ${matrix.size + 8}`);
  assert.equal(svg.children[0].attributes.fill, '#ffffff');
  assert.equal(svg.children[1].attributes.fill, '#000000');
  const paths = [...svg.children[1].attributes.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)];
  assert.ok(paths.length > 0);
  let cells = 0;
  for (const [, x, y, length] of paths) {
    assert.ok(Number(x) >= 4 && Number(y) >= 4);
    assert.ok(Number(x) + Number(length) <= matrix.size + 4);
    assert.ok(Number(y) < matrix.size + 4);
    cells += Number(length);
  }
  assert.equal(cells, matrix.modules.reduce((sum, value) => sum + value, 0));
  const attributes = JSON.stringify([svg.attributes, ...svg.children.map(child => child.attributes)]);
  assert.equal(attributes.includes('#studio='), false);
  assert.equal(attributes.includes('A'.repeat(43)), false);
  renderQr(container, mobile);
  assert.equal(container.children.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildSite } from '../scripts/build.mjs';

const project = resolve(fileURLToPath(new URL('../', import.meta.url))), work = resolve(project, 'work');
async function fixture(t) {
  await mkdir(work, { recursive: true }); const root = await mkdtemp(resolve(work, 'build-test-'));
  t.after(async () => {
    const target = resolve(root);
    assert.ok(target.startsWith(work + sep) && dirname(target) === work, 'Only the verified test workspace may be removed.');
    await rm(target, { recursive: true, force: true });
  });
  const files = {
    'index.html': `<link rel="stylesheet" href="./styles.css"><script src="./config.js" defer></script><script type="module" src="./app.js"></script><img src="./assets/logo.png"><a href="?mode=tablet">Tablet</a><a href="#form">Form</a><a href="https://example.com/">External</a>`,
    'admin.html': `<script src="./config.js"></script><script type="module" src="./admin.js"></script><link rel="stylesheet" href="./styles.css">`,
    'config.js': `window.SPRAYNET_CONFIG = { apiBase: '', event: 'Test show' };`,
    'app.js': `import {value} from './lib.js'; import './address-autocomplete.js'; export {qr} from './qr.js'; const later=()=>import('./later.js'); const logo=new URL('./assets/logo.png',import.meta.url);`,
    'admin.js': `import {value} from './lib.js';`,
    'lib.js': `export const value = 1;`,
    'address-autocomplete.js': `export const autocompleteVersion = 1;`,
    'qr.js': `import encoder from './vendor/qrcode.mjs'; export const qr=encoder;`,
    'vendor/qrcode.mjs': `export default 'local encoder';`,
    'later.js': `export const later = true;`,
    'styles.css': `@import './colors.css'; @font-face {font-family:Test;src:url('./assets/font.woff2')} .logo{background:url(./assets/logo.png?size=2#image)} .external{background:url(data:image/png;base64,AAAA)}`,
    'colors.css': `:root{--navy:#003965}`,
    'assets/logo.png': Buffer.from([137,80,78,71]),
    'assets/font.woff2': Buffer.from('font fixture'),
    'assets/OFL.txt': 'License retained at its original path.',
  };
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, 'public', file)), { recursive: true });
    await writeFile(resolve(root, 'public', file), contents);
  }
  return { root, files };
}
async function built(root, manifest, file) { return readFile(resolve(root, 'dist', manifest.assets[file] || file), 'utf8'); }

test('static build fingerprints HTML entries, public config, complete module graph and CSS assets together', async t => {
  const { root, files } = await fixture(t), manifest = await buildSite({ projectRoot: root, apiBaseOverride: 'https://api.example' });
  assert.match(manifest.release, /^[0-9a-f]{16}$/);
  for (const name of ['app.js','address-autocomplete.js','lib.js','qr.js','vendor/qrcode.mjs','styles.css','config.js','assets/logo.png','assets/font.woff2']) {
    assert.ok(manifest.assets[name].includes(`.${manifest.release}.`)); await stat(resolve(root, 'dist', manifest.assets[name]));
  }
  for (const entry of ['index.html','admin.html']) {
    const html = await built(root, manifest, entry);
    assert.ok(html.includes(manifest.assets['config.js'])); assert.ok(html.includes(manifest.assets['styles.css']));
    assert.equal(/(?:src|href)="\.\/(?:app|admin|config)\.js"/.test(html), false);
  }
  const html = await built(root, manifest, 'index.html');
  for (const unchanged of ['href="?mode=tablet"','href="#form"','href="https://example.com/"']) assert.ok(html.includes(unchanged));
  const app = await built(root, manifest, 'app.js');
  for (const dependency of ['lib.js','address-autocomplete.js','qr.js','later.js','assets/logo.png']) assert.ok(app.includes(manifest.assets[dependency]));
  assert.ok((await built(root, manifest, 'qr.js')).includes(`./vendor/qrcode.${manifest.release}.mjs`));
  const css = await built(root, manifest, 'styles.css');
  for (const asset of ['colors.css','assets/font.woff2','assets/logo.png']) assert.ok(css.includes(manifest.assets[asset]));
  assert.ok(css.includes('?size=2#image')); assert.ok(css.includes('data:image/png;base64,AAAA'));
  const context = { window: {} }; vm.runInNewContext(await built(root, manifest, 'config.js'), context);
  assert.equal(context.window.SPRAYNET_CONFIG.apiBase, 'https://api.example');
  assert.equal(await readFile(resolve(root, 'public/config.js'), 'utf8'), files['config.js']);
  assert.equal(await built(root, manifest, 'assets/OFL.txt'), files['assets/OFL.txt']);
  assert.deepEqual(JSON.parse(await readFile(resolve(root, 'dist/asset-manifest.json'), 'utf8')), manifest);
  const outputs = await readdir(resolve(root, 'dist')); assert.equal(outputs.includes('app.js'), false); assert.equal(outputs.includes('config.js'), false);
});

test('dependency or effective API config changes invalidate every module URL while identical builds stay deterministic', async t => {
  const { root } = await fixture(t), options = { projectRoot: root, apiBaseOverride: 'https://api.example' };
  const original = await buildSite(options); assert.deepEqual(await buildSite(options), original);
  await writeFile(resolve(root, 'public/address-autocomplete.js'), 'export const autocompleteVersion=2;');
  const changed = await buildSite(options); assert.notEqual(changed.release, original.release);
  assert.notEqual(changed.assets['app.js'], original.assets['app.js']); assert.notEqual(changed.assets['vendor/qrcode.mjs'], original.assets['vendor/qrcode.mjs']);
  assert.equal((await built(root, changed, 'index.html')).includes(original.release), false);
  assert.equal((await readdir(resolve(root, 'dist'))).some(file => file.includes(original.release)), false);
  const configuration = await buildSite({ ...options, apiBaseOverride: 'https://different-api.example' });
  assert.notEqual(configuration.release, changed.release); assert.notEqual(configuration.assets['config.js'], changed.assets['config.js']);
});

test('invalid public API origins fail before replacing a previous build and private environment variables are never serialized', async t => {
  const { root } = await fixture(t), sentinel = 'private-environment-value-never-serialize';
  const previous = process.env.BUILD_TEST_PRIVATE_SECRET; process.env.BUILD_TEST_PRIVATE_SECRET = sentinel;
  t.after(() => { if (previous === undefined) delete process.env.BUILD_TEST_PRIVATE_SECRET; else process.env.BUILD_TEST_PRIVATE_SECRET = previous; });
  const manifest = await buildSite({ projectRoot: root, apiBaseOverride: '' });
  for (const file of ['index.html','config.js','app.js']) assert.equal((await built(root, manifest, file)).includes(sentinel), false);
  for (const value of ['http://api.example','https://user:secret@api.example','https://api.example/path','not a URL']) {
    await assert.rejects(buildSite({ projectRoot: root, apiBaseOverride: value }));
    assert.equal(JSON.parse(await readFile(resolve(root, 'dist/asset-manifest.json'), 'utf8')).release, manifest.release);
  }
});

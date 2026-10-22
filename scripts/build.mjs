import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, basename, extname, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { safeApiBase } from '../public/lib.js';

const project = resolve(fileURLToPath(new URL('../', import.meta.url)));
const fingerprinted = new Set(['.js','.mjs','.css','.json','.png','.jpg','.jpeg','.webp','.svg','.gif','.ico','.ttf','.woff','.woff2']);
async function filesIn(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? filesIn(resolve(directory, entry.name), `${prefix}${entry.name}/`)
    : `${prefix}${entry.name}`))).flat().sort();
}
function configuredBase(value) {
  if (value === undefined) return undefined;
  const configured = value.trim();
  const apiBase = safeApiBase(configured, 'https://example.invalid');
  if (apiBase && (!/^https?:\/\//i.test(configured) || new URL(apiBase).pathname !== '/'))
    throw new Error('API_BASE_URL must be an absolute HTTPS origin (localhost HTTP is allowed for development).');
  return apiBase;
}
function rewriteReference(reference, from, assets) {
  if (!reference || reference.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return reference;
  const [, path, suffix = ''] = /^([^?#]*)([\s\S]*)$/.exec(reference);
  let target;
  try { target = posix.normalize(path.startsWith('/') ? decodeURIComponent(path).slice(1) : posix.join(posix.dirname(from), decodeURIComponent(path))); }
  catch { return reference; }
  if (!assets.has(target)) return reference;
  const replacement = reference.startsWith('/') ? `/${assets.get(target)}` : posix.relative(posix.dirname(from), assets.get(target));
  const relative = replacement.startsWith('.') || replacement.startsWith('/') ? replacement : `./${replacement}`;
  return relative.split('/').map(part => encodeURIComponent(part)).join('/') + suffix;
}
function rewrite(text, file, assets) {
  const extension = extname(file);
  const ref = value => rewriteReference(value, file, assets);
  if (extension === '.html') return text.replace(/(\b(?:src|href|poster)\s*=\s*)(['"])(.*?)\2/gi,
    (_, prefix, quote, value) => prefix + quote + ref(value) + quote);
  if (extension === '.css') return text
    .replace(/url\(\s*(?:(['"])(.*?)\1|([^\s)]+))\s*\)/gi,
      (_, quote, quoted, bare) => `url(${quote || ''}${ref(quoted ?? bare)}${quote || ''})`)
    .replace(/(@import\s+)(['"])([^'"]+)\2/gi, (_, prefix, quote, value) => prefix + quote + ref(value) + quote);
  if (['.js','.mjs'].includes(extension)) return text
    .replace(/\b(?:import|export)\s+(?:[^;\n]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
      (whole, staticReference, dynamicReference) => whole.replace(staticReference || dynamicReference, ref(staticReference || dynamicReference)))
    .replace(/(new\s+URL\(\s*)(['"])([^'"]+)(\2\s*,\s*import\.meta\.url\s*\))/g,
      (_, prefix, quote, value, ending) => prefix + quote + ref(value) + ending);
  return text;
}

export async function buildSite({ projectRoot = project, apiBaseOverride } = {}) {
  const apiBase = configuredBase(apiBaseOverride);
  const root = resolve(projectRoot), source = resolve(root, 'public'), output = resolve(root, 'dist');
  const files = await filesIn(source), contents = new Map();
  for (const file of files) contents.set(file, await readFile(resolve(source, file)));
  if (apiBase !== undefined) {
    const config = contents.get('config.js')?.toString('utf8');
    if (!config || !/apiBase\s*:\s*(['"])[\s\S]*?\1/.test(config)) throw new Error('Public config apiBase was not found.');
    // Only this explicitly public setting is serialized; never serialize process.env.
    contents.set('config.js', Buffer.from(config.replace(/apiBase\s*:\s*(['"])[\s\S]*?\1/, `apiBase: ${JSON.stringify(apiBase)}`)));
  }
  // One deterministic release fingerprint covers the complete dependency graph,
  // effective public configuration, and rewriting implementation. Every changed
  // dependency produces new URLs, so modules cannot mix deployments from cache.
  const hash = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url)));
  for (const [file, bytes] of contents) hash.update(file).update('\0').update(bytes).update('\0');
  const release = hash.digest('hex').slice(0, 16), assets = new Map();
  for (const file of files) if (fingerprinted.has(extname(file))) {
    const extension = extname(file); assets.set(file, file.slice(0, -extension.length) + `.${release}` + extension);
  }
  // Verify the exact generated output location before removing a prior build.
  if (dirname(output) !== root || basename(output) !== 'dist') throw new Error('Unsafe build output directory.');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const [file, bytes] of contents) {
    const destination = resolve(output, assets.get(file) || file);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, ['.html','.css','.js','.mjs'].includes(extname(file)) ? rewrite(bytes.toString('utf8'), file, assets) : bytes);
  }
  const manifest = { release, assets: Object.fromEntries(assets) };
  await writeFile(resolve(output, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { release } = await buildSite({ apiBaseOverride: process.env.API_BASE_URL });
  console.log(`Built static site in dist/ (release ${release}). Assets and module dependencies use fingerprinted filenames; no API secrets are included.`);
}

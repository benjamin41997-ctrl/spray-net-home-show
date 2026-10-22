import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeApiBase } from '../public/lib.js';

const source = fileURLToPath(new URL('../public/', import.meta.url));
const project = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = resolve(project, 'dist');
let apiBase;

if (process.env.API_BASE_URL !== undefined) {
  const configured = process.env.API_BASE_URL.trim();
  // Only the public API origin belongs in the static build. Never serialize process.env.
  apiBase = safeApiBase(configured, 'https://example.invalid');
  if (apiBase && (!/^https?:\/\//i.test(configured) || new URL(apiBase).pathname !== '/')) {
    throw new Error('API_BASE_URL must be an absolute HTTPS origin (localhost HTTP is allowed for development).');
  }
}

// Verify the exact generated output location before removing the previous build.
if (dirname(output) !== project || basename(output) !== 'dist') throw new Error('Unsafe build output directory.');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

if (apiBase !== undefined) {
  const destination = new URL('../dist/config.js', import.meta.url);
  const config = await readFile(destination, 'utf8');
  if (!/apiBase\s*:\s*(['"])[\s\S]*?\1/.test(config)) throw new Error('Public config apiBase was not found.');
  await writeFile(destination, config.replace(/apiBase\s*:\s*(['"])[\s\S]*?\1/,
    `apiBase: ${JSON.stringify(apiBase)}`));
}
console.log('Built static site in dist/. No API secrets are included.');

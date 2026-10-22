import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = resolve(root, 'public');
const failures = [];
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.filter(e => !['node_modules', '.git', 'dist', '.wrangler', 'work'].includes(e.name))
    .map(e => e.isDirectory() ? filesIn(resolve(directory, e.name)) : resolve(directory, e.name)))).flat();
}
const files = await filesIn(root);
let references = 0;
async function localReference(reference, file) {
  const value = reference.trim();
  if (!value || value.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return;
  let target;
  try {
    const clean = decodeURIComponent(value.split(/[?#]/)[0]);
    target = resolve(clean.startsWith('/') ? publicRoot : dirname(file), '.' + (clean.startsWith('/') ? clean : '/' + clean));
  }
  catch { failures.push(`${relative(root, file)}: invalid reference ${value}`); return; }
  if (target !== publicRoot && !target.startsWith(publicRoot + sep)) {
    failures.push(`${relative(root, file)}: asset leaves public/: ${value}`); return;
  }
  try { await stat(target); references++; }
  catch { failures.push(`${relative(root, file)}: missing local asset ${value}`); }
}
for (const file of files) {
  const extension = extname(file);
  if (['.js', '.mjs'].includes(extension)) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (checked.status !== 0) failures.push(`${relative(root, file)}: ${checked.stderr.trim()}`);
  }
  if (!['.js', '.mjs', '.html', '.css', '.json', '.jsonc', '.yml', '.md', '.sql', '.example'].includes(extension)) continue;
  const contents = await readFile(file, 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(contents)) {
    failures.push(`${relative(root, file)}: possible committed private key or API credential`);
  }
  if (!file.startsWith(publicRoot + sep)) continue;
  if (/\b(?:OPENAI_API_KEY|RENDER_API_KEY|ADMIN_TOKEN|RATE_LIMIT_SALT|MICROSOFT_CLIENT_SECRET|MICROSOFT_REFRESH_TOKEN|MICROSOFT_ACCESS_TOKEN|OUTLOOK_ACCESS_TOKEN)\s*[:=]\s*['"][^'"]+['"]/.test(contents)) {
    failures.push(`${relative(root, file)}: private server configuration in public files`);
  }
  if (extension === '.html') {
    for (const match of contents.matchAll(/\b(?:src|href|poster)\s*=\s*['"]([^'"]+)['"]/gi)) await localReference(match[1], file);
  }
  if (extension === '.css') {
    for (const match of contents.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)) await localReference(match[1], file);
    for (const match of contents.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) await localReference(match[1], file);
  }
  if (['.js', '.mjs'].includes(extension)) {
    for (const match of contents.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const reference = match[1] || match[2];
      if (reference.startsWith('.') || reference.startsWith('/')) await localReference(reference, file);
    }
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Checked syntax, public credentials, and ${references} local asset references.`);

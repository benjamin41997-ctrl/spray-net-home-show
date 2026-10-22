/** Operator-only OAuth bootstrap. Never import from browser code.
 * Run explicitly after registering a Microsoft Entra Web application and
 * authenticating Wrangler. No network/server/process work happens on import.
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 * https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret-bulk
 */
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXPECTED_MAILBOX = 'ben.hessler@spray-net.com';
export const DEFAULT_REDIRECT_URI = 'http://localhost:43187/oauth/callback';
const SCOPES = 'offline_access https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read';
const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = join(root, 'backend', 'wrangler.jsonc');
const require = createRequire(import.meta.url);
const safe = message => Object.assign(new Error(message), { safeMessage: message });

export function connectionConfig(env = process.env) {
  const tenant = env.MICROSOFT_TENANT_ID?.trim(), clientId = env.MICROSOFT_CLIENT_ID?.trim(), clientSecret = env.MICROSOFT_CLIENT_SECRET;
  if (!tenant || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(tenant)
    || !clientId || !/^[A-Za-z0-9-]{4,128}$/.test(clientId)
    || typeof clientSecret !== 'string' || clientSecret.length < 8 || clientSecret.length > 8192
    || /REPLACE_|YOUR_|CHANGEME/i.test(`${tenant}${clientId}`)
    || /REPLACE_|YOUR_|CHANGEME|[\r\n]/i.test(clientSecret))
    throw safe('Set valid MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, and MICROSOFT_CLIENT_SECRET in this process environment.');
  if (env.OUTLOOK_CALENDAR_USER && env.OUTLOOK_CALENDAR_USER.toLowerCase().trim() !== EXPECTED_MAILBOX)
    throw safe(`This setup utility connects only ${EXPECTED_MAILBOX}.`);
  const port = env.OUTLOOK_CONNECT_PORT ? Number(env.OUTLOOK_CONNECT_PORT) : 43187;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw safe('OUTLOOK_CONNECT_PORT must be an unprivileged TCP port from 1024 to 65535.');
  return { tenant, clientId, clientSecret, redirectUri: `http://localhost:${port}/oauth/callback`, port };
}

export function authorizationRequest(config) {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: config.redirectUri,
    response_mode: 'query', scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256',
    prompt: 'select_account', login_hint: EXPECTED_MAILBOX }).toString();
  return { url: url.href, state, verifier };
}

export function callbackCode(requestUrl, expectedState, redirectUri = DEFAULT_REDIRECT_URI) {
  let url;
  try { url = new URL(requestUrl, redirectUri); } catch { throw safe('Invalid authorization callback.'); }
  const expected = new URL(redirectUri), states = url.searchParams.getAll('state');
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash
    || states.length !== 1 || typeof expectedState !== 'string') throw safe('Invalid authorization callback.');
  const actual = Buffer.from(states[0]), wanted = Buffer.from(expectedState);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw safe('Authorization state did not match.');
  if (url.searchParams.has('error')) throw safe('Microsoft authorization was declined or needs administrator approval. No connection was saved.');
  const codes = url.searchParams.getAll('code');
  if (codes.length !== 1 || !codes[0] || codes[0].length > 8192 || /[\r\n]/.test(codes[0])) throw safe('The authorization response did not contain a valid code.');
  return codes[0];
}

export function verifiedMailbox(profile) {
  return Boolean(profile && typeof profile.id === 'string' && profile.id
    && [profile.mail, profile.userPrincipalName].some(value => typeof value === 'string' && value.trim().toLowerCase() === EXPECTED_MAILBOX));
}

async function jsonRequest(fetcher, url, init) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw safe(`Microsoft verification failed (HTTP ${response.status}). Check the app registration, Web redirect URI, credentials, and delegated permissions.`);
    if (Number(response.headers.get('content-length')) > 128 * 1024) throw safe('Microsoft returned an unsupported response.');
    const chunks = []; let size = 0; const reader = response.body?.getReader();
    try {
      if (reader) for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > 128 * 1024) { await reader.cancel(); throw safe('Microsoft returned an unsupported response.'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader?.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw safe('Microsoft returned an unsupported response.'); }
  } catch (error) {
    if (error.safeMessage) throw error;
    throw safe('Microsoft could not be reached. No connection was saved; retry when the service is available.');
  } finally { clearTimeout(timeout); }
}

export async function exchangeAndVerify(config, code, verifier, fetcher = fetch) {
  const tokens = await jsonRequest(fetcher, `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.redirectUri, code, code_verifier: verifier, scope: SCOPES }).toString(),
  });
  if (typeof tokens.access_token !== 'string' || !tokens.access_token || /[\r\n]/.test(tokens.access_token)
    || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token
    || (tokens.token_type && tokens.token_type.toLowerCase() !== 'bearer'))
    throw safe('Microsoft did not return the offline authorization required by the Worker. Check the Web platform and offline_access scope.');
  const scopes = String(tokens.scope || '').split(/\s+/).map(scope => scope.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase());
  if (!scopes.includes('calendars.readwrite') || !scopes.includes('user.read'))
    throw safe('Microsoft did not grant the required delegated Calendars.ReadWrite and User.Read permissions.');
  const headers = { Authorization: `Bearer ${tokens.access_token}` };
  const profile = await jsonRequest(fetcher, 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', { headers });
  if (!verifiedMailbox(profile)) throw safe(`Sign-in did not match ${EXPECTED_MAILBOX}. No Worker credentials were updated.`);
  const calendar = await jsonRequest(fetcher,
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(EXPECTED_MAILBOX)}/calendar?$select=id,canEdit,owner`, { headers });
  if (typeof calendar.id !== 'string' || !calendar.id || calendar.canEdit !== true
    || calendar.owner?.address?.toLowerCase() !== EXPECTED_MAILBOX)
    throw safe('The expected Outlook calendar is not editable by this authorization. No Worker credentials were updated.');
  return { MICROSOFT_TENANT_ID: config.tenant, MICROSOFT_CLIENT_ID: config.clientId,
    MICROSOFT_CLIENT_SECRET: config.clientSecret, MICROSOFT_REFRESH_TOKEN: tokens.refresh_token };
}

function wranglerCli(env) {
  if (env.WRANGLER_CLI_PATH) {
    if (!isAbsolute(env.WRANGLER_CLI_PATH) || !existsSync(env.WRANGLER_CLI_PATH))
      throw safe('WRANGLER_CLI_PATH must point to an existing absolute Wrangler JavaScript CLI path.');
    return env.WRANGLER_CLI_PATH;
  }
  try {
    const packageJson = require.resolve('wrangler/package.json');
    const path = join(dirname(packageJson), 'bin', 'wrangler.js');
    if (existsSync(path)) return path;
  } catch { /* provide explicit local setup instructions below */ }
  throw safe('Install local Wrangler first: npm install --no-save --package-lock=false wrangler. Then authenticate Wrangler before running this utility.');
}

export async function storeWorkerSecrets(secrets, { env = process.env, spawnProcess = spawn, cliPath = wranglerCli(env) } = {}) {
  const names = ['MICROSOFT_TENANT_ID','MICROSOFT_CLIENT_ID','MICROSOFT_CLIENT_SECRET','MICROSOFT_REFRESH_TOKEN'];
  if (!secrets || !names.every(key => typeof secrets[key] === 'string' && secrets[key])) throw safe('The verified Microsoft credential set is incomplete.');
  const payload = Object.fromEntries(names.map(key => [key, secrets[key]]));
  const childEnv = { ...env, WRANGLER_LOG: 'none', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_SEND_METRICS: 'false' };
  for (const key of names) delete childEnv[key];
  return new Promise((resolvePromise, reject) => {
    // No shell interpolation, command-line secrets, temp credential files, or
    // inherited stdout/stderr that could print a third-party diagnostic token.
    const child = spawnProcess(process.execPath, [cliPath, 'secret', 'bulk', '--config', configPath], {
      cwd: root, shell: false, windowsHide: true, env: childEnv, stdio: ['pipe','ignore','ignore'],
    });
    const timeout = setTimeout(() => { child.kill(); reject(safe('Cloudflare secret update timed out. Check Wrangler authentication and retry setup.')); }, 120000);
    child.once('error', () => { clearTimeout(timeout); reject(safe('Wrangler could not run. Check its local installation and Cloudflare authentication.')); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(safe('Cloudflare secret update failed. Some values may have been applied. Check Wrangler authentication, then retry setup; no tokens were printed.'));
    });
    child.stdin.on('error', () => { /* close/error above provides a safe message */ });
    child.stdin.end(JSON.stringify(payload));
  });
}

function waitForCode(config, authorization, announce) {
  return new Promise((resolvePromise, reject) => {
    let finished = false;
    const finish = (error, code) => {
      if (finished) return; finished = true; clearTimeout(timeout); process.removeListener('SIGINT', interrupt);
      server.close(); error ? reject(error) : resolvePromise(code);
    };
    const interrupt = () => finish(safe('Calendar setup was cancelled. No connection was saved.'));
    const server = createServer({ maxHeaderSize: 16384 }, (request, response) => {
      const nonce = randomBytes(16).toString('base64');
      const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` };
      const host = String(request.headers.host || '').toLowerCase();
      if (request.method !== 'GET' || host !== `localhost:${config.port}`
        || (request.headers.origin && request.headers.origin !== `http://localhost:${config.port}`)) {
        response.writeHead(400, headers); response.end('Invalid local callback.'); return;
      }
      let code;
      try { code = callbackCode(request.url, authorization.state, config.redirectUri); }
      catch (error) {
        response.writeHead(400, headers); response.end('Authorization could not be verified. Return to the terminal.');
        // An unrelated local request cannot cancel a valid ongoing sign-in.
        if (request.url?.startsWith('/oauth/callback?') && request.url.includes(`state=${authorization.state}`)) finish(error);
        return;
      }
      response.writeHead(200, headers);
      response.end(`<!doctype html><title>Outlook connection</title><script nonce="${nonce}">history.replaceState(null,'','/oauth/complete')</script><h1>Sign-in received</h1><p>Return to the terminal to finish verification and see the connection result. You can close this window.</p>`);
      finish(null, code);
    });
    const timeout = setTimeout(() => finish(safe('Microsoft sign-in timed out. No connection was saved. Run setup again when ready.')), 10 * 60000);
    process.once('SIGINT', interrupt);
    server.once('error', () => finish(safe('The local OAuth callback port is unavailable. Close the other process or set OUTLOOK_CONNECT_PORT and register the matching Web redirect URI.')));
    server.listen(config.port, '127.0.0.1', () => announce(authorization.url));
  });
}

export async function main(env = process.env) {
  const config = connectionConfig(env), cliPath = wranglerCli(env);
  if (!existsSync(configPath)) throw safe('The expected backend/wrangler.jsonc configuration is missing.');
  const authorization = authorizationRequest(config);
  console.log(`This connects ${EXPECTED_MAILBOX} and updates the four MICROSOFT_* secrets of the Worker in backend/wrangler.jsonc.`);
  console.log(`Register this exact Web redirect URI first: ${config.redirectUri}`);
  const code = await waitForCode(config, authorization, url => { console.log('Open this Microsoft sign-in link in your browser:'); console.log(url); });
  const secrets = await exchangeAndVerify(config, code, authorization.verifier);
  await storeWorkerSecrets(secrets, { env, cliPath });
  console.log(`Verified ${EXPECTED_MAILBOX}; Microsoft Worker secrets updated securely. No calendar events or invitations were created.`);
  console.log('Check /api/health, then test availability. Use a deliberate test appointment only when ready to send any optional email invitation.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.safeMessage || 'Calendar setup failed. No tokens were printed. Check the local app registration and rerun when ready.'); process.exitCode = 1; });
}

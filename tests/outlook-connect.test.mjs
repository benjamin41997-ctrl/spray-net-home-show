import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { connectionConfig, authorizationRequest, callbackCode, verifiedMailbox, exchangeAndVerify, storeWorkerSecrets, EXPECTED_MAILBOX } from '../scripts/outlook-connect.mjs';

const env = { MICROSOFT_TENANT_ID: 'organizations', MICROSOFT_CLIENT_ID: 'test-client-id', MICROSOFT_CLIENT_SECRET: 'private-client-secret-123' };
const config = connectionConfig(env);

test('authorization uses random PKCE/state, a registered Web loopback URI, and no client secret in its URL', () => {
  const authorization = authorizationRequest(config), another = authorizationRequest(config), url = new URL(authorization.url);
  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:43187/oauth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(authorization.verifier).digest('base64url'));
  assert.notEqual(authorization.state, another.state); assert.notEqual(authorization.verifier, another.verifier);
  assert.equal(authorization.url.includes(env.MICROSOFT_CLIENT_SECRET), false);
  assert.equal(authorization.url.includes(authorization.verifier), false);
  assert.ok(url.searchParams.get('scope').includes('Calendars.ReadWrite')); assert.ok(url.searchParams.get('scope').includes('offline_access'));
});

test('loopback callback accepts only exact endpoint, one matching state and one authorization code', () => {
  const state = 'one-time-state';
  assert.equal(callbackCode(`/oauth/callback?state=${state}&code=one-time-code`, state), 'one-time-code');
  for (const path of ['/oauth/callback?state=wrong&code=secret', `/oauth/callback?state=${state}&state=${state}&code=x`,
    `/oauth/callback?state=${state}&code=x&code=y`, `/wrong?state=${state}&code=x`,
    `https://evil.example/oauth/callback?state=${state}&code=x`]) assert.throws(() => callbackCode(path, state));
  assert.throws(() => callbackCode(`/oauth/callback?state=${state}&error=denied&error_description=SECRET_DIAGNOSTIC`, state),
    error => !error.message.includes('SECRET_DIAGNOSTIC'));
});

test('setup refuses wrong mailbox identity, insecure configuration and unexpected target mailbox', () => {
  assert.equal(verifiedMailbox({ id: 'id', mail: EXPECTED_MAILBOX.toUpperCase() }), true);
  assert.equal(verifiedMailbox({ id: 'id', userPrincipalName: EXPECTED_MAILBOX }), true);
  assert.equal(verifiedMailbox({ id: 'other', mail: 'someone@example.com' }), false);
  assert.equal(verifiedMailbox({ mail: EXPECTED_MAILBOX }), false);
  for (const change of [{ MICROSOFT_CLIENT_SECRET: '' }, { MICROSOFT_CLIENT_SECRET: 'REPLACE_WITH_SECRET' },
    { OUTLOOK_CALENDAR_USER: 'someone@example.com' }, { OUTLOOK_CONNECT_PORT: '80' }, { MICROSOFT_TENANT_ID: '../bad' }])
    assert.throws(() => connectionConfig({ ...env, ...change }));
});

test('bootstrap verifies profile and editable calendar before returning secrets; creates no event', async () => {
  const calls = [];
  const secrets = await exchangeAndVerify(config, 'authorization-code', 'pkce-verifier', async (url, init) => {
    calls.push({ url, init }); assert.equal(init.redirect, 'error');
    if (url.includes('/token')) {
      const form = new URLSearchParams(init.body); assert.equal(form.get('code_verifier'), 'pkce-verifier');
      assert.equal(form.get('client_secret'), env.MICROSOFT_CLIENT_SECRET);
      assert.equal(url.includes(env.MICROSOFT_CLIENT_SECRET), false);
      return Response.json({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', scope: 'Calendars.ReadWrite User.Read', token_type: 'Bearer' });
    }
    if (url.includes('/me?')) return Response.json({ id: 'operator', mail: EXPECTED_MAILBOX });
    return Response.json({ id: 'calendar', canEdit: true, owner: { address: EXPECTED_MAILBOX } });
  });
  assert.equal(calls.length, 3); assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  assert.equal(calls.some(call => call.url.includes('/events')), false);
  assert.equal(secrets.MICROSOFT_REFRESH_TOKEN, 'private-refresh-token'); assert.equal(secrets.access_token, undefined);
});

test('a mismatched Microsoft account can never return a credential bundle for Wrangler', async () => {
  let calls = 0;
  await assert.rejects(exchangeAndVerify(config, 'code', 'verifier', async url => {
    calls++;
    return url.includes('/token') ? Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', scope: 'Calendars.ReadWrite User.Read' })
      : Response.json({ id: 'wrong-user', mail: 'someone@example.com' });
  }), /Sign-in did not match/);
  assert.equal(calls, 2);
});

test('Wrangler receives only four verified secrets through stdin with no shell or secret command arguments', async () => {
  const bundle = { ...env, MICROSOFT_REFRESH_TOKEN: 'private-refresh-token', access_token: 'must-never-be-stored' };
  let captured;
  await storeWorkerSecrets(bundle, { env, cliPath: '/test/wrangler.js', spawnProcess(executable, args, options) {
    const child = new EventEmitter(); let input = '';
    child.stdin = new Writable({ write(chunk, encoding, callback) { input += chunk.toString(); callback(); },
      final(callback) { captured = { executable, args, options, input }; callback(); queueMicrotask(() => child.emit('close', 0)); } });
    child.kill = () => {};
    return child;
  } });
  assert.equal(captured.options.shell, false); assert.equal(captured.options.windowsHide, true);
  assert.deepEqual(captured.options.stdio, ['pipe','ignore','ignore']);
  assert.equal(captured.args.join(' ').includes(bundle.MICROSOFT_REFRESH_TOKEN), false);
  assert.equal(captured.options.env.MICROSOFT_CLIENT_SECRET, undefined); assert.equal(captured.options.env.WRANGLER_LOG, 'none');
  assert.deepEqual(Object.keys(JSON.parse(captured.input)).sort(), ['MICROSOFT_CLIENT_ID','MICROSOFT_CLIENT_SECRET','MICROSOFT_REFRESH_TOKEN','MICROSOFT_TENANT_ID']);
});

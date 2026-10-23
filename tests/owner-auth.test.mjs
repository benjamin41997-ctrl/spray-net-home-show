import test from 'node:test';
import assert from 'node:assert/strict';
import { requireOwner } from '../backend/owner-auth.mjs';
import { createOwnerAuth, OWNER_AUTH_STORAGE_KEY } from '../public/owner-auth.js';
import { AuthClient } from '../public/vendor/supabase-auth.mjs';

const env={SUPABASE_URL:'https://owner-qa.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',OWNER_EMAIL:'ben.hessler@spray-net.com',ADMIN_TOKEN:'operator-fixture-secret-32-characters'};
const jwt='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,sub:'qa-owner'})).toString('base64url')+'.qa-signature';
const user={id:'qa-owner',email:'ben.hessler@spray-net.com',email_confirmed_at:'2026-10-01T00:00:00Z',is_anonymous:false};
const request=token=>new Request('https://api.example/api/admin/leads',{headers:token?{Authorization:'Bearer '+token}:{}});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('owner identity is verified with the existing provider before accepting its confirmed owner email',async()=>{
  let calls=0;
  await requireOwner(request(jwt),env,async(url,options)=>{
    calls++;assert.equal(url,'https://owner-qa.supabase.co/auth/v1/user');
    assert.equal(options.headers.Authorization,'Bearer '+jwt);assert.equal(options.headers.apikey,env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.redirect,'manual');assert.ok(!url.includes(jwt));
    return response({...user,email:'Ben.Hessler@Spray-Net.com'});
  });
  assert.equal(calls,1);
});
test('unverified, anonymous, missing and other-account identities cannot access owner records',async()=>{
  for(const profile of [{...user,email:'someone@example.com'},{...user,email_confirmed_at:null},{...user,is_anonymous:true},{email:user.email,email_confirmed_at:user.email_confirmed_at}])
    await assert.rejects(requireOwner(request(jwt),env,async()=>response(profile)),{status:403,code:'OWNER_REQUIRED'});
  for(const token of [undefined,'bad','a token with whitespace'])
    await assert.rejects(requireOwner(request(token),env,async()=>{throw Error('Must not call provider');}),{status:401});
});
test('expired or rejected provider tokens fail closed, while provider outages remain retryable without a forced sign-out',async()=>{
  for(const status of [400,401,403,422]) await assert.rejects(requireOwner(request(jwt),env,async()=>response({private:'not returned'},status)),{status:401});
  for(const status of [302,307,429,500,503]) await assert.rejects(requireOwner(request(jwt),env,async()=>response({private:'not returned'},status)),{status:503,code:'AUTH_UNAVAILABLE'});
  await assert.rejects(requireOwner(request(jwt),env,async()=>{throw Error('upstream private details');}),{status:503,code:'AUTH_UNAVAILABLE'});
  await assert.rejects(requireOwner(request(jwt),env,async()=>new Response('invalid JSON')),{status:503});
});
test('the existing private operator key remains independent, and incomplete or unsafe provider configuration grants no access',async()=>{
  await requireOwner(request(env.ADMIN_TOKEN),env,async()=>{throw Error('Operator must not call provider');});
  await assert.rejects(requireOwner(request(jwt),{...env,SUPABASE_URL:''}),{status:401});
  for(const url of ['http://owner-qa.supabase.co','https://secret@owner-qa.supabase.co','https://owner-qa.supabase.co?key=x','https://owner-qa.supabase.co/other'])
    await assert.rejects(requireOwner(request(jwt),{...env,SUPABASE_URL:url}),{status:503});
});
test('the actual auth SDK persists a provider session, reopens it without a password, refreshes it, and removes it on local sign-out',async t=>{
  const saved=new Map(),events=[];let next=1;
  const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  const make=options=>{
    const client=new AuthClient({...options,storage,fetch:async(url,options={})=>{
      const endpoint=new URL(url);events.push(endpoint.pathname+endpoint.search);
      if(endpoint.pathname.endsWith('/logout'))return new Response(null,{status:204});
      if(endpoint.pathname.endsWith('/user'))return response(user);
      assert.equal(endpoint.pathname,'/auth/v1/token');
      const body=JSON.parse(options.body);
      if(endpoint.searchParams.get('grant_type')==='password') assert.deepEqual(body,{email:user.email,password:'Only-a-test-password-42!',gotrue_meta_security:{}});
      else assert.ok(body.refresh_token);
      return response({access_token:jwt,refresh_token:'qa-refresh-'+next++,token_type:'bearer',expires_in:3600,user});
    }});
    t.after(()=>client.stopAutoRefresh());return client;
  };
  const config={supabaseUrl:env.SUPABASE_URL,supabasePublishableKey:env.SUPABASE_PUBLISHABLE_KEY};
  const first=createOwnerAuth(config,'https://show.example',make);
  await first.signIn(' Ben.Hessler@Spray-Net.com ','Only-a-test-password-42!');
  assert.ok(saved.has(OWNER_AUTH_STORAGE_KEY));assert.ok(!JSON.stringify([...saved]).includes('Only-a-test-password'));
  const reopened=createOwnerAuth(config,'https://show.example',make);
  assert.equal(await reopened.getAccessToken(),jwt);assert.equal(events.filter(e=>e.includes('grant_type=password')).length,1);
  await reopened.getAccessToken(true);assert.ok(events.some(e=>e.includes('grant_type=refresh_token')));
  assert.ok(saved.get(OWNER_AUTH_STORAGE_KEY).includes('qa-refresh-2'));
  await reopened.signOut();assert.equal(await reopened.getAccessToken(),'');assert.equal(saved.has(OWNER_AUTH_STORAGE_KEY),false);
  assert.ok(events.some(e=>e.endsWith('/logout?scope=local')));
});
test('failed password sign-in never creates a saved session or stores its password',async t=>{
  const saved=new Map();let client;
  const auth=createOwnerAuth({supabaseUrl:env.SUPABASE_URL,supabasePublishableKey:env.SUPABASE_PUBLISHABLE_KEY},'https://show.example',options=>client=new AuthClient({...options,
    storage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)},
    fetch:async()=>response({code:'invalid_credentials',msg:'Invalid login credentials'},400)}));
  t.after(()=>client.stopAutoRefresh());await assert.rejects(auth.signIn(user.email,'bad-password'));assert.equal(await auth.getAccessToken(),'');assert.equal(saved.size,0);
});

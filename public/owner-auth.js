import { AuthClient } from './vendor/supabase-auth.mjs';

// The review portal and this portal share a GitHub Pages origin and account.
export const OWNER_AUTH_STORAGE_KEY = 'spraynet-review-admin';
export function ownerAuthOptions(config, pageOrigin) {
  const url = new URL(config?.supabaseUrl || '');
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.origin === pageOrigin;
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Owner sign-in configuration is unavailable.');
  const key = config?.supabasePublishableKey;
  if (typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
    throw new Error('Owner sign-in requires a public publishable key.');
  return {url:url.origin+'/auth/v1',headers:{apikey:key},storageKey:OWNER_AUTH_STORAGE_KEY,
    persistSession:true,autoRefreshToken:true,detectSessionInUrl:false};
}
export function createOwnerAuth(config, pageOrigin, makeClient = options => new AuthClient(options)) {
  const client = makeClient(ownerAuthOptions(config,pageOrigin));
  return {
    async getAccessToken(refresh = false) {
      const result = refresh ? await client.refreshSession() : await client.getSession();
      if (result.error) throw result.error;
      return result.data?.session?.access_token || '';
    },
    async signIn(email,password) {
      const result = await client.signInWithPassword({email:email.trim().toLowerCase(),password});
      if (result.error) throw result.error;
      if (!result.data?.session) throw new Error('Sign-in did not complete. Try again.');
    },
    async signOut() {
      const result = await client.signOut({scope:'local'});
      if (result.error) throw result.error;
    },
    subscribe(callback) { return client.onAuthStateChange(callback).data.subscription; },
  };
}

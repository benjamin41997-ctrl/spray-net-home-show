/** Reuse the review portal's verified Supabase administrator identity. */
export class OwnerAuthError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new OwnerAuthError(status, code, message); };
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function equalSecret(left, right) {
  const [a,b] = await Promise.all([digest(left),digest(right)]);
  let difference = 0; for (let i=0;i<a.length;i++) difference |= a[i]^b[i];
  return difference === 0;
}
export async function requireOwner(request, env, fetcher = fetch) {
  const header = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_.-]{32,8192}$/.test(header))
    fail(401,'UNAUTHORIZED','Sign in to the owner portal to continue.');
  const token = header.slice(7);
  // Preserve the existing private operator/export key; the website never saves it.
  if (typeof env.ADMIN_TOKEN === 'string' && env.ADMIN_TOKEN.length >= 32
    && !/REPLACE_|YOUR_|CHANGEME/i.test(env.ADMIN_TOKEN) && await equalSecret(token,env.ADMIN_TOKEN)) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.OWNER_EMAIL)
    fail(env.ADMIN_TOKEN ? 401 : 503,'UNAUTHORIZED','Owner sign-in is unavailable or this session was not accepted.');
  let origin;
  try {
    const url = new URL(env.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    origin = url.origin;
  } catch { fail(503,'AUTH_UNAVAILABLE','Owner sign-in is temporarily unavailable. Try again.'); }
  let response;
  try {
    // Workers supports manual/follow redirects. Reject every 3xx response below
    // rather than forwarding the authorization header to another destination.
    response = await fetcher(origin+'/auth/v1/user', {headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:header},
      signal:AbortSignal.timeout(10000),redirect:'manual'});
  } catch { fail(503,'AUTH_UNAVAILABLE','The sign-in connection is unavailable. Your saved sign-in has not been cleared.'); }
  if ([400,401,403,404,422].includes(response.status)) fail(401,'UNAUTHORIZED','Sign in to the owner portal to continue.');
  if (!response.ok) fail(503,'AUTH_UNAVAILABLE','The sign-in connection is unavailable. Try again.');
  let user;
  try { user = await response.json(); } catch { fail(503,'AUTH_UNAVAILABLE','The sign-in connection is unavailable. Try again.'); }
  if (!user?.id || !user.email_confirmed_at || user.is_anonymous === true || typeof user.email !== 'string'
    || user.email.trim().toLowerCase() !== String(env.OWNER_EMAIL).trim().toLowerCase())
    fail(403,'OWNER_REQUIRED','This account does not have owner access. Use your Spray-Net owner account.');
}

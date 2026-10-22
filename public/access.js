// Resume an existing private studio session. This module never creates a lead,
// changes its render allowance, selects an API destination, or adds contact PII.
const LEAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const STUDIO_FRAGMENT = /^#studio=([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i;

function validStudioAccess(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && typeof value.token === 'string'
    && LEAD_ID.test(value.id) && VISITOR_TOKEN.test(value.token));
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch { return null; }
}

/** Return a bearer-protected link to an already saved lead's studio.
 * The fragment carries only a lead ID and its existing visitor token. Anyone
 * receiving this private link can access that session; it is not a public QR.
 * The API origin must always come from trusted application configuration.
 */
export function createStudioLink(pageUrl, lead) {
  const url = httpsUrl(pageUrl);
  if (!url) throw new TypeError('A credential-free HTTPS page URL is required.');
  if (!validStudioAccess(lead))
    throw new TypeError('A valid saved lead ID and visitor token are required.');
  url.search = '';
  url.hash = `studio=${lead.id.toLowerCase()}.${lead.token}`;
  return url.href;
}

/** Parse only the exact #studio=<UUID>.<token> format. Never accept API URLs. */
export function parseStudioAccess(fragment) {
  if (typeof fragment !== 'string') return null;
  const match = STUDIO_FRAGMENT.exec(fragment);
  if (!match || !LEAD_ID.test(match[1]) || !VISITOR_TOKEN.test(match[2])) return null;
  return { id: match[1].toLowerCase(), token: match[2] };
}

/** Scope saved pending work to the exact incoming, valid studio session. */
export function sameStudioAccess(left, right) {
  return validStudioAccess(left) && validStudioAccess(right)
    && left.id.toLowerCase() === right.id.toLowerCase() && left.token === right.token;
}

// Public business routing options (e.g. calendar, location, event_type, utm_*)
// may remain in a configured scheduler URL. Do not prefill contact information
// or carry session/API credentials through its query string.
const AUTH_QUERY_KEY = /token|secret|password|passcode|authorization|apikey|^auth$|^jwt$|^session(?:id)?$/i;
const CONTACT_QUERY_KEY = /^(?:(?:contact|customer|attendee|invitee|user))?(?:email(?:address)?|phone(?:number)?|mobile(?:number|phone)?|address|streetaddress|firstname|lastname|fullname|name|lead(?:id)?|contact(?:id)?)$/i;
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Return a safe configured HTTPS booking URL, or '' when disabled/invalid.
 * This accepts only configuration, never lead data, and appends no parameters.
 * Operators must keep any other configured query values free of personal data.
 */
export function bookingUrl(configuredUrl) {
  const url = httpsUrl(configuredUrl);
  if (!url || url.hash) return '';
  for (const [key, value] of url.searchParams) {
    const compactKey = key.replace(/[^A-Za-z0-9]/g, '');
    if (AUTH_QUERY_KEY.test(compactKey) || CONTACT_QUERY_KEY.test(compactKey) || EMAIL_VALUE.test(value)) return '';
  }
  return url.href;
}

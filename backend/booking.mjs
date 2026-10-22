/** Server-side Outlook consultation adapter; no browser-supplied confirmation.
 * Official references:
 * https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0
 * https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0
 * https://learn.microsoft.com/en-us/graph/api/event-get?view=graph-rest-1.0
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 * Delegated Calendars.ReadWrite + offline_access consent is required. OAuth app
 * registration/bootstrap belongs to the operator; this module never starts an
 * OAuth flow or sends real requests merely because it is imported.
 */
const GRAPH = 'https://graph.microsoft.com';
const TIME_ZONE = 'America/New_York';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const encoder = new TextEncoder();
const localFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export class BookingError extends Error {
  constructor(status, code, message) { super(message); this.name = 'BookingError'; this.status = status; this.code = code; }
}
const stop = (status, code, message) => { throw new BookingError(status, code, message); };
const unavailable = () => stop(503, 'BOOKING_UNAVAILABLE', 'Online booking is unavailable. Your details are saved; please ask the team to arrange your consultation.');
const credential = value => typeof value === 'string' && value.trim().length >= 4
  && value.length <= 32768 && !/REPLACE_|YOUR_|CHANGEME|[\r\n]/i.test(value);
const integer = (value, fallback, min, max) => {
  if (value == null || value === '') return fallback;
  return /^\d+$/.test(String(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
};
function clock(value, fallback) {
  const string = value == null || value === '' ? fallback : String(value);
  const match = /^(\d{2}):(\d{2})$/.exec(string);
  return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null;
}
export function bookingConfiguration(env) {
  const durationMinutes = integer(env.BOOKING_DURATION_MINUTES, 90, 30, 240);
  const bufferMinutes = integer(env.BOOKING_BUFFER_MINUTES, 30, 0, 180);
  const horizonDays = integer(env.BOOKING_HORIZON_DAYS, 14, 1, 30);
  const minNoticeMinutes = integer(env.BOOKING_MIN_NOTICE_MINUTES, 60, 0, 10080);
  const workStart = clock(env.BOOKING_WORK_START, '09:00'), workEnd = clock(env.BOOKING_WORK_END, '17:00');
  const workDays = String(env.BOOKING_WORK_DAYS ?? '1,2,3,4,5').split(',').map(value => value.trim());
  const scheduleValid = [durationMinutes, bufferMinutes, horizonDays, minNoticeMinutes, workStart, workEnd].every(value => value !== null)
    && workEnd > workStart && durationMinutes <= workEnd - workStart
    && workDays.length > 0 && workDays.every(day => /^[0-6]$/.test(day));
  const target = env.OUTLOOK_CALENDAR_USER == null ? '' : String(env.OUTLOOK_CALENDAR_USER).trim();
  const available = Boolean(env.DB && scheduleValid && /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(String(env.MICROSOFT_TENANT_ID || ''))
    && ['MICROSOFT_TENANT_ID','MICROSOFT_CLIENT_ID','MICROSOFT_CLIENT_SECRET','MICROSOFT_REFRESH_TOKEN'].every(key => credential(env[key]))
    && (!target || /^[A-Za-z0-9_.+@-]{1,254}$/.test(target)));
  return { available, scheduleValid, timeZone: TIME_ZONE, durationMinutes, bufferMinutes, horizonDays, minNoticeMinutes,
    workStart, workEnd, workDays: [...new Set(workDays.map(Number))] };
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  let string = ''; for (const byte of bytes) string += String.fromCharCode(byte);
  return btoa(string).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unbase64(value) {
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
async function identities(env) {
  // Include the bootstrap token's hash in this opaque key so switching the
  // delegated account cannot accidentally reuse another account's token cache.
  const calendarKey = await digest(JSON.stringify([env.MICROSOFT_TENANT_ID, env.MICROSOFT_CLIENT_ID,
    env.OUTLOOK_CALENDAR_USER || 'me', await digest(env.MICROSOFT_REFRESH_TOKEN)]));
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`outlook-token-encryption-v1:${env.MICROSOFT_CLIENT_SECRET}:${calendarKey}`));
  const cryptoKey = await crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt','decrypt']);
  const target = env.OUTLOOK_CALENDAR_USER ? `/users/${encodeURIComponent(String(env.OUTLOOK_CALENDAR_USER).trim())}` : '/me';
  return { calendarKey, cryptoKey, calendarPath: `/v1.0${target}/calendar` };
}
async function encrypt(value, identity) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(identity.calendarKey) }, identity.cryptoKey, encoder.encode(value));
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
async function decrypt(value, identity) {
  try {
    const [iv, ciphertext, extra] = value.split('.'); if (!iv || !ciphertext || extra) throw new Error();
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv),
      additionalData: encoder.encode(identity.calendarKey) }, identity.cryptoKey, unbase64(ciphertext)));
  } catch { stop(503, 'BOOKING_AUTH_SETUP', 'Calendar authorization needs attention. Please ask the team to arrange your consultation.'); }
}
async function boundedJson(response, max = 1024 * 1024) {
  if (Number(response.headers.get('content-length')) > max) unavailable();
  const reader = response.body?.getReader(); let size = 0; const chunks = [];
  try {
    if (reader) for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > max) { await reader.cancel(); unavailable(); } chunks.push(value);
    }
  } finally { reader?.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { unavailable(); }
}
async function http(fetcher, url, init, deadline, allowNotFound = false) {
  const timeout = Math.min(15000, deadline - Date.now()); if (timeout <= 0) unavailable();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' });
    if (allowNotFound && (response.status === 404 || response.status === 410)) return null;
    if (!response.ok) {
      // Do not expose OAuth error descriptions, calendar IDs, or event details.
      const error = new BookingError(503, 'BOOKING_PROVIDER_UNAVAILABLE', 'The calendar could not be reached. Your details are saved; please try again or contact the team.');
      error.providerStatus = response.status; throw error;
    }
    return await boundedJson(response);
  } catch (error) {
    if (error instanceof BookingError) throw error; unavailable();
  } finally { clearTimeout(timer); }
}
async function client(env, identity, options) {
  const fetcher = options.fetcher || fetch, deadline = Date.now() + 50000;
  const record = await env.DB.prepare('SELECT * FROM booking_tokens WHERE calendar_key=?').bind(identity.calendarKey).first();
  let access;
  if (record?.access_cipher && record.expires_at > Date.now() + 60000) access = await decrypt(record.access_cipher, identity);
  else {
    const refresh = record?.refresh_cipher ? await decrypt(record.refresh_cipher, identity) : env.MICROSOFT_REFRESH_TOKEN;
    const response = await http(fetcher, `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET,
        refresh_token: refresh, grant_type: 'refresh_token', scope: 'https://graph.microsoft.com/Calendars.ReadWrite offline_access' }).toString(),
    }, deadline);
    if (typeof response.access_token !== 'string' || !response.access_token || !Number.isFinite(Number(response.expires_in))
      || Number(response.expires_in) < 60 || (response.token_type && response.token_type.toLowerCase() !== 'bearer')) unavailable();
    access = response.access_token;
    const refreshCipher = await encrypt(typeof response.refresh_token === 'string' && response.refresh_token ? response.refresh_token : refresh, identity);
    await env.DB.prepare(`INSERT INTO booking_tokens(calendar_key,refresh_cipher,access_cipher,expires_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(calendar_key) DO UPDATE SET refresh_cipher=excluded.refresh_cipher,access_cipher=excluded.access_cipher,
      expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
      .bind(identity.calendarKey, refreshCipher, await encrypt(access, identity), Date.now() + Math.min(Number(response.expires_in), 86400) * 1000, new Date().toISOString()).run();
  }
  const headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json',
    Prefer: 'outlook.timezone="UTC", IdType="ImmutableId"' };
  return { async request(path, init = {}, allow404 = false) {
    return http(fetcher, `${GRAPH}${path}`, { ...init, headers: { ...headers, ...init.headers } }, deadline, allow404);
  } };
}
function epoch(value) {
  if (!value || typeof value.dateTime !== 'string') return NaN;
  const string = value.dateTime.replace(/(\.\d{3})\d+/, '$1');
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(string)) return Date.parse(string);
  if (value.timeZone === 'UTC' || value.timeZone === 'Etc/UTC') return Date.parse(`${string}Z`);
  return NaN; // UTC is explicitly requested; never guess a mailbox time zone.
}
function localParts(time) {
  const parts = Object.fromEntries(localFormatter.formatToParts(time).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday) };
}
export function validConsultationSlot(start, config, now) {
  const end = start + config.durationMinutes * 60000, a = localParts(start), b = localParts(end);
  return start >= now + config.minNoticeMinutes * 60000 && start > now
    && end <= now + config.horizonDays * 86400000 && start % (30 * 60000) === 0
    && config.workDays.includes(a.weekday) && a.day === b.day && a.minute >= config.workStart && b.minute <= config.workEnd;
}
/** Pure slot grid shared by the optional Outlook and internal schedulers. */
export function consultationCandidates(config, now = Date.now()) {
  if (!config.scheduleValid || !Number.isFinite(now)) return [];
  const until = now + config.horizonDays * 86400000, slots = [];
  for (let start = Math.ceil(now / (30 * 60000)) * 30 * 60000; start < until; start += 30 * 60000) {
    if (validConsultationSlot(start, config, now)) slots.push({ start: new Date(start).toISOString(),
      end: new Date(start + config.durationMinutes * 60000).toISOString(), timeZone: TIME_ZONE });
  }
  return slots;
}
async function calendarEvents(graph, identity, from, until) {
  const query = new URLSearchParams({ startDateTime: new Date(from).toISOString(), endDateTime: new Date(until).toISOString(),
    '$select': 'id,start,end,isCancelled,isOrganizer,showAs,transactionId,attendees', '$top': '100' });
  let path = `${identity.calendarPath}/calendarView?${query}`; const events = [];
  for (let page = 0; path && page < 20; page++) {
    const body = await graph.request(path);
    if (!Array.isArray(body.value)) unavailable();
    for (const event of body.value) {
      if (!Number.isFinite(epoch(event.start)) || !Number.isFinite(epoch(event.end)) || epoch(event.end) <= epoch(event.start)) unavailable();
      events.push(event);
    }
    path = null;
    if (body['@odata.nextLink']) {
      let next;
      try {
        next = new URL(body['@odata.nextLink']);
        if (decodeURIComponent(next.pathname) !== decodeURIComponent(`${identity.calendarPath}/calendarView`)) unavailable();
      } catch { unavailable(); }
      if (next.origin !== GRAPH || next.username || next.password || next.hash) unavailable();
      path = next.pathname + next.search;
    }
  }
  if (path) unavailable(); // A partial calendar must never be treated as free.
  return events;
}
const metadata = row => ({ status: row.status, start: row.start_at, end: row.end_at, timeZone: row.time_zone });
function overlapping(start, end, interval, buffer) {
  return start < interval.end + buffer && end > interval.start - buffer;
}
async function holds(env, key, excludeLead) {
  const { results } = await env.DB.prepare(`SELECT lead_id,start_at,end_at FROM consultation_bookings
    WHERE calendar_key=? AND status IN ('pending','confirmed')`).bind(key).all();
  return results.filter(row => row.lead_id !== excludeLead).map(row => ({ start: Date.parse(row.start_at), end: Date.parse(row.end_at) }));
}
function busyIntervals(events) {
  return events.filter(event => event.isCancelled !== true && event.showAs !== 'free')
    .map(event => ({ start: epoch(event.start), end: epoch(event.end) }));
}
async function prepared(env, options) {
  const config = bookingConfiguration(env); if (!config.available) unavailable();
  const identity = await identities(env); return { config, identity, graph: await client(env, identity, options) };
}
/** Options are trusted server/test dependencies, never request query values. */
export async function listConsultationSlots(env, options = {}) {
  const now = options.now ?? Date.now(), { config, identity, graph } = await prepared(env, options);
  const buffer = config.bufferMinutes * 60000, until = now + config.horizonDays * 86400000;
  const events = await calendarEvents(graph, identity, now - buffer, until + buffer);
  const busy = [...busyIntervals(events), ...await holds(env, identity.calendarKey)]; const slots = [];
  for (let start = Math.ceil(now / (30 * 60000)) * 30 * 60000; start < until; start += 30 * 60000) {
    const end = start + config.durationMinutes * 60000;
    if (validConsultationSlot(start, config, now) && !busy.some(interval => overlapping(start, end, interval, buffer)))
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), timeZone: TIME_ZONE });
  }
  return { bookingAvailable: true, timeZone: TIME_ZONE, durationMinutes: config.durationMinutes, bufferMinutes: config.bufferMinutes, slots };
}
async function markCancelled(env, row) {
  await env.DB.prepare("UPDATE consultation_bookings SET status='cancelled',updated_at=? WHERE lead_id=? AND transaction_id=?")
    .bind(new Date().toISOString(), row.lead_id, row.transaction_id).run();
  return { ...metadata(row), status: 'cancelled' };
}
function matchesEvent(event, row) {
  if (!event || typeof event.id !== 'string' || !event.id || event.isCancelled === true || event.isOrganizer !== true
    || (row.graph_event_id && event.id !== row.graph_event_id)
    || event.transactionId !== row.transaction_id || epoch(event.start) !== Date.parse(row.start_at) || epoch(event.end) !== Date.parse(row.end_at)) return false;
  if (row.attendee_email) {
    const attendee = event.attendees?.find(attendee => attendee.emailAddress?.address?.toLowerCase() === row.attendee_email.toLowerCase());
    if (!attendee || attendee.status?.response === 'declined') return false;
  }
  return true;
}
async function readEvent(graph, identity, id) {
  if (typeof id !== 'string' || !id || id.length > 2048) return null;
  return graph.request(`${identity.calendarPath}/events/${encodeURIComponent(id)}?$select=id,start,end,isCancelled,isOrganizer,transactionId,attendees`, {}, true);
}
async function verifyWithGraph(env, row, identity, graph) {
  const event = await readEvent(graph, identity, row.graph_event_id);
  if (!matchesEvent(event, row)) return markCancelled(env, row);
  return { ...metadata(row), status: 'confirmed' };
}
/** Revalidate on session/studio access. Provider failures throw (fail closed),
 * while a deleted/cancelled/moved/declined event persistently revokes the gate. */
export async function verifyConsultation(env, row, options = {}) {
  if (!row || !['pending','confirmed','cancelled'].includes(row.status)) return { status: 'cancelled' };
  if (row.status === 'cancelled') return metadata(row);
  const { config, identity, graph } = await prepared(env, options);
  if (identity.calendarKey !== row.calendar_key) unavailable();
  if (row.status === 'pending') {
    // A visitor opening their private project QR on a different device may no
    // longer have the browser's original request key. Reconcile read-only from
    // the durable server transaction, never create/retry an event from a GET.
    if (row.graph_event_id) {
      const event = await readEvent(graph, identity, row.graph_event_id);
      return matchesEvent(event, row) ? confirm(env, row, event) : markCancelled(env, row);
    }
    const buffer = config.bufferMinutes * 60000;
    const events = await calendarEvents(graph, identity, Date.parse(row.start_at) - buffer, Date.parse(row.end_at) + buffer);
    const event = events.find(event => event.transactionId === row.transaction_id);
    if (event) return matchesEvent(event, row) ? confirm(env, row, event) : markCancelled(env, row);
    return metadata(row);
  }
  return verifyWithGraph(env, row, identity, graph);
}
async function transactionId(identity, leadId, requestKey) {
  const hex = await digest(JSON.stringify([identity.calendarKey, leadId, requestKey]));
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${((parseInt(hex[16],16) & 3) | 8).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
async function acquire(env, calendarKey) {
  const owner = crypto.randomUUID(), now = Date.now();
  const locked = await env.DB.prepare(`INSERT INTO booking_calendar_locks(calendar_key,owner,expires_at) VALUES (?,?,?)
    ON CONFLICT(calendar_key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
    WHERE booking_calendar_locks.expires_at < ? RETURNING owner`).bind(calendarKey, owner, now + 90000, now).first();
  if (locked?.owner !== owner) stop(409, 'BOOKING_BUSY', 'Someone is choosing a time. Please try again in a moment.');
  return owner;
}
async function confirm(env, row, event) {
  if (!matchesEvent(event, row)) stop(503, 'BOOKING_NOT_VERIFIED', 'The appointment could not be verified yet. Please retry the same request or contact the team.');
  await env.DB.prepare("UPDATE consultation_bookings SET status='confirmed',graph_event_id=?,updated_at=? WHERE lead_id=? AND transaction_id=?")
    .bind(event.id, new Date().toISOString(), row.lead_id, row.transaction_id).run();
  return { ...metadata(row), status: 'confirmed' };
}
/** Creates a real Outlook event only after a saved authenticated lead exists.
 * The Worker must supply its trusted lead row and preserve requestKey on retries.
 * Local locks serialize this app's bookings; external Outlook writers can still
 * change the calendar, so Graph availability is rechecked immediately before POST.
 */
export async function bookConsultation(env, params, options = {}) {
  const config = bookingConfiguration(env); if (!config.available) unavailable();
  const lead = params?.lead, requestKey = params?.requestKey;
  if (!lead || !UUID.test(lead.id || '') || typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(requestKey))
    stop(400, 'INVALID_BOOKING', 'A saved project and unique booking request are required.');
  if (typeof params.start !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?Z$/.test(params.start))
    stop(400, 'INVALID_SLOT', 'Choose a consultation time from the available options.');
  const start = Date.parse(params.start), end = start + config.durationMinutes * 60000;
  if (!Number.isFinite(start)) stop(400, 'INVALID_SLOT', 'Choose a valid consultation time.');
  const startAt = new Date(start).toISOString(), endAt = new Date(end).toISOString();
  if (startAt !== params.start.replace(/:00Z$/, ':00.000Z'))
    stop(400, 'INVALID_SLOT', 'Choose a valid consultation time.');
  const email = String(params.email ?? lead.email ?? '').trim();
  const address = typeof lead.address === 'string' ? lead.address.trim() : '';
  if (!address || address.length > 180) stop(400, 'INVALID_ADDRESS', 'Enter the project street address before booking your consultation.');
  if (email.length > 254 || (email && !EMAIL.test(email))) stop(400, 'INVALID_EMAIL', 'Check the email address for your appointment invitation.');
  if ((params.end && params.end !== endAt) || (params.timeZone && params.timeZone !== TIME_ZONE))
    stop(400, 'INVALID_SLOT', 'Choose a consultation time from the available options.');
  const identity = await identities(env), owner = await acquire(env, identity.calendarKey);
  try {
    const graph = await client(env, identity, options), now = options.now ?? Date.now();
    const inputHash = await digest(JSON.stringify([startAt, endAt, email.toLowerCase(), address]));
    let row = await env.DB.prepare('SELECT * FROM consultation_bookings WHERE lead_id=?').bind(lead.id).first();
    if (row && row.calendar_key !== identity.calendarKey) unavailable();
    if (row?.status === 'confirmed') {
      const verification = await verifyWithGraph(env, row, identity, graph);
      if (verification.status === 'confirmed') {
        if (row.request_key === requestKey && row.input_hash === inputHash) return verification;
        stop(409, 'ALREADY_BOOKED', 'Your consultation is already booked. Contact the team to change it.');
      }
      row = { ...row, status: 'cancelled' };
    }
    if (row && row.status !== 'cancelled' && (row.request_key !== requestKey || row.input_hash !== inputHash))
      stop(409, 'BOOKING_PENDING', 'Your previous booking request is being checked. Retry that request or contact the team.');
    if (row?.status === 'cancelled' && row.request_key === requestKey)
      stop(409, 'BOOKING_CANCELLED', 'That appointment was cancelled or changed. Choose a time with a new booking request.');
    const buffer = config.bufferMinutes * 60000;
    const events = await calendarEvents(graph, identity, start - buffer, end + buffer);
    if (row?.status === 'pending') {
      if (row.graph_event_id) {
        const existingEvent = await readEvent(graph, identity, row.graph_event_id);
        if (matchesEvent(existingEvent, row)) return confirm(env, row, existingEvent);
        await markCancelled(env, row);
        stop(409, 'BOOKING_CANCELLED', 'The previous appointment was cancelled or changed in Outlook. Contact the team or choose a time with a new request.');
      }
      const recovered = events.find(event => event.transactionId === row.transaction_id);
      if (recovered) {
        if (matchesEvent(recovered, row)) return confirm(env, row, recovered);
        stop(409, 'BOOKING_REVIEW_REQUIRED', 'Your earlier booking needs a staff check before another time can be chosen. Keep this request and contact the team.');
      }
    }
    if (!validConsultationSlot(start, config, now)) {
      if (row?.status === 'pending') stop(409, 'BOOKING_REVIEW_REQUIRED', 'Your earlier booking could not be verified and that time is no longer in the booking window. Keep this request and ask the team to check Outlook.');
      stop(400, 'INVALID_SLOT', 'That time is outside the current booking window. Choose another available time.');
    }
    const busy = [...busyIntervals(events), ...await holds(env, identity.calendarKey, lead.id)];
    if (busy.some(interval => overlapping(start, end, interval, buffer))) {
      if (row?.status === 'pending') stop(409, 'BOOKING_REVIEW_REQUIRED', 'Your earlier booking could not be verified and the time is now busy. Keep this request and ask the team to check Outlook before choosing another time.');
      stop(409, 'SLOT_UNAVAILABLE', 'That time is no longer available. Please choose another.');
    }
    if (!row || row.status === 'cancelled') {
      row = { lead_id: lead.id, calendar_key: identity.calendarKey, status: 'pending', graph_event_id: null,
        transaction_id: await transactionId(identity, lead.id, requestKey), start_at: startAt, end_at: endAt,
        time_zone: TIME_ZONE, request_key: requestKey, input_hash: inputHash, attendee_email: email };
      await env.DB.prepare(`INSERT INTO consultation_bookings
        (lead_id,calendar_key,status,graph_event_id,transaction_id,start_at,end_at,time_zone,request_key,input_hash,attendee_email,updated_at)
        VALUES (?,?,'pending',NULL,?,?,?,?,?,?,?,?) ON CONFLICT(lead_id) DO UPDATE SET calendar_key=excluded.calendar_key,
        status='pending',graph_event_id=NULL,transaction_id=excluded.transaction_id,start_at=excluded.start_at,end_at=excluded.end_at,
        time_zone=excluded.time_zone,request_key=excluded.request_key,input_hash=excluded.input_hash,attendee_email=excluded.attendee_email,updated_at=excluded.updated_at`)
        .bind(row.lead_id,row.calendar_key,row.transaction_id,row.start_at,row.end_at,row.time_zone,row.request_key,row.input_hash,row.attendee_email,new Date().toISOString()).run();
    }
    const name = [lead.first_name || lead.firstName || '', lead.last_name || lead.lastName || ''].filter(Boolean).join(' ') || lead.name || 'Home show visitor';
    const event = { subject: 'Spray-Net consultation', body: { contentType: 'Text', content:
      `Consultation requested through the home show page.\nName: ${name}\nPhone: ${lead.phone || ''}\nService: ${lead.service || 'To discuss'}\nAddress: ${address}\nPlease confirm project details before travel.` },
      start: { dateTime: startAt.replace('Z',''), timeZone: 'UTC' }, end: { dateTime: endAt.replace('Z',''), timeZone: 'UTC' },
      showAs: 'busy', allowNewTimeProposals: false, transactionId: row.transaction_id,
      ...(email ? { attendees: [{ emailAddress: { address: email, name }, type: 'required' }] } : {}) };
    let created;
    try { created = await graph.request(`${identity.calendarPath}/events`, { method: 'POST', body: JSON.stringify(event) }); }
    catch (error) {
      if ([400,401,403,404,405,422,429].includes(error.providerStatus)) {
        await markCancelled(env, row);
        stop(503, 'BOOKING_NOT_CREATED', 'Outlook did not accept the appointment. No appointment was confirmed. Retry with a new booking request or ask the team for help.');
      }
      // A network error can happen after Graph creates the event. Keep the hold
      // and transaction ID; retrying the SAME request recovers or deduplicates it.
      if (error instanceof BookingError) return { ...metadata(row), status: 'pending' };
      throw error;
    }
    if (!created || typeof created.id !== 'string' || !created.id) return { ...metadata(row), status: 'pending' };
    await env.DB.prepare('UPDATE consultation_bookings SET graph_event_id=?,updated_at=? WHERE lead_id=? AND transaction_id=?')
      .bind(created.id,new Date().toISOString(),row.lead_id,row.transaction_id).run();
    const verified = await readEvent(graph, identity, created.id);
    return confirm(env, row, verified);
  } finally {
    await env.DB.prepare('DELETE FROM booking_calendar_locks WHERE calendar_key=? AND owner=?').bind(identity.calendarKey, owner).run();
  }
}

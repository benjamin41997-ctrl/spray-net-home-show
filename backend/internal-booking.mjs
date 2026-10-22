/** Authoritative internal consultation calendar. No Outlook connection, external
 * HTTP requests, email invitations, or browser-supplied confirmation flags.
 * The Worker authenticates visitors/admins before calling this module.
 */
import { BookingError, bookingConfiguration as scheduleConfiguration, consultationCandidates,
  validConsultationSlot } from './booking.mjs';
export { BookingError } from './booking.mjs';

const CALENDAR_KEY = 'internal:ben.hessler@spray-net.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const easternDate = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const stop = (status, code, message) => { throw new BookingError(status, code, message); };
const metadata = row => ({ status: row.status, start: row.start_at, end: row.end_at, timeZone: row.time_zone });

export function bookingConfiguration(env) {
  const config = scheduleConfiguration({ ...env, BOOKING_WORK_DAYS: env.BOOKING_WORK_DAYS ?? '0,1,2,3,4,5,6',
    BOOKING_WORK_START: env.BOOKING_WORK_START || '08:00', BOOKING_WORK_END: env.BOOKING_WORK_END || '19:00' });
  const startDate = env.BOOKING_START_DATE == null || env.BOOKING_START_DATE === '' ? '' : String(env.BOOKING_START_DATE);
  let startDateValid = !startDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const date = new Date(`${startDate}T12:00:00Z`);
    startDateValid = Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === startDate;
  }
  return { ...config, available: Boolean(env.DB && config.scheduleValid && startDateValid), provider: 'internal', startDate };
}
function onOrAfterStartDate(start,config) {
  if (!config.startDate) return true;
  const parts=Object.fromEntries(easternDate.formatToParts(start).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}` >= config.startDate;
}
function configured(env) {
  const config = bookingConfiguration(env);
  if (!config.available) stop(503, 'BOOKING_UNAVAILABLE', 'Online booking is unavailable. Your details are saved; contact the team to arrange your consultation.');
  return config;
}
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
async function transactionId(leadId, requestKey) {
  const value = await hash(JSON.stringify([CALENDAR_KEY,leadId,requestKey]));
  return `${value.slice(0,8)}-${value.slice(8,12)}-4${value.slice(13,16)}-${((parseInt(value[16],16) & 3) | 8).toString(16)}${value.slice(17,20)}-${value.slice(20,32)}`;
}
function instant(value, label = 'time') {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    || !Number.isFinite(Date.parse(value))) stop(400, 'INVALID_SLOT', `Choose a valid ${label} with an explicit time zone.`);
  const day = value.slice(0,10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day || Number(value.slice(11,13)) > 23)
    stop(400, 'INVALID_SLOT', `Choose a valid ${label}.`);
  return new Date(value).toISOString();
}
function overlapping(start, end, row, buffer) {
  return start < Date.parse(row.end_at) + buffer && end > Date.parse(row.start_at) - buffer;
}
async function busyRows(env) {
  const [bookings, blocks] = await Promise.all([
    env.DB.prepare("SELECT start_at,end_at FROM consultation_bookings WHERE calendar_key=? AND status IN ('pending','confirmed')").bind(CALENDAR_KEY).all(),
    env.DB.prepare('SELECT start_at,end_at FROM booking_time_blocks WHERE calendar_key=?').bind(CALENDAR_KEY).all(),
  ]);
  return [...bookings.results,...blocks.results];
}
export async function listConsultationSlots(env, options = {}) {
  const config = configured(env), now = options.now ?? Date.now(), busy = await busyRows(env), buffer = config.bufferMinutes * 60000;
  return { bookingAvailable: true, provider: 'internal', timeZone: config.timeZone,
    durationMinutes: config.durationMinutes, bufferMinutes: config.bufferMinutes,
    slots: consultationCandidates(config,now).filter(slot => onOrAfterStartDate(Date.parse(slot.start),config)
      && !busy.some(row => overlapping(Date.parse(slot.start),Date.parse(slot.end),row,buffer))) };
}
async function acquire(env) {
  const owner = crypto.randomUUID(), now = Date.now();
  const row = await env.DB.prepare(`INSERT INTO booking_calendar_locks(calendar_key,owner,expires_at) VALUES (?,?,?)
    ON CONFLICT(calendar_key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
    WHERE booking_calendar_locks.expires_at < ? RETURNING owner`).bind(CALENDAR_KEY,owner,now+30000,now).first();
  if (row?.owner !== owner) stop(409, 'BOOKING_BUSY', 'Someone is choosing a time. Please try again in a moment.');
  return owner;
}
async function locked(env, work) {
  const owner = await acquire(env);
  try { return await work(); }
  finally { await env.DB.prepare('DELETE FROM booking_calendar_locks WHERE calendar_key=? AND owner=?').bind(CALENDAR_KEY,owner).run(); }
}
export async function bookConsultation(env, params, options = {}) {
  const config = configured(env), lead = params?.lead, requestKey = params?.requestKey;
  if (!lead || typeof lead.id !== 'string' || !UUID.test(lead.id) || typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(requestKey))
    stop(400, 'INVALID_BOOKING', 'A saved project and unique booking request are required.');
  const address = typeof lead.address === 'string' ? lead.address.trim() : '';
  if (!address || address.length > 180) stop(400, 'INVALID_ADDRESS', 'Enter the project street address before booking your consultation.');
  const email = String(params.email ?? lead.email ?? '').trim();
  if (email.length > 254 || (email && !EMAIL.test(email))) stop(400, 'INVALID_EMAIL', 'Check your optional email address.');
  function addressPart(value, max) {
    if (value == null) return '';
    if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
      stop(400, 'INVALID_ADDRESS', 'Check your project address details.');
    return value.trim();
  }
  const city = addressPart(lead.city, 100), state = addressPart(lead.state, 2).toUpperCase(), zip = addressPart(lead.zip, 10);
  if ((state && !/^[A-Z]{2}$/.test(state)) || (zip && !/^\d{5}(?:-\d{4})?$/.test(zip)))
    stop(400, 'INVALID_ADDRESS', 'Check your project state and ZIP code, or leave those details blank.');
  const startAt = instant(params.start), start = Date.parse(startAt), end = start + config.durationMinutes * 60000,
    endAt = new Date(end).toISOString(), now = options.now ?? Date.now();
  if ((params.timeZone && params.timeZone !== config.timeZone) || (params.end && instant(params.end) !== endAt))
    stop(400, 'INVALID_SLOT', 'Choose a consultation time from the available options.');
  const inputHash = await hash(JSON.stringify([startAt,endAt,email.toLowerCase(),address,city,state,zip]));
  return locked(env, async () => {
    const existing = await env.DB.prepare('SELECT * FROM consultation_bookings WHERE lead_id=?').bind(lead.id).first();
    if (existing && existing.calendar_key !== CALENDAR_KEY)
      stop(409, 'BOOKING_REVIEW_REQUIRED', 'Your earlier appointment needs a staff check before another time can be chosen. Contact the team.');
    if (existing?.status === 'confirmed') {
      if (existing.request_key === requestKey && existing.input_hash === inputHash) return metadata(existing);
      stop(409, 'ALREADY_BOOKED', 'Your consultation is already booked. Contact the team to change it.');
    }
    if (existing?.status === 'pending') stop(409, 'BOOKING_REVIEW_REQUIRED', 'Your previous booking needs a staff check before another time can be chosen.');
    if (existing?.status === 'cancelled' && existing.request_key === requestKey)
      stop(409, 'BOOKING_CANCELLED', 'That appointment was cancelled. Choose a time with a new booking request.');
    if (!onOrAfterStartDate(start,config) || !validConsultationSlot(start,config,now))
      stop(400, 'INVALID_SLOT', 'That time is outside the booking window. Choose another available time.');
    const before = new Date(start-config.bufferMinutes*60000).toISOString(), after = new Date(end+config.bufferMinutes*60000).toISOString();
    const transaction = await transactionId(lead.id,requestKey), updated = new Date().toISOString();
    // Conflict checks and the write are ONE SQL statement. The calendar lease
    // improves UX; correctness does not depend on a lease lasting long enough.
    if (typeof env.DB.batch !== 'function') stop(503, 'BOOKING_STORAGE_UNAVAILABLE', 'Booking storage is unavailable. Your project is saved; please contact the team.');
    const reservation = env.DB.prepare(`INSERT INTO consultation_bookings
      (lead_id,calendar_key,status,graph_event_id,transaction_id,start_at,end_at,time_zone,request_key,input_hash,attendee_email,updated_at)
      SELECT ?,?,'confirmed',NULL,?,?,?,?,?,?,?,? WHERE
        NOT EXISTS (SELECT 1 FROM consultation_bookings WHERE calendar_key=? AND lead_id<>?
          AND status IN ('pending','confirmed') AND start_at < ? AND end_at > ?)
        AND NOT EXISTS (SELECT 1 FROM booking_time_blocks WHERE calendar_key=? AND start_at < ? AND end_at > ?)
      ON CONFLICT(lead_id) DO UPDATE SET calendar_key=excluded.calendar_key,status='confirmed',graph_event_id=NULL,
        transaction_id=excluded.transaction_id,start_at=excluded.start_at,end_at=excluded.end_at,time_zone=excluded.time_zone,
        request_key=excluded.request_key,input_hash=excluded.input_hash,attendee_email=excluded.attendee_email,updated_at=excluded.updated_at
        WHERE consultation_bookings.status='cancelled'`)
      .bind(lead.id,CALENDAR_KEY,transaction,startAt,endAt,config.timeZone,requestKey,inputHash,email,updated,
        CALENDAR_KEY,lead.id,after,before,CALENDAR_KEY,after,before);
    // D1 batch is a transaction: a failed contact update must roll back the
    // appointment too, otherwise a phone-first lead could lose its travel address.
    const contacts = env.DB.prepare(`UPDATE leads SET address=?,email=?,city=?,state=?,zip=?,consultation_preference='schedule_now'
      WHERE id=? AND EXISTS (SELECT 1 FROM consultation_bookings WHERE lead_id=? AND calendar_key=?
        AND transaction_id=? AND input_hash=? AND status='confirmed')`)
      .bind(address,email,city,state,zip,lead.id,lead.id,CALENDAR_KEY,transaction,inputHash);
    const results = await env.DB.batch([reservation,contacts]);
    if (Number(results[0]?.meta?.changes) !== 1) stop(409, 'SLOT_UNAVAILABLE', 'That time is no longer available. Please choose another.');
    const saved = await env.DB.prepare('SELECT * FROM consultation_bookings WHERE lead_id=? AND transaction_id=?')
      .bind(lead.id,transaction).first();
    if (!saved || saved.status !== 'confirmed') stop(503, 'BOOKING_STORAGE_UNAVAILABLE', 'Your appointment could not be verified. Retry the same request or contact the team.');
    return metadata(saved);
  });
}
/** Always read the current authoritative row: stale browser or Worker metadata
 * cannot preserve access after an administrator cancels the appointment. */
export async function verifyConsultation(env, row) {
  configured(env);
  if (!row || typeof row.lead_id !== 'string' || !UUID.test(row.lead_id)) return { status: 'cancelled' };
  const current = await env.DB.prepare('SELECT * FROM consultation_bookings WHERE lead_id=? AND calendar_key=?').bind(row.lead_id,CALENDAR_KEY).first();
  return current ? metadata(current) : { status: 'cancelled' };
}
export async function listAdminSchedule(env, options = {}) {
  const config = configured(env), now = new Date(options.now ?? Date.now()).toISOString();
  const [appointments, blocked] = await Promise.all([
    env.DB.prepare(`SELECT b.*,l.first_name,l.last_name,l.phone,l.email,l.address FROM consultation_bookings b
      JOIN leads l ON l.id=b.lead_id WHERE b.calendar_key=? AND b.status IN ('confirmed','pending') AND b.end_at>=?
      ORDER BY b.start_at LIMIT 1001`).bind(CALENDAR_KEY,now).all(),
    env.DB.prepare('SELECT * FROM booking_time_blocks WHERE calendar_key=? AND end_at>=? ORDER BY start_at LIMIT 1001').bind(CALENDAR_KEY,now).all(),
  ]);
  if (appointments.results.length > 1000 || blocked.results.length > 1000)
    stop(413, 'SCHEDULE_TOO_LARGE', 'This calendar exceeds the administrator display limit. Ask the operator for a database export.');
  return { timeZone: config.timeZone, provider: 'internal', bookings: appointments.results.map(row => ({ leadId: row.lead_id,
    name: [row.first_name,row.last_name].filter(Boolean).join(' '), phone: row.phone, email: row.email,
    address: row.address, ...metadata(row) })), blocks: blocked.results.map(row => ({ id: row.id,start: row.start_at,end: row.end_at,note: row.note })) };
}
export async function createTimeBlock(env, params, options = {}) {
  const config = configured(env), startAt = instant(params?.start,'block start'), endAt = instant(params?.end,'block end'),
    start = Date.parse(startAt), end = Date.parse(endAt), now = options.now ?? Date.now();
  const note = typeof params.note === 'string' ? params.note.trim() : '';
  if (end <= start || end-start > 30*86400000 || end <= now || end > now+180*86400000 || start < now-86400000 || note.length > 500)
    stop(400, 'INVALID_BLOCK', 'Choose a block of up to 30 days within the next 180 days, with a private note of 500 characters or fewer.');
  return locked(env, async () => {
    const duplicate = await env.DB.prepare('SELECT * FROM booking_time_blocks WHERE calendar_key=? AND start_at=? AND end_at=? AND note=?')
      .bind(CALENDAR_KEY,startAt,endAt,note).first();
    if (duplicate) return { id: duplicate.id,start: duplicate.start_at,end: duplicate.end_at,note: duplicate.note };
    const id = crypto.randomUUID(), stamp = new Date().toISOString(), before = new Date(start-config.bufferMinutes*60000).toISOString(),
      after = new Date(end+config.bufferMinutes*60000).toISOString();
    const inserted = await env.DB.prepare(`INSERT INTO booking_time_blocks(id,calendar_key,start_at,end_at,note,created_at,updated_at)
      SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM consultation_bookings
        WHERE calendar_key=? AND status IN ('pending','confirmed') AND start_at < ? AND end_at > ?) RETURNING *`)
      .bind(id,CALENDAR_KEY,startAt,endAt,note,stamp,stamp,CALENDAR_KEY,after,before).first();
    if (!inserted) stop(409, 'BLOCK_CONFLICT', 'An existing consultation or its travel buffer overlaps this block. Cancel or change the appointment first.');
    return { id: inserted.id,start: inserted.start_at,end: inserted.end_at,note: inserted.note };
  });
}
export async function deleteTimeBlock(env, id) {
  configured(env); if (typeof id !== 'string' || !UUID.test(id)) stop(400, 'INVALID_BLOCK', 'Choose a valid time block.');
  return locked(env, async () => {
    await env.DB.prepare('DELETE FROM booking_time_blocks WHERE id=? AND calendar_key=?').bind(id,CALENDAR_KEY).run();
    return { id,deleted: true };
  });
}
export async function cancelConsultation(env, leadId) {
  configured(env); if (typeof leadId !== 'string' || !UUID.test(leadId)) stop(400, 'INVALID_BOOKING', 'Choose a valid appointment.');
  return locked(env, async () => {
    const cancelled = await env.DB.prepare("UPDATE consultation_bookings SET status='cancelled',updated_at=? WHERE lead_id=? AND calendar_key=? RETURNING lead_id")
      .bind(new Date().toISOString(),leadId,CALENDAR_KEY).first();
    if (!cancelled) stop(404, 'BOOKING_NOT_FOUND', 'This appointment could not be found.');
    return { leadId,status: 'cancelled',visualizerUnlocked: false };
  });
}

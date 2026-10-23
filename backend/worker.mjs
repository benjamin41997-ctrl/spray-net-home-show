/** Private lead/photo API for a static GitHub Pages frontend.
 * Runtime: Cloudflare Worker Web APIs + D1 + private R2. No runtime packages.
 * Images edits reference: https://developers.openai.com/api/reference/resources/images/methods/edit
 */
import * as outlookBooking from './booking.mjs';
import * as internalBooking from './internal-booking.mjs';
import { AddressError } from './address.mjs';
import { addressResponse } from './address-response.mjs';
import { OwnerError, recordProjectVisit, listOwnerLeads, deleteOwnerLead, markConfirmationDraft } from './owner.mjs';
import { OwnerAuthError, requireOwner } from './owner-auth.mjs';
import { selectedSurfaces } from '../public/project-options.js';
import { customRenderPrompt } from '../public/render-settings.js';
import { ensureRenderQuota,readRenderQuota } from './render-quota.mjs';
const MAX_PHOTO = 10 * 1024 * 1024;
const MAX_RESULT = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
function bookingAdapter(env) {
  if (env.BOOKING_PROVIDER === 'internal') return internalBooking;
  if (env.BOOKING_PROVIDER == null || env.BOOKING_PROVIDER === '' || env.BOOKING_PROVIDER === 'outlook') return outlookBooking;
  fail(503, 'BOOKING_UNAVAILABLE', 'Online scheduling is unavailable. Your details are saved; please contact the team.');
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});
const int = (value, fallback, max) => /^\d+$/.test(String(value ?? ''))
  ? Math.min(max, Math.max(0, Number(value))) : fallback;
const secretReady = (value, length = 16) => typeof value === 'string' && value.length >= length
  && !/REPLACE_|YOUR_|CHANGEME/i.test(value);

export function configuration(env) {
  const origins = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ready = Boolean(env.DB && env.PHOTOS && secretReady(env.RATE_LIMIT_SALT) && origins.length);
  const customRequested = Boolean(env.RENDER_API_URL || env.RENDER_API_KEY);
  const custom = Boolean(env.RENDER_API_URL && env.RENDER_API_KEY && validHttps(env.RENDER_API_URL));
  const renderEnabled = String(env.RENDER_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  return { origins, ready, renderEnabled, renderAvailable: ready && renderEnabled && Boolean(customRequested ? custom : env.OPENAI_API_KEY), custom, customRequested,
    freeRenders: int(env.FREE_RENDERS, 5, 10), dailyLimit: int(env.DAILY_RENDER_LIMIT, 50, 5000),
    phoneRenderAttemptLimit:int(env.PHONE_RENDER_ATTEMPT_LIMIT,10,50),eventRenderLimit:int(env.EVENT_RENDER_LIMIT,500,5000),
    leadsPerHour: int(env.LEADS_PER_IP_HOUR, 30, 1000),
    timeout: Math.max(1000, int(env.RENDER_TIMEOUT_MS, 90000, 120000)),
    eventId: String(env.EVENT_ID || 'home-show-2026') };
}
function validHttps(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; }
  catch { return false; }
}
export async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function bearer(request) {
  const value = request.headers.get('Authorization') || '';
  const match = value.match(/^Bearer ([A-Za-z0-9_\-]{32,256})$/);
  if (!match) fail(401, 'UNAUTHORIZED', 'A valid access token is required.');
  return match[1];
}
function text(value, name, max, required = true) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    fail(400, 'INVALID_FIELD', `Please check ${name}.`);
  }
  const result = value.trim();
  if ((required && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result))
    fail(400, 'INVALID_FIELD', `Please check ${name}.`);
  return result;
}
export function validateLead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_BODY', 'Please check the form.');
  if (body.contactConsent !== true) fail(400, 'CONSENT_REQUIRED', 'Please agree to be contacted about your project.');
  let firstName = text(body.firstName, 'first name', 80, false);
  let lastName = text(body.lastName, 'last name', 80, false);
  const fullName = text(body.fullName ?? body.name, 'name', 161, false);
  if (!firstName && fullName) { const parts = fullName.split(/\s+/); firstName = parts.shift(); lastName ||= parts.join(' '); }
  if (!firstName) fail(400, 'NAME_REQUIRED', 'Enter your name.');
  firstName = text(firstName, 'name', 80); lastName = text(lastName, 'name', 80, false);
  const lead = {
    firstName, lastName,
    email: text(body.email, 'email', 254, false), phone: text(body.phone, 'phone number', 30),
    address: text(body.address, 'street address', 180, false), city: text(body.city, 'city', 100, false),
    state: text(body.state, 'state', 2, false).toUpperCase(), zip: text(body.zip, 'ZIP code', 10, false),
    service: text(body.service, 'service interest', 100, false), timeline: text(body.timeline, 'timeline', 100, false),
    consultationPreference: body.consultationPreference === undefined ? 'contact_me' : body.consultationPreference,
    captureMode: body.captureMode === 'tablet' ? 'tablet' : 'mobile',
    notes: text(body.notes, 'project notes', 2000, false), event: text(body.event, 'event', 160, false),
  };
  if (!['contact_me', 'schedule_now'].includes(lead.consultationPreference))
    fail(400, 'INVALID_CONSULTATION_PREFERENCE', 'Choose whether to schedule a consultation or ask our team to contact you.');
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) fail(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  if (!/^[+()\d\s.\-]+$/.test(lead.phone) || !/^\d{7,15}$/.test(lead.phone.replace(/\D/g, '')))
    fail(400, 'INVALID_PHONE', 'Enter a valid phone number.');
  if ((lead.state && !/^[A-Z]{2}$/.test(lead.state)) || (lead.zip && !/^\d{5}(?:-\d{4})?$/.test(lead.zip)))
    fail(400, 'INVALID_ADDRESS', 'Enter a two-letter state and a valid ZIP code.');
  return lead;
}
export function normalizePhone(value) {
  const digits = String(value).replace(/\D/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
}
export function detectImage(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
export function csvCell(value) {
  let string = String(value ?? '').replaceAll('\u0000', '');
  if (/^[\s\uFEFF]*[=+\-@]/.test(string) || /^[\t\r\n]/.test(string)) string = `'${string}`;
  return `"${string.replaceAll('"', '""')}"`;
}
async function readBounded(request, max) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > max) fail(413, 'TOO_LARGE', 'This file or request is too large.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); fail(413, 'TOO_LARGE', 'This file or request is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
async function readJson(request, max = 16 * 1024) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    fail(415, 'CONTENT_TYPE', 'Send this request as JSON.');
  try { return JSON.parse(new TextDecoder().decode(await readBounded(request, max))); }
  catch (error) { if (error instanceof ApiError) throw error; fail(400, 'INVALID_JSON', 'The request could not be read.'); }
}
async function leadFor(request, env, id) {
  const tokenHash = await hash(bearer(request));
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ? AND token_hash = ?').bind(id, tokenHash).first();
  if (!lead) fail(401, 'UNAUTHORIZED', 'Your session is unavailable. Please ask the booth team for help.');
  await ensureRenderQuota(env,lead,configuration(env));
  return lead;
}
function publicLead(lead) {
  return { name: `${lead.first_name} ${lead.last_name}`.trim(), firstName: lead.first_name, lastName: lead.last_name,
    phone: lead.phone, email: lead.email, address: lead.address, city: lead.city, state: lead.state,
    zip: lead.zip, service: lead.service };
}
function publicBooking(booking) {
  if (!booking) return { status: 'none' };
  return { status: booking.status, start: booking.start ?? booking.start_at,
    end: booking.end ?? booking.end_at, timeZone: booking.timeZone ?? booking.time_zone };
}
async function bookingFor(env, lead) {
  const booking = await env.DB.prepare('SELECT * FROM consultation_bookings WHERE lead_id=?').bind(lead.id).first();
  if (!booking || !['pending', 'confirmed'].includes(booking.status)) return { booking: publicBooking(booking), visualizerUnlocked: false };
  const verified = await bookingAdapter(env).verifyConsultation(env, booking);
  return { booking: publicBooking(verified), visualizerUnlocked: verified.status === 'confirmed' };
}
async function requireBooking(env, lead) {
  const state = await bookingFor(env, lead);
  if (!state.visualizerUnlocked)
    fail(403, 'BOOKING_REQUIRED', 'Schedule and confirm your consultation to unlock photo uploads and the visualizer.');
  return state;
}
async function throttle(request, env, config) {
  // CF-Connecting-IP is set by Cloudflare, not a trusted client-supplied proxy header.
  const ip = request.headers.get('CF-Connecting-IP') || 'local-development';
  const hour = Math.floor(Date.now() / 3600000);
  const bucket = await hash(`${env.RATE_LIMIT_SALT}:${ip}:${hour}`);
  const result = await env.DB.prepare(`INSERT INTO rate_limits(bucket, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`)
    .bind(bucket, (hour + 2) * 3600000).first();
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Date.now()).run();
  if (result.attempts > config.leadsPerHour) fail(429, 'RATE_LIMIT', 'Too many requests. Please ask the booth team for help.');
}
async function throttleAddresses(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local-development';
  const minute = Math.floor(Date.now() / 60000), expires = (minute + 2) * 60000;
  const ipBucket = await hash(`${env.RATE_LIMIT_SALT}:addresses:ip:${ip}:${minute}`);
  const globalBucket = await hash(`${env.RATE_LIMIT_SALT}:addresses:global:${minute}`);
  const reserve = bucket => env.DB.prepare(`INSERT INTO rate_limits(bucket,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts`).bind(bucket, expires).first();
  const local = await reserve(ipBucket);
  if (local.attempts > 60) fail(429, 'ADDRESS_RATE_LIMIT', 'Address suggestions are busy. Enter your address manually or try again in a minute.');
  const total = await reserve(globalBucket);
  if (total.attempts > 120) fail(429, 'ADDRESS_RATE_LIMIT', 'Address suggestions are busy. Enter your address manually or try again in a minute.');
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Date.now()).run();
}
async function createLead(request, env, config) {
  const lead = validateLead(await readJson(request));
  const clientToken = request.headers.get('X-Lead-Token'), requestKey = request.headers.get('Idempotency-Key');
  if ((clientToken || requestKey) && (!clientToken || !/^[A-Za-z0-9_-]{43}$/.test(clientToken)
    || !requestKey || !/^[\w-]{8,128}$/.test(requestKey)))
    fail(400, 'INVALID_SUBMISSION_KEY', 'A secure session token and submission key are required together.');
  await throttle(request, env, config);
  const id = crypto.randomUUID(), accessToken = clientToken || token(), now = new Date().toISOString();
  const tokenHash = await hash(accessToken), inputHash = await hash(JSON.stringify([config.eventId, lead]));
  const normalizedPhone = normalizePhone(lead.phone), identity = `phone:${normalizedPhone}`;
  async function existingLead() {
    return env.DB.prepare(`SELECT id,token_hash,request_key,input_hash,remaining_renders,consultation_preference FROM leads
      WHERE phone_normalized=? AND event_id=? ORDER BY CASE WHEN lead_identity=? THEN 0 ELSE 1 END,created_at,id LIMIT 1`)
      .bind(normalizedPhone, config.eventId, identity).first();
  }
  async function duplicateResponse(existing) {
    if (clientToken && requestKey && existing && existing.token_hash === tokenHash
      && existing.request_key === requestKey && existing.input_hash === inputHash)
      {const quota=await ensureRenderQuota(env,{...lead,id:existing.id,event_id:config.eventId,phone_normalized:normalizedPhone},config);
      return json({ id: existing.id, token: accessToken, ...quota,
        consultationPreference: existing.consultation_preference, booking: { status: 'none' }, visualizerUnlocked: false }, 200);
      }
    fail(409, 'ALREADY_REGISTERED', 'This phone number is already registered for this event. Use your saved project link or ask the booth team for help.');
  }
  const existing = await existingLead();
  if (existing) return duplicateResponse(existing);
  try {
    await env.DB.prepare(`INSERT INTO leads
      (id,token_hash,request_key,input_hash,lead_identity,phone_normalized,event_id,first_name,last_name,email,phone,address,city,state,zip,service,capture_mode,consultation_preference,timeline,notes,event_label,consent_at,consent_version,remaining_renders,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, tokenHash, requestKey || null, inputHash, identity, normalizedPhone, config.eventId,
        lead.firstName, lead.lastName, lead.email, lead.phone, lead.address, lead.city, lead.state, lead.zip,
        lead.service, lead.captureMode, lead.consultationPreference, lead.timeline, lead.notes, lead.event || config.eventId, now,
        String(env.CONSENT_VERSION || '2026-10-21-v1'), config.freeRenders, now).run();
  } catch (error) {
    if (/UNIQUE constraint/i.test(String(error))) {
      return duplicateResponse(await existingLead());
    }
    throw error;
  }
  const quota=await ensureRenderQuota(env,{id,event_id:config.eventId,phone_normalized:normalizedPhone},config);
  return json({ id, token: accessToken, ...quota,
    consultationPreference: lead.consultationPreference, booking: { status: 'none' }, visualizerUnlocked: false }, 201);
}
async function uploadPhoto(request, env, lead) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) fail(415, 'CONTENT_TYPE', 'Upload a photo using multipart form data.');
  const raw = await readBounded(request, MAX_PHOTO + 64 * 1024);
  let form;
  try { form = await new Response(raw, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { fail(400, 'INVALID_UPLOAD', 'The photo upload could not be read.'); }
  const file = form.get('photo');
  if (!file || typeof file.arrayBuffer !== 'function' || file.size === 0) fail(400, 'PHOTO_REQUIRED', 'Choose a photo to upload.');
  if (file.size > MAX_PHOTO) fail(413, 'PHOTO_TOO_LARGE', 'Photos must be 10 MB or smaller.');
  const bytes = new Uint8Array(await file.arrayBuffer()), mime = detectImage(bytes);
  if (!mime || file.type !== mime) fail(415, 'INVALID_IMAGE', 'Please upload a JPEG, PNG, or WebP photo.');
  const contentHash = await hash(bytes);
  let row = await env.DB.prepare('SELECT id,object_key FROM photos WHERE lead_id=? AND content_hash=?').bind(lead.id, contentHash).first();
  let inserted = false;
  if (!row) {
    const id = crypto.randomUUID(), key = `photos/${lead.id}/${id}`;
    try {
      await env.DB.prepare('INSERT INTO photos (id,lead_id,object_key,content_hash,mime_type,byte_length,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, lead.id, key, contentHash, mime, bytes.length, new Date().toISOString()).run();
      row = { id, object_key: key }; inserted = true;
    } catch (error) {
      // Concurrent retries can race; reuse the same row and repair its object with identical bytes.
      row = await env.DB.prepare('SELECT id,object_key FROM photos WHERE lead_id=? AND content_hash=?').bind(lead.id, contentHash).first();
      if (!row && /PHOTO_LIMIT/.test(String(error))) fail(429, 'PHOTO_LIMIT', 'This session has reached its eight-photo limit.');
      if (!row) throw error;
    }
  }
  // A failed R2 write leaves metadata available for a retry of this exact file,
  // rather than accidentally deleting a concurrent successful upload's metadata.
  await env.PHOTOS.put(row.object_key, bytes, { httpMetadata: { contentType: mime } });
  const saved=await env.DB.prepare("UPDATE photos SET status='ready' WHERE id=? AND lead_id=?").bind(row.id,lead.id).run();
  if(saved.meta.changes!==1) {
    await env.PHOTOS.delete(row.object_key);
    fail(401,'UNAUTHORIZED','This project is no longer available.');
  }
  return json({ id: row.id, url: `/api/leads/${lead.id}/photos/${row.id}` }, inserted ? 201 : 200);
}
function bytesToBase64(bytes) {
  let result = ''; const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) result += String.fromCharCode(...bytes.subarray(i, i + block));
  return btoa(result);
}
function decodeResult(base64, mime) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_RESULT / 3) * 4
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0)
    fail(502, 'INVALID_RENDER', 'The rendering service returned an unsupported image.');
  let bytes;
  try { bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); }
  catch { fail(502, 'INVALID_RENDER', 'The rendering service returned an unsupported image.'); }
  const actual = detectImage(bytes);
  if (!actual || actual !== mime || bytes.length > MAX_RESULT) fail(502, 'INVALID_RENDER', 'The rendering service returned an unsupported image.');
  return { bytes, mime };
}
function renderFailureMessage(code) {
  const messages = {
    RENDER_AUTH: 'The visualization service needs a connection update. Your preview credit has been restored. Please contact the team.',
    RENDER_BILLING: 'Visualizations are temporarily unavailable while our team updates the service. Your preview credit has been restored.',
    RENDER_RATE_LIMIT: 'The visualization service is busy. Your preview credit has been restored. Please try again later.',
    RENDER_MODEL_UNAVAILABLE: 'This visualization model is unavailable. Your preview credit has been restored. Please contact the team.',
    RENDER_INVALID_REQUEST: 'The visualization request could not be accepted. Your preview credit has been restored. Please contact the team.',
  };
  return messages[code] || 'The preview could not be generated. Your preview credit has been restored.';
}
async function upstreamRenderFailure(response) {
  let providerCode = '', providerType = '';
  try {
    // Parse only a bounded error envelope. Never retain or forward provider text,
    // request IDs, echoed credentials, image data, or arbitrary error metadata.
    const error = JSON.parse(new TextDecoder().decode(await readBounded(response, 16 * 1024)))?.error;
    if (typeof error?.code === 'string') providerCode = error.code;
    if (typeof error?.type === 'string') providerType = error.type;
  } catch { /* HTTP status still permits safe classification for malformed/oversized bodies. */ }
  let code = 'RENDER_FAILED';
  if ([401, 403].includes(response.status)) code = 'RENDER_AUTH';
  else if (response.status === 429) code = [providerCode, providerType].some(value =>
    ['insufficient_quota', 'billing_hard_limit_reached'].includes(value)) ? 'RENDER_BILLING' : 'RENDER_RATE_LIMIT';
  else if (providerCode === 'model_not_found') code = 'RENDER_MODEL_UNAVAILABLE';
  else if (response.status === 400) code = 'RENDER_INVALID_REQUEST';
  fail(502, code, renderFailureMessage(code));
}
export async function callRenderer(env, photo, settings, fetcher = fetch) {
  const config = configuration(env);
  if (!config.renderEnabled) fail(503, 'RENDER_UNAVAILABLE', 'Photo previews are not enabled yet. Your project details are saved.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout);
  try {
    let url, init;
    if (config.custom) {
      url = env.RENDER_API_URL;
      init = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RENDER_API_KEY}` },
        body: JSON.stringify({ image_base64: bytesToBase64(photo.bytes), mime_type: photo.mime,
          color_name: settings.colorName, color_hex: settings.colorHex, surface: settings.surface,
          ...(settings.surfaces?{surfaces:settings.surfaces}:{}),...(settings.customPrompt?{custom_prompt:settings.customPrompt}:{}) }) };
    } else if (!config.customRequested && env.OPENAI_API_KEY) {
      url = 'https://api.openai.com/v1/images/edits';
      const body = new FormData();
      body.append('image[]', new Blob([photo.bytes], { type: photo.mime }), `home.${photo.mime.split('/')[1]}`);
      body.append('model', env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst');
      const custom=customRenderPrompt(settings.customPrompt);
      body.append('prompt', `Create a realistic surface-refinishing color visualization of the supplied home or interior photo. Change only the ${settings.surface} to ${settings.colorName}, approximately ${settings.colorHex}. Apply this color to every selected surface that is visible, unless the homeowner requests different colors or finishes for those selected surfaces below. For windows, recolor only the frames and trim, preserving the glass. Preserve the exact scene geometry, perspective, layout, fixtures, architecture, surroundings, lighting and all other surfaces. Preserve shadows and material texture. No text, labels, logo or watermark. This is a color concept, not a construction plan.${custom?`\n\nHomeowner refinishing preferences (apply within the selected surfaces, with specific requested colors/finishes taking precedence over the default color):\n${JSON.stringify(custom)}`:''}`);
      body.append('n', '1'); body.append('quality', 'low'); body.append('size', '1024x1024'); body.append('output_format', 'jpeg');
      init = { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body };
    } else fail(503, 'RENDER_UNAVAILABLE', 'Photo previews are not enabled yet. Your project details are saved.');
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'manual' });
    if (!response.ok) await upstreamRenderFailure(response);
    const body = JSON.parse(new TextDecoder().decode(await readBounded(response, Math.ceil(MAX_RESULT / 3) * 4 + 65536)));
    // Never fetch arbitrary provider-returned URLs (SSRF/privacy). Custom APIs must return inline base64.
    if (config.custom) return decodeResult(body.image_base64, body.mime_type);
    return decodeResult(body.data?.[0]?.b64_json, 'image/jpeg');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(502, error?.name === 'AbortError' ? 'RENDER_TIMEOUT' : 'RENDER_FAILED',
      'The preview could not be generated. Your preview credit has been restored.');
  } finally { clearTimeout(timeout); }
}
async function settleStale(env, leadId) {
  // Longer than the enforced upstream timeout. This also recovers credits after a Worker is interrupted.
  const cutoff = new Date(Date.now() - 5 * 60000).toISOString();
  await env.DB.prepare(`UPDATE renders SET status='failed',error_code='RENDER_INTERRUPTED',updated_at=?
    WHERE lead_id=? AND status='pending' AND updated_at < ?`).bind(new Date().toISOString(), leadId, cutoff).run();
}
async function renderResponse(env, leadId, render, status = 200) {
  const quota=await readRenderQuota(env,leadId);
  return json({ id: render.id, status: render.status, ...quota,
    ...(render.status === 'completed' ? { imageUrl: `/api/leads/${leadId}/renders/${render.id}/image` } : {}),
    ...(render.status === 'failed' ? { error: { code: render.error_code || 'RENDER_FAILED', message: renderFailureMessage(render.error_code) } } : {}),
  }, status);
}
async function createRender(request, env, config, lead) {
  if (!config.renderAvailable) fail(503, 'RENDER_UNAVAILABLE', 'Photo previews are not enabled yet. Your project details are saved.');
  const body = await readJson(request);
  if (!body || typeof body !== 'object') fail(400, 'INVALID_BODY', 'Check your preview settings.');
  let surfaces;
  if(body.surfaces!==undefined)try{surfaces=selectedSurfaces(body.surfaces);}catch{fail(400,'INVALID_SETTINGS','Choose one or more available surfaces.');}
  const photoId = text(body.photoId, 'photo', 36), colorName = text(body.colorName, 'color name', 80),
    colorHex = text(body.colorHex, 'color', 7), surface = surfaces?surfaces.join(', '):text(body.surface, 'surface', 80);
  if (!UUID.test(photoId) || !/^#[0-9a-f]{6}$/i.test(colorHex)) fail(400, 'INVALID_SETTINGS', 'Check your photo and color selection.');
  let customPrompt;try{customPrompt=customRenderPrompt(body.customPrompt);}catch(error){fail(400,'INVALID_SETTINGS',error.message);}
  const requestKey = request.headers.get('Idempotency-Key');
  if (!requestKey || !/^[\w-]{8,128}$/.test(requestKey)) fail(400, 'IDEMPOTENCY_REQUIRED', 'A unique preview request key is required.');
  // Keep the legacy hash for empty instructions so pending pre-update requests
  // can still be retried without a second paid provider call.
  const inputs=[photoId,colorName,colorHex.toUpperCase(),surface];if(customPrompt)inputs.push(customPrompt);
  const inputHash = await hash(JSON.stringify(inputs));
  await settleStale(env, lead.id);
  const existing = await env.DB.prepare('SELECT * FROM renders WHERE lead_id=? AND request_key=?').bind(lead.id, requestKey).first();
  if (existing) {
    if (existing.input_hash !== inputHash) fail(409, 'KEY_REUSED', 'Use a new request key for different preview settings.');
    return renderResponse(env, lead.id, existing, existing.status === 'pending' ? 202 : 200);
  }
  const photo = await env.DB.prepare("SELECT * FROM photos WHERE id=? AND lead_id=? AND status='ready'").bind(photoId, lead.id).first();
  if (!photo) fail(404, 'PHOTO_NOT_FOUND', 'Choose an uploaded photo from this session.');
  const stored = await env.PHOTOS.get(photo.object_key);
  if (!stored) fail(404, 'PHOTO_NOT_FOUND', 'Please upload your photo again.');
  const id = crypto.randomUUID(), now = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO renders
      (id,lead_id,photo_id,request_key,input_hash,status,day,daily_limit,color_name,color_hex,surface,created_at,updated_at)
      VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?)`)
      .bind(id, lead.id, photoId, requestKey, inputHash, now.slice(0, 10), config.dailyLimit, customPrompt?'Custom preview':colorName, colorHex, surface, now, now).run();
  } catch (error) {
    if (/NO_CREDITS/.test(String(error))) fail(429, 'NO_CREDITS', 'You have used the free previews for this event. Your project details are saved.');
    if (/PHONE_ATTEMPT_CAP/.test(String(error))) fail(429,'PHONE_ATTEMPT_CAP','This project has reached its preview attempt limit. Please contact the team for help.');
    if (/EVENT_CAP/.test(String(error))) fail(429,'EVENT_CAP','The home-show preview limit has been reached. Please contact the team about your project.');
    if (/DAILY_CAP/.test(String(error))) fail(429, 'DAILY_CAP', 'Today’s preview limit has been reached. Please ask the booth team about your project.');
    if (/UNIQUE constraint/.test(String(error))) {
      const duplicate = await env.DB.prepare('SELECT * FROM renders WHERE lead_id=? AND request_key=?').bind(lead.id, requestKey).first();
      if (duplicate?.input_hash === inputHash) return renderResponse(env, lead.id, duplicate, duplicate.status === 'pending' ? 202 : 200);
      fail(409, 'KEY_REUSED', 'Use a new request key for different preview settings.');
    }
    throw error;
  }
  const key = `renders/${lead.id}/${id}`;
  try {
    const result = await callRenderer(env, { bytes: new Uint8Array(await stored.arrayBuffer()), mime: photo.mime_type }, { colorName, colorHex, surface,surfaces,customPrompt });
    await env.PHOTOS.put(key, result.bytes, { httpMetadata: { contentType: result.mime } });
    const update = await env.DB.prepare(`UPDATE renders SET status='completed',object_key=?,mime_type=?,updated_at=? WHERE id=? AND status='pending'`)
      .bind(key, result.mime, new Date().toISOString(), id).run();
    if (update.meta.changes !== 1) {
      await env.PHOTOS.delete(key);
      fail(409, 'RENDER_INTERRUPTED', 'The preview was interrupted. Your credit has been restored.');
    }
  } catch (error) {
    await env.DB.prepare(`UPDATE renders SET status='failed',error_code=?,updated_at=? WHERE id=? AND status='pending'`)
      .bind(error instanceof ApiError ? error.code : 'RENDER_FAILED', new Date().toISOString(), id).run();
    // R2 writes can complete before a D1 failure; best-effort cleanup without logging private keys.
    try { await env.PHOTOS.delete(key); } catch { /* orphan cleaned by retention tooling */ }
    if (error instanceof ApiError) throw error;
    fail(502, 'RENDER_FAILED', 'The preview could not be saved. Your preview credit has been restored.');
  }
  return renderResponse(env, lead.id, { id, status: 'completed' }, 201);
}
async function media(env, leadId, id, kind) {
  const row = await env.DB.prepare(kind === 'photos'
    ? "SELECT object_key,mime_type FROM photos WHERE id=? AND lead_id=? AND status='ready'"
    : "SELECT object_key,mime_type FROM renders WHERE id=? AND lead_id=? AND status='completed'")
    .bind(id, leadId).first();
  if (!row) fail(404, 'NOT_FOUND', 'This image is unavailable.');
  const object = await env.PHOTOS.get(row.object_key);
  if (!object) fail(404, 'NOT_FOUND', 'This image is unavailable.');
  return new Response(object.body, { headers: { 'Content-Type': row.mime_type, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store' } });
}
async function requireAdmin(request, env) {
  await requireOwner(request,env);
}
async function exportCsv(request, env) {
  await requireAdmin(request, env);
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM leads').first();
  if (count.count > 10000) fail(413, 'EXPORT_TOO_LARGE', 'Export exceeds 10,000 leads. Use an administrator database export.');
  const { results } = await env.DB.prepare(`SELECT l.id,l.first_name,l.last_name,l.email,l.phone,l.address,l.city,l.state,l.zip,
    l.service,l.capture_mode,l.consultation_preference,l.timeline,l.notes,l.event_id,l.event_label,l.consent_at,l.consent_version,l.remaining_renders,l.created_at,
    (SELECT COUNT(*) FROM photos p WHERE p.lead_id=l.id AND p.status='ready') AS photo_count,
    (SELECT COUNT(*) FROM renders r WHERE r.lead_id=l.id AND r.status='completed') AS render_count
    FROM leads l ORDER BY l.created_at DESC LIMIT 10000`).all();
  const columns = ['id','first_name','last_name','email','phone','address','city','state','zip','service','capture_mode','consultation_preference','timeline','notes',
    'event_id','event_label','consent_at','consent_version','remaining_renders','created_at','photo_count','render_count'];
  const csv = '\uFEFF' + [columns.map(csvCell).join(','), ...results.map(row => columns.map(c => csvCell(row[c])).join(','))].join('\r\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="home-show-leads.csv"' } });
}
async function route(request, env, config, context) {
  const { pathname } = new URL(request.url), method = request.method;
  if (pathname === '/api/health' && method === 'GET') {
    let ready = config.ready;
    if (ready) {
      try {
        await env.DB.prepare('SELECT id,phone_normalized,capture_mode FROM leads LIMIT 1').first();
        await env.DB.prepare('SELECT lead_id FROM consultation_bookings LIMIT 1').first();
        if (env.BOOKING_PROVIDER === 'internal') await env.DB.prepare('SELECT id FROM booking_time_blocks LIMIT 1').first();
      } catch { ready = false; }
    }
    const booking = bookingAdapter(env).bookingConfiguration(env);
    return json({ ready, renderAvailable: ready && config.renderAvailable, freeRenders: config.freeRenders,
      addressSuggestionsAvailable: ready,
      bookingAvailable: ready && booking.available, consultationMinutes: booking.durationMinutes,
      travelBufferMinutes: booking.bufferMinutes, timeZone: booking.timeZone });
  }
  if (!config.ready) fail(503, 'NOT_CONFIGURED', 'Live submissions are not enabled yet. Please contact the booth team.');
  if (pathname === '/api/addresses/suggest') {
    if (method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', 'Use the address suggestion form.');
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'ADDRESS_QUERY_INVALID', 'Enter a street number and part of the street name.');
    await throttleAddresses(request, env);
    return addressResponse(env, body, request, context);
  }
  if (pathname === '/api/admin/leads.csv' && method === 'GET') return exportCsv(request, env);
  if (pathname === '/api/admin/leads') {
    await requireAdmin(request,env);
    if (method !== 'GET') fail(405,'METHOD_NOT_ALLOWED','Use the owner lead dashboard.');
    return json(await listOwnerLeads(env,new URL(request.url)));
  }
  const adminLead=pathname.match(/^\/api\/admin\/leads\/([^/]+)$/);
  const adminDraft=pathname.match(/^\/api\/admin\/leads\/([^/]+)\/confirmation-drafts$/);
  if(adminDraft) {
    await requireAdmin(request,env);
    if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED','Use the confirmation draft action.');
    return json(await markConfirmationDraft(env,adminDraft[1],await readJson(request)));
  }
  if(adminLead) {
    await requireAdmin(request,env);
    if(method!=='DELETE')fail(405,'METHOD_NOT_ALLOWED','Use the owner lead deletion action.');
    if(!UUID.test(adminLead[1]))fail(400,'INVALID_LEAD','Choose a valid lead.');
    const body=await readJson(request);
    if(body?.confirmation!=='DELETE')fail(400,'DELETE_CONFIRMATION_REQUIRED','Confirm deletion of this lead.');
    await settleStale(env,adminLead[1].toLowerCase());
    const deletingLead=await env.DB.prepare('SELECT id,event_id,phone_normalized FROM leads WHERE id=?').bind(adminLead[1].toLowerCase()).first();
    if(deletingLead)await ensureRenderQuota(env,deletingLead,config);
    return json(await deleteOwnerLead(env,adminLead[1],body));
  }
  const adminBlock = pathname.match(/^\/api\/admin\/blocks\/([^/]+)$/);
  const adminCancel = pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/cancel$/);
  if (pathname === '/api/admin/bookings' || pathname === '/api/admin/blocks' || adminBlock || adminCancel) {
    await requireAdmin(request, env);
    if (env.BOOKING_PROVIDER !== 'internal')
      fail(409, 'INTERNAL_SCHEDULER_REQUIRED', 'This action is available only for the internal consultation calendar.');
    if (pathname === '/api/admin/bookings' && method === 'GET') return json(await internalBooking.listAdminSchedule(env,{week:new URL(request.url).searchParams.get('week')??undefined}));
    if (pathname === '/api/admin/blocks' && method === 'POST')
      return json(await internalBooking.createTimeBlock(env, await readJson(request)), 201);
    if (adminBlock && method === 'DELETE') {
      if (!UUID.test(adminBlock[1])) fail(400, 'INVALID_BLOCK', 'Choose a valid time block.');
      return json(await internalBooking.deleteTimeBlock(env, adminBlock[1]));
    }
    if (adminCancel && method === 'POST') {
      if (!UUID.test(adminCancel[1])) fail(400, 'INVALID_BOOKING', 'Choose a valid consultation.');
      return json(await internalBooking.cancelConsultation(env, adminCancel[1]));
    }
    fail(405, 'METHOD_NOT_ALLOWED', 'This request method is not supported.');
  }
  if (pathname === '/api/leads' && method === 'POST') return createLead(request, env, config);
  const visit = pathname.match(/^\/api\/leads\/([^/]+)\/visits$/);
  if (visit && UUID.test(visit[1])) {
    const lead = await leadFor(request,env,visit[1]);
    if (method !== 'POST') fail(405,'METHOD_NOT_ALLOWED','Use the project visit recorder.');
    return json(await recordProjectVisit(env,lead.id,await readJson(request)));
  }
  const bookingRoute = pathname.match(/^\/api\/leads\/([^/]+)\/consultation\/(slots|book)$/);
  if (bookingRoute && UUID.test(bookingRoute[1])) {
    const lead = await leadFor(request, env, bookingRoute[1]);
    if (bookingRoute[2] === 'slots' && method === 'GET') return json(await bookingAdapter(env).listConsultationSlots(env));
    if (bookingRoute[2] === 'book' && method === 'POST') {
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_BODY', 'Choose a consultation time.');
      const address = body.address === undefined ? lead.address : body.address;
      if (typeof address !== 'string' || !address.trim() || address.trim().length > 180
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(address))
        fail(400, 'INVALID_ADDRESS', 'Enter the project street address before scheduling your consultation.');
      const email = body.email === undefined ? lead.email : text(body.email, 'email', 254, false);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'INVALID_EMAIL', 'Enter a valid email address to schedule your consultation.');
      const addressChanged = address.trim() !== lead.address.trim();
      const city = text(body.city === undefined ? (addressChanged ? '' : lead.city) : body.city, 'city', 100, false);
      const state = text(body.state === undefined ? (addressChanged ? '' : lead.state) : body.state, 'state', 2, false).toUpperCase();
      const zip = text(body.zip === undefined ? (addressChanged ? '' : lead.zip) : body.zip, 'ZIP code', 10, false);
      if ((state && !/^[A-Z]{2}$/.test(state)) || (zip && !/^\d{5}(?:-\d{4})?$/.test(zip)))
        fail(400, 'INVALID_ADDRESS', 'Enter a two-letter state and a valid ZIP code, or leave those details blank.');
      const updatedLead = { ...lead, address: address.trim(), email, city, state, zip, consultation_preference: 'schedule_now' };
      await bookingAdapter(env).bookConsultation(env, { lead: updatedLead, start: body.start,
        requestKey: request.headers.get('Idempotency-Key') || body.requestKey, email });
      if (env.BOOKING_PROVIDER !== 'internal')
        await env.DB.prepare("UPDATE leads SET address=?,email=?,city=?,state=?,zip=?,consultation_preference='schedule_now' WHERE id=?")
          .bind(address.trim(), email, city, state, zip, lead.id).run();
      return json(await bookingFor(env, lead));
    }
    fail(405, 'METHOD_NOT_ALLOWED', 'This request method is not supported.');
  }
  const consultation = pathname.match(/^\/api\/leads\/([^/]+)\/consultation$/);
  if (consultation && UUID.test(consultation[1]) && method === 'POST') {
    const lead = await leadFor(request, env, consultation[1]);
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.consultationPreference !== 'schedule_now')
      fail(400, 'INVALID_CONSULTATION_PREFERENCE', 'Choose to request a consultation.');
    await env.DB.prepare("UPDATE leads SET consultation_preference='schedule_now' WHERE id=?").bind(lead.id).run();
    return json({ consultationPreference: 'schedule_now' });
  }
  const session = pathname.match(/^\/api\/leads\/([^/]+)\/session$/);
  if (session && UUID.test(session[1]) && method === 'GET') {
    const lead = await leadFor(request, env, session[1]); await settleStale(env, lead.id);
    const booking = await bookingFor(env, lead);
    const quota=await readRenderQuota(env,lead.id);
    const photos = booking.visualizerUnlocked ? (await env.DB.prepare("SELECT id FROM photos WHERE lead_id=? AND status='ready' ORDER BY created_at").bind(lead.id).all()).results : [];
    const renders = booking.visualizerUnlocked ? (await env.DB.prepare(`SELECT id,status,color_name,color_hex,surface,error_code FROM renders
      WHERE lead_id=? ORDER BY created_at`).bind(lead.id).all()).results : [];
    return json({ id: lead.id, ...quota,consultationPreference: lead.consultation_preference,
      lead: publicLead(lead), ...booking,
      photos: photos.map(photo => ({ id: photo.id, url: `/api/leads/${lead.id}/photos/${photo.id}` })),
      renders: renders.map(render => ({ id: render.id, status: render.status,
        colorName: render.color_name, colorHex: render.color_hex, surface: render.surface,
        ...(render.status === 'completed' ? { imageUrl: `/api/leads/${lead.id}/renders/${render.id}/image` } : {}),
        ...(render.status === 'failed' ? { error: { code: render.error_code || 'RENDER_FAILED', message: 'Preview failed. Your credit has been restored.' } } : {}),
      })),
    });
  }
  const match = pathname.match(/^\/api\/leads\/([^/]+)\/(photos|renders)(?:\/([^/]+))?(\/image)?$/);
  if (!match || !UUID.test(match[1]) || (match[3] && !UUID.test(match[3]))) fail(404, 'NOT_FOUND', 'This endpoint does not exist.');
  const [, leadId, kind, id, suffix] = match, lead = await leadFor(request, env, leadId);
  await requireBooking(env, lead);
  if (method === 'POST' && !id) return kind === 'photos' ? uploadPhoto(request, env, lead) : createRender(request, env, config, lead);
  if (method === 'GET' && id && kind === 'photos' && !suffix) return media(env, leadId, id, kind);
  if (method === 'GET' && id && kind === 'renders') {
    if (suffix) return media(env, leadId, id, kind);
    await settleStale(env, leadId);
    const render = await env.DB.prepare('SELECT * FROM renders WHERE id=? AND lead_id=?').bind(id, leadId).first();
    if (!render) fail(404, 'NOT_FOUND', 'This preview is unavailable.');
    return renderResponse(env, leadId, render);
  }
  fail(405, 'METHOD_NOT_ALLOWED', 'This request method is not supported.');
}
export default {
  async fetch(request, env, context) {
    const config = configuration(env), origin = request.headers.get('Origin');
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    if (origin && !config.origins.includes(origin)) return json({ error: { code: 'ORIGIN_DENIED', message: 'This website is not allowed to use the service.' } }, 403, headers);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Expose-Headers'] = 'Content-Disposition';
    let response;
    try {
      if (request.method === 'OPTIONS') response = new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type,Idempotency-Key,X-Lead-Token', 'Access-Control-Max-Age': '600' } });
      else {
        // Use primary reads for lead creation followed immediately by uploads/renders.
        const bindings = env.DB?.withSession ? { ...env, DB: env.DB.withSession('first-primary') } : env;
        response = await route(request, bindings, config, context);
      }
    } catch (error) {
      const safe = error instanceof ApiError || error instanceof AddressError || error instanceof OwnerError || error instanceof OwnerAuthError || error instanceof outlookBooking.BookingError || error instanceof internalBooking.BookingError
        ? error : new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again or contact the booth team.');
      response = json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
    const result = new Response(response.body, response);
    for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
    return result;
  },
};

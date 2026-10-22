import { safeApiBase } from './lib.js';
import { createCalendarFile } from './calendar.js';

const EASTERN_ZONE = 'America/New_York';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localParts = new Intl.DateTimeFormat('en-US', { timeZone: EASTERN_ZONE, calendar: 'iso8601', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const displayDate = new Intl.DateTimeFormat('en-US', { timeZone: EASTERN_ZONE, weekday: 'short', month: 'short', day: 'numeric',
  year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

function partsAt(timestamp) {
  return Object.fromEntries(localParts.formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

/** Resolve wall-clock Eastern input independently of the browser's local zone.
 * Reject spring-forward gaps and repeated fall-back times rather than silently
 * blocking the wrong hour. No calendar record or credential is read here.
 */
export function easternDateTimeToUtc(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) throw new Error('Enter a complete date and time in Eastern Time.');
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59)
    throw new Error('Enter a valid date and time.');
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const calendarDate = new Date(wallClock);
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day)
    throw new Error('Enter a valid calendar date.');
  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = wallClock + hours * 3600000, parts = partsAt(instant);
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant);
  }
  const matches = [...offsets].map(offset => wallClock - offset).filter(instant => {
    const p = partsAt(instant);
    return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute && p.second === 0;
  });
  if (!matches.length) throw new Error('That Eastern time does not occur because the clocks move forward. Choose another time.');
  if (matches.length > 1) throw new Error('That Eastern time occurs twice because the clocks move back. Choose a time outside the repeated hour.');
  return new Date(matches[0]).toISOString();
}

export function formatEasternInstant(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('The calendar returned an invalid appointment time.');
  return displayDate.format(date);
}

if (typeof document !== 'undefined') initializeAdmin();

function initializeAdmin() {
  const $ = selector => document.querySelector(selector);
  const state = { token: '', busy: false, authenticated: false, generation: 0, lastActivity: Date.now(), controllers: new Set(), downloads: new Set() };
  let apiBase = '';
  try { apiBase = safeApiBase(window.SPRAYNET_CONFIG?.apiBase, location.origin); } catch {}
  const message = (text = '', success = false) => {
    const box = $('#admin-message'); box.textContent = text; box.hidden = !text; box.classList.toggle('success', success);
  };
  function clearCalendar() {
    $('#appointments-list').replaceChildren(); $('#blocks-list').replaceChildren();
    $('#appointment-count').textContent = ''; $('#block-count').textContent = '';
    $('#appointments-empty').hidden = true; $('#blocks-empty').hidden = true; $('#calendar-status').textContent = '';
  }
  function busy(value, label = '') {
    state.busy = value;
    $('#sign-in').disabled = value || !apiBase;
    for (const button of document.querySelectorAll('[data-action-button]')) button.disabled = value;
    if (label) $('#calendar-status').textContent = label;
  }
  function signOut(text = 'You’re signed out.') {
    state.generation++; state.token = ''; state.authenticated = false;
    for (const controller of state.controllers) controller.abort(); state.controllers.clear();
    for (const url of state.downloads) URL.revokeObjectURL(url); state.downloads.clear();
    clearCalendar(); $('#staff-key').value = ''; $('#block-form').reset();
    $('#calendar-workspace').hidden = true; $('#sign-in-panel').hidden = false; $('#sign-out').hidden = true;
    busy(false); message(text); $('#staff-key').focus({ preventScroll: true });
  }
  function safeError(error) {
    if (error?.status === 401 || error?.status === 403) return 'The staff access key was not accepted. Sign in again to continue.';
    if (error?.status === 404) return 'Staff scheduling is unavailable at this connection. No calendar data is shown.';
    if (error?.code === 'INTERNAL_SCHEDULER_REQUIRED') return 'This staff calendar is available only with the internal scheduler. No calendar data is shown.';
    return error?.safeMessage || 'The calendar connection failed. Private details have been cleared. Sign in again when the connection is available.';
  }
  async function request(path, { method = 'GET', body } = {}) {
    if (!apiBase || !state.token) throw new Error('CONNECTION_UNAVAILABLE');
    const generation = state.generation;
    const controller = new AbortController(); state.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = { Authorization: `Bearer ${state.token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(apiBase + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
      if (generation !== state.generation) throw new Error('SESSION_CLEARED');
      let data;
      try { data = await response.json(); } catch { throw new Error('UNREADABLE_RESPONSE'); }
      if (generation !== state.generation) throw new Error('SESSION_CLEARED');
      if (!response.ok) {
        const error = new Error('CALENDAR_REQUEST_FAILED'); error.status = response.status; error.code = data.error?.code;
        if ([400, 409, 422].includes(response.status) && typeof data.error?.message === 'string') error.safeMessage = data.error.message.slice(0, 400);
        throw error;
      }
      return data;
    } finally { clearTimeout(timer); state.controllers.delete(controller); }
  }
  function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob); state.downloads.add(url);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    link.hidden = true; document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); state.downloads.delete(url); }, 10000);
  }
  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  function detail(label, value, phone = false) {
    const row = element('p', 'contact-detail'); row.append(element('strong', '', label));
    const cleanedPhone = String(value || '').replace(/[^+\d]/g, '');
    if (phone && /^\+?\d{7,15}$/.test(cleanedPhone)) {
      const link = element('a', '', String(value)); link.href = `tel:${cleanedPhone}`; row.append(link);
    } else row.append(document.createTextNode(String(value || 'Not supplied')));
    return row;
  }
  function validInstant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
  function renderCalendar(data) {
    if (!data || !Array.isArray(data.bookings) || !Array.isArray(data.blocks)) throw new Error('INVALID_CALENDAR_RESPONSE');
    for (const row of data.bookings) if (!row || !UUID.test(row.leadId) || !validInstant(row.start) || !validInstant(row.end)
      || !['confirmed', 'pending'].includes(row.status)) throw new Error('INVALID_CALENDAR_RESPONSE');
    for (const row of data.blocks) if (!row || !UUID.test(row.id) || !validInstant(row.start) || !validInstant(row.end))
      throw new Error('INVALID_CALENDAR_RESPONSE');
    clearCalendar();
    const appointments = [...data.bookings].sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
    for (const appointment of appointments) {
      const card = element('article', 'appointment');
      card.append(element('p', 'appointment-time', `${formatEasternInstant(appointment.start)} – ${formatEasternInstant(appointment.end)}`));
      const heading = element('div', 'appointment-heading');
      heading.append(element('h3', '', appointment.name || 'Home show visitor'), element('span', `badge${appointment.status === 'pending' ? ' pending' : ''}`, appointment.status === 'pending' ? 'PENDING' : 'CONFIRMED'));
      card.append(heading, detail('Phone', appointment.phone, true), detail('Project address', appointment.address));
      if (appointment.email) card.append(detail('Email', appointment.email));
      const actions = element('div', 'appointment-actions'), cancel = element('button', 'danger-button', 'Cancel consultation');
      if (appointment.status === 'confirmed') {
        const download = element('button', 'button secondary small', 'Download for Outlook');
        download.type = 'button'; download.setAttribute('data-action-button', '');
        download.setAttribute('aria-label', 'Download calendar file with 90-minute consultation and 30-minute travel buffer');
        download.addEventListener('click', () => {
          if (state.busy || !state.authenticated) return;
          try {
            const file = createCalendarFile({ id: appointment.leadId, start: appointment.start, end: appointment.end, address: appointment.address || '', bufferMinutes: 30 });
            downloadFile(new Blob([file], { type: 'text/calendar;charset=utf-8' }), `spray-net-outlook-${appointment.start.slice(0, 10)}.ics`);
            message('Calendar file downloaded. Import it into Outlook manually; it does not send an invitation or keep calendars in sync.', true);
          } catch { message('This appointment could not be downloaded. Refresh the calendar and try again.'); }
        });
        actions.append(download);
      }
      cancel.type = 'button'; cancel.setAttribute('data-action-button', '');
      cancel.addEventListener('click', () => {
        if (state.busy || !confirm(`Cancel the consultation for ${appointment.name || 'this visitor'} on ${formatEasternInstant(appointment.start)}? Their visualizer access will be locked.`)) return;
        mutate(`/api/admin/bookings/${appointment.leadId}/cancel`, 'POST', undefined, 'Consultation cancelled.');
      });
      actions.append(cancel); card.append(actions); $('#appointments-list').append(card);
    }
    const blocks = [...data.blocks].sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
    for (const block of blocks) {
      const card = element('article', 'block-entry');
      card.append(element('p', '', `${formatEasternInstant(block.start)} – ${formatEasternInstant(block.end)}`));
      if (block.note) card.append(element('p', 'block-note', block.note));
      const remove = element('button', 'danger-button', 'Remove block'); remove.type = 'button'; remove.setAttribute('data-action-button', '');
      remove.addEventListener('click', () => {
        if (state.busy || !confirm('Remove this unavailable block? Its times may become bookable.')) return;
        mutate(`/api/admin/blocks/${block.id}`, 'DELETE', undefined, 'Unavailable block removed.');
      });
      card.append(remove); $('#blocks-list').append(card);
    }
    $('#appointment-count').textContent = String(appointments.length); $('#block-count').textContent = String(blocks.length);
    $('#appointments-empty').hidden = appointments.length > 0; $('#blocks-empty').hidden = blocks.length > 0;
    $('#calendar-status').textContent = `Updated ${new Intl.DateTimeFormat('en-US', { timeZone: EASTERN_ZONE, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date())} · Eastern Time`;
  }
  async function loadCalendar(generation = state.generation) {
    clearCalendar(); $('#calendar-status').textContent = 'Loading the private calendar…';
    const data = await request('/api/admin/bookings');
    if (generation !== state.generation) return false;
    renderCalendar(data); return true;
  }
  async function mutate(path, method, body, successMessage) {
    if (!state.authenticated || state.busy) return;
    const generation = state.generation; busy(true, 'Updating the calendar…'); message();
    try {
      await request(path, { method, body }); if (generation !== state.generation) return;
      if (path === '/api/admin/blocks' && method === 'POST') $('#block-form').reset();
      if (await loadCalendar(generation)) message(successMessage, true);
    } catch (error) {
      if (generation !== state.generation) return;
      if ([400, 409, 422].includes(error.status) && error.code !== 'INTERNAL_SCHEDULER_REQUIRED') message(safeError(error));
      else signOut(safeError(error));
    } finally { if (generation === state.generation) busy(false); }
  }
  $('#sign-in-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.busy) return;
    if (!apiBase) { message('The staff calendar is not connected in this preview. Open the connected site or ask your team for access.'); return; }
    const input = $('#staff-key'); if (!input.checkValidity()) { input.reportValidity(); return; }
    state.generation++; const generation = state.generation;
    state.token = input.value.trim(); input.value = ''; state.lastActivity = Date.now();
    busy(true); message('Checking staff access…');
    try {
      if (await loadCalendar(generation)) {
        state.authenticated = true; $('#sign-in-panel').hidden = true; $('#calendar-workspace').hidden = false; $('#sign-out').hidden = false;
        message(); $('#appointments-title').setAttribute('tabindex', '-1'); $('#appointments-title').focus({ preventScroll: true });
      }
    } catch (error) { if (generation === state.generation) signOut(safeError(error)); }
    finally { if (generation === state.generation) busy(false); }
  });
  $('#refresh-calendar').addEventListener('click', async () => {
    if (state.busy || !state.authenticated) return;
    const generation = state.generation; busy(true); message();
    try { await loadCalendar(generation); }
    catch (error) { if (generation === state.generation) signOut(safeError(error)); }
    finally { if (generation === state.generation) busy(false); }
  });
  $('#download-leads').addEventListener('click', async () => {
    if (state.busy || !state.authenticated) return;
    const generation = state.generation, controller = new AbortController(); state.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000); busy(true, 'Preparing your private lead export…'); message();
    try {
      const response = await fetch(apiBase + '/api/admin/leads.csv', { headers: { Authorization: `Bearer ${state.token}` },
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
      if (generation !== state.generation) return;
      if (!response.ok) { const error = new Error('EXPORT_FAILED'); error.status = response.status; throw error; }
      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.toLowerCase().includes('text/csv')) throw new Error('INVALID_EXPORT_RESPONSE');
      const blob = await response.blob(); if (generation !== state.generation) return;
      downloadFile(blob, `spray-net-home-show-leads-${new Date().toISOString().slice(0, 10)}.csv`);
      message('Lead CSV downloaded. Keep it private and use the approved Spray-Network import mapping.', true);
      $('#calendar-status').textContent = 'Private lead export downloaded.';
    } catch (error) { if (generation === state.generation) signOut(safeError(error)); }
    finally { clearTimeout(timeout); state.controllers.delete(controller); if (generation === state.generation) busy(false); }
  });
  $('#block-form').addEventListener('submit', event => {
    event.preventDefault(); if (state.busy || !state.authenticated) return;
    for (const input of event.target.querySelectorAll('input')) if (!input.checkValidity()) { input.reportValidity(); return; }
    try {
      const start = easternDateTimeToUtc($('#block-start').value), end = easternDateTimeToUtc($('#block-end').value);
      if (Date.parse(end) <= Date.parse(start)) throw new Error('End time must be after the start time.');
      if (Date.parse(start) < Date.now() - 86400000) throw new Error('An unavailable block may start up to 24 hours ago. Choose a more recent start.');
      if (Date.parse(end) <= Date.now()) throw new Error('The unavailable period must end in the future.');
      if (Date.parse(end) > Date.now() + 180 * 86400000) throw new Error('Choose an end within the next 180 days.');
      if (Date.parse(end) - Date.parse(start) > 30 * 86400000) throw new Error('An unavailable block can last up to 30 days.');
      mutate('/api/admin/blocks', 'POST', { start, end, note: $('#block-note').value.trim() }, 'Unavailable time added.');
    } catch (error) { message(error.message); }
  });
  $('#sign-out').addEventListener('click', () => signOut());
  for (const event of ['pointerdown', 'keydown', 'input', 'scroll']) document.addEventListener(event, () => { state.lastActivity = Date.now(); }, { passive: true });
  setInterval(() => { if (state.token && Date.now() - state.lastActivity >= 10 * 60000) signOut('You were signed out after 10 minutes without activity. Private details have been cleared.'); }, 1000);
  // Do not allow a history-cache restore to resurrect private DOM or credentials.
  window.addEventListener('pagehide', () => signOut('You’re signed out.'));
  window.addEventListener('pageshow', event => { if (event.persisted) signOut('Sign in again to view the private calendar.'); });
  busy(false);
  if (!apiBase) message('The staff calendar is not connected in this preview. Open the connected site or ask your team for access.');
}

import { COLORS, MAX_PHOTOS, validatePhoto, safeApiBase, privateMediaUrl, contactValues } from './lib.js';
import { createStudioLink, parseStudioAccess, bookingUrl, sameStudioAccess } from './access.js';

const config = window.SPRAYNET_CONFIG || {};
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const form = $('#lead-form');
const state = {
  step: 0, photos: [], lead: null, remaining: config.freeRenders ?? 3,
  selectedPhoto: 0, color: 0, ready: false, renderAvailable: false, busy: false,
  consultationPreference: 'contact_me', pendingRender: null, completedRender: null,
  urls: new Set(), shownResults: new Set()
};
const STORAGE_KEY = 'spraynet-home-show-session-v1';
const incomingAccess = parseStudioAccess(location.hash);
if (location.hash.startsWith('#studio=')) history.replaceState(null, '', location.pathname + location.search);
const calendarUrl = bookingUrl(config.bookingUrl);
let apiBase = '';

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}
function saveSession(extra = {}) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readSession(), ...extra })); } catch { /* Private link remains available without browser storage. */ }
}
function leadToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function message(text = '') {
  const box = $('#form-alert');
  box.textContent = text; box.hidden = !text;
  if (text) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function objectUrl(blob) {
  const url = URL.createObjectURL(blob); state.urls.add(url); return url;
}
function release(url) { URL.revokeObjectURL(url); state.urls.delete(url); }
function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) { button.dataset.label = button.innerHTML; button.textContent = label; }
  else if (button.dataset.label) { button.innerHTML = button.dataset.label; delete button.dataset.label; }
}
function setStep(step, { scroll = true } = {}) {
  if (step >= 2 && !state.lead) { message('Submit your project before opening your private studio.'); return; }
  state.step = step;
  $$('[data-step]').forEach(el => { el.hidden = Number(el.dataset.step) !== step; });
  $$('[data-progress]').forEach(el => {
    const n = Number(el.dataset.progress), current = Math.min(step, 2);
    el.classList.toggle('active', n === current); el.classList.toggle('done', n < current);
    if (n === current) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
  });
  form.hidden = step >= 2;
  message();
  if (state.lead) saveSession({ view: step === 3 ? 'studio' : 'confirmation' });
  const title = $(`[data-step="${step}"] h3`);
  if (scroll) { title?.focus({ preventScroll: true }); $('#project').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
}
async function request(path, { method = 'GET', body, token, headers = {}, timeout = 30000 } = {}) {
  if (!apiBase) throw new Error('This is a design preview. Live lead capture and rendering have not been connected. Nothing has been submitted.');
  const options = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeout) };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  const response = await fetch(`${apiBase}${path}`, options);
  let data;
  try { data = await response.json(); } catch { throw new Error('Our project connection returned an unreadable response. Please ask the team for help.'); }
  if (!response.ok) {
    const error = new Error(data.error?.message || data.error || 'We could not save that request. Please try again.');
    error.status = response.status; error.code = data.error?.code; throw error;
  }
  return data;
}
function safeLink(value) {
  if (!value) return '';
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
function renderConfirmation() {
  const requested = state.consultationPreference === 'schedule_now';
  $('#confirmation-message').textContent = 'Your project details are saved with our South Charlotte team.';
  $('#consultation-message').textContent = requested
    ? (calendarUrl ? 'Your consultation request is saved. Choose an available time in our booking calendar.' : 'Your consultation request is saved. Our team will contact you to arrange a date and time.')
    : 'Want to talk through your project? Ask our team to arrange a consultation.';
  $('#request-consultation').hidden = requested;
  $('#request-consultation').textContent = calendarUrl ? 'Schedule a consultation →' : 'Request a consultation →';
  const booking = $('#booking-link');
  booking.hidden = !requested || !calendarUrl;
  if (calendarUrl) booking.href = calendarUrl;
  $('#consultation-status').textContent = requested && !calendarUrl ? 'Request received · appointment time still to be confirmed' : '';
  const linkField = $('#studio-access-link');
  try {
    linkField.value = createStudioLink(location.href, state.lead);
    $('#copy-studio-link').disabled = false;
  } catch {
    linkField.value = ''; $('#copy-studio-link').disabled = true;
    $('#access-status').textContent = 'Private links will be available on the published HTTPS site.';
  }
}
async function restoreSession() {
  const saved = readSession();
  let matching = saved?.apiBase === apiBase ? saved : null;
  // A private link selects one saved lead. Never reuse another visitor's pending work.
  if (incomingAccess && !sameStudioAccess(matching?.lead, incomingAccess)) matching = null;
  state.busy = true;
  try {
    if (incomingAccess) state.lead = incomingAccess;
    else if (matching?.pendingLead) {
      const p = matching.pendingLead;
      state.lead = await request('/api/leads', { method: 'POST', body: p.payload, headers: { 'X-Lead-Token': p.token, 'Idempotency-Key': p.key } });
      state.consultationPreference = p.payload.consultationPreference || 'contact_me';
      saveSession({ lead: state.lead, pendingLead: null });
    } else if (matching?.lead) state.lead = matching.lead;
    if (!state.lead) return;
    const session = await request(`/api/leads/${state.lead.id}/session`, { token: state.lead.token });
    state.remaining = session.remainingRenders;
    state.consultationPreference = session.consultationPreference || matching?.consultationPreference || state.consultationPreference;
    state.pendingRender = matching?.pendingRender || null;
    saveSession({
      apiBase, lead: state.lead, pendingLead: null,
      pendingRender: matching?.pendingRender || null,
      completedRender: matching?.completedRender || null,
      consultationPreference: state.consultationPreference
    });
    renderConfirmation();
    $('#remaining-renders').textContent = String(state.remaining);
    updateRenderAvailability();
    setStep(incomingAccess || matching?.view === 'studio' ? 3 : 2);
    $('#render-status').textContent = 'Loading your saved studio…';
    state.savedMedia = { photos: session.photos || [], renders: session.renders || [] };
    if (state.step === 3) await loadSavedStudioMedia();
    updateRenderAvailability();
    $('#render-status').textContent = state.pendingRender ? 'A previous visualization request needs checking. Use the render button to resume it.' : '';
  } catch {
    state.lead = null;
    if (state.step >= 2) setStep(0);
    message('Your saved project could not be reopened. Please check your private link or ask our team for help before submitting again.');
  } finally { state.busy = false; }
}
async function loadSavedStudioMedia() {
  if (!state.lead || !state.savedMedia || sameStudioAccess(state.loadedMediaFor, state.lead) || sameStudioAccess(state.mediaLoadAccess, state.lead)) return;
  const access = { id: state.lead.id, token: state.lead.token }, media = state.savedMedia;
  state.mediaLoadAccess = access; $('#render-status').textContent = 'Loading your saved photos…';
  try {
    for (const photo of media.photos) {
      if (!sameStudioAccess(state.lead, access)) return;
      try {
        const url = await fetchPrivateImage(photo.url);
        if (!sameStudioAccess(state.lead, access)) { release(url); return; }
        if (!state.photos.some(p => p.remote?.id === photo.id)) state.photos.push({ file: null, url, remote: photo }); else release(url);
        studioPhotos();
      } catch { /* A failed photo read does not block consultation scheduling. */ }
    }
    for (const result of media.renders) {
      if (!sameStudioAccess(state.lead, access)) return;
      if (result.status === 'completed') {
        try { await showRender(result, { name: result.colorName || 'Your color' }); }
        catch {
          if (sameStudioAccess(state.lead, access)) { state.completedRender = { result, color: { name: result.colorName || 'Your color' } }; $('#retry-image').hidden = false; }
        }
      }
    }
    if (sameStudioAccess(state.lead, access)) state.loadedMediaFor = access;
  } finally {
    if (sameStudioAccess(state.mediaLoadAccess, access)) state.mediaLoadAccess = null;
    if (sameStudioAccess(state.lead, access)) $('#render-status').textContent = state.pendingRender ? 'A previous visualization request needs checking. Use the render button to resume it.' : '';
  }
}
async function connect() {
  try {
    apiBase = safeApiBase(config.apiBase, location.origin);
    if (!apiBase) return;
    const health = await request('/api/health');
    state.ready = health.ready === true; state.renderAvailable = health.renderAvailable === true;
    state.remaining = health.freeRenders ?? state.remaining;
    $$('[data-render-count]').forEach(el => { el.textContent = String(state.remaining); });
    const banner = $('#connection-banner');
    banner.textContent = state.ready ? 'Meet your South Charlotte team · share your project and request a consultation' : 'Design preview · the project connection is not ready to accept submissions.';
    banner.classList.toggle('live', state.ready);
    if (state.ready) await restoreSession();
  } catch {
    state.ready = false;
    $('#connection-banner').textContent = 'Our project connection is unavailable. Please speak with the team at the booth. Nothing has been submitted.';
  }
}
function updateRenderAvailability() {
  $('#render-button').disabled = !state.renderAvailable || (state.remaining <= 0 && !state.pendingRender);
  $('#studio-message').textContent = state.renderAvailable
    ? 'Your project is already saved. Explore colors whenever you have a little time.'
    : 'Your project is saved. Rendering is currently unavailable; you can return with your private link later.';
}
function studioPhotos() {
  const area = $('#studio-photo-list'); area.replaceChildren();
  if (state.selectedPhoto >= state.photos.length) state.selectedPhoto = 0;
  state.photos.forEach((photo, i) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'studio-photo-option';
    button.setAttribute('aria-label', `Use project photo ${i + 1}${photo.remote ? ', uploaded' : ', upload pending'}`);
    button.setAttribute('aria-pressed', String(i === state.selectedPhoto));
    const image = document.createElement('img'); image.src = photo.url; image.alt = `Project photo ${i + 1}`;
    const label = document.createElement('small'); label.textContent = photo.remote ? 'Uploaded' : 'Upload pending';
    button.append(image, label); button.addEventListener('click', () => { state.selectedPhoto = i; studioPhotos(); }); area.append(button);
  });
}
async function uploadPhoto(photo) {
  if (photo.remote) return;
  const body = new FormData(); body.append('photo', photo.file);
  photo.remote = await request(`/api/leads/${state.lead.id}/photos`, { method: 'POST', body, token: state.lead.token });
}
async function addPhotos(files) {
  if (!state.lead) { message('Submit your project first to unlock photo uploads and your studio.'); return; }
  if (sameStudioAccess(state.mediaLoadAccess, state.lead)) { message('Your saved photos are loading. Please wait a moment before adding another.'); return; }
  if (state.busy) { message('Please wait for your current request to finish before adding photos.'); return; }
  state.busy = true; message();
  try {
    for (const file of files) {
      if (state.photos.length >= MAX_PHOTOS) { message('You can add up to 3 photos for this project.'); break; }
      const error = validatePhoto(file); if (error) { message(error); continue; }
      const url = objectUrl(file);
      try {
        const image = new Image(); image.src = url; await image.decode();
        if (image.width * image.height > 50000000) throw new Error('That photo is very large. Please choose a smaller version.');
        const photo = { file, url, remote: null }; state.photos.push(photo); studioPhotos();
        $('#render-status').textContent = 'Saving your project photo…';
        try { await uploadPhoto(photo); } catch { message('Your project is saved, but a photo could not upload. Keep this page open and retry your visualization to upload it again.'); }
        studioPhotos();
      } catch (e) { release(url); message(e.message.includes('very large') ? e.message : 'That file could not be opened as a photo. Please try another JPG, PNG, or WebP.'); }
    }
  } finally { state.busy = false; $('#render-status').textContent = ''; }
}
function validateDetails() {
  for (const field of $$('[data-step="1"] input,[data-step="1"] select,[data-step="1"] textarea')) {
    if (!field.checkValidity()) { field.reportValidity(); field.focus(); return false; }
  }
  return true;
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || state.step !== 1 || !validateDetails()) return;
  if (!state.ready) { message(apiBase ? 'The project connection is not ready. Your information has not been submitted. Please ask the booth team for help.' : 'This is a design preview. Live lead capture has not been connected. Your information has not been submitted.'); return; }
  const submitters = [$('#submit-lead'), $('#submit-and-schedule')];
  const active = event.submitter || $('#submit-lead');
  state.busy = true; submitters.forEach(b => { b.disabled = true; }); setBusy(active, true, 'Saving your project…'); message();
  try {
    const payload = Object.fromEntries(new FormData(form));
    payload.contactConsent = form.elements.contactConsent.checked; payload.event = config.event || 'Home Show';
    payload.consultationPreference = event.submitter?.dataset.intent || 'contact_me';
    const saved = readSession(); let pending = saved?.apiBase === apiBase ? saved.pendingLead : null;
    if (pending && JSON.stringify(pending.payload) !== JSON.stringify(payload)) throw new Error('A previous submission needs checking. Reload this page to recover the same request before changing its details.');
    if (!pending) pending = { key: crypto.randomUUID(), token: leadToken(), payload };
    saveSession({ apiBase, pendingLead: pending });
    const lead = await request('/api/leads', { method: 'POST', body: payload, headers: { 'Idempotency-Key': pending.key, 'X-Lead-Token': pending.token } });
    if (!lead.id || !lead.token) throw new Error('We could not confirm your saved project. Please ask the team to check before submitting again.');
    state.lead = lead; state.remaining = lead.remainingRenders; state.consultationPreference = payload.consultationPreference;
    saveSession({ lead, pendingLead: null, consultationPreference: state.consultationPreference });
    $('#remaining-renders').textContent = String(state.remaining);
    $('#surface').value = payload.service === 'Kitchen cabinets' ? 'Cabinets' : payload.service === 'Doors and windows' ? 'Front door' : 'Exterior siding';
    renderConfirmation(); updateRenderAvailability(); setStep(2);
  } catch (error) {
    if (error.status === 400 || error.status === 422) saveSession({ pendingLead: null });
    message(error.name === 'TimeoutError' ? 'The connection timed out. Reload this page to recover the same request; your allowance stays with your saved project.' : error.message);
  } finally { state.busy = false; setBusy(active, false); submitters.forEach(b => { b.disabled = false; }); }
});
$('#to-details').addEventListener('click', () => {
  if (!form.querySelector('[name=service]:checked')) { message('Choose the type of project you’re considering.'); form.querySelector('[name=service]').focus(); return; }
  setStep(1);
});
$('#back-project').addEventListener('click', () => setStep(0));
$('#request-consultation').addEventListener('click', async () => {
  if (!state.lead || state.busy) return;
  const button = $('#request-consultation'); state.busy = true; setBusy(button, true, 'Saving your request…'); message();
  try {
    await request(`/api/leads/${state.lead.id}/consultation`, { method: 'POST', body: { consultationPreference: 'schedule_now' }, token: state.lead.token });
    state.consultationPreference = 'schedule_now'; saveSession({ consultationPreference: state.consultationPreference }); renderConfirmation();
    if (calendarUrl) $('#booking-link').focus();
  } catch (e) { message(e.message); } finally { state.busy = false; setBusy(button, false); }
});
$('#copy-studio-link').addEventListener('click', async () => {
  if (!state.lead) return;
  const input = $('#studio-access-link');
  try { await navigator.clipboard.writeText(input.value); $('#access-status').textContent = 'Private link copied. Save it somewhere you can find after the show.'; }
  catch { input.hidden = false; input.focus(); input.select(); $('#access-status').textContent = 'Copy this private link and save it for later.'; }
});
$('#open-studio').addEventListener('click', async () => { if (state.lead && !state.busy) { updateRenderAvailability(); setStep(3); await loadSavedStudioMedia(); } });
$('#back-next-steps').addEventListener('click', () => { if (state.lead) { renderConfirmation(); setStep(2); } });
$('#reset-session').addEventListener('click', () => {
  if (state.busy) { message('Please wait for your current request to finish before clearing this device.'); return; }
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Clear the in-memory state regardless. */ }
  for (const url of state.urls) release(url);
  form.reset(); state.photos = []; state.lead = null; state.pendingRender = null; state.completedRender = null;
  state.savedMedia = null; state.mediaLoadAccess = null; state.loadedMediaFor = null;
  state.consultationPreference = 'contact_me'; state.remaining = config.freeRenders ?? 3; state.shownResults.clear();
  $('#render-results').replaceChildren(); $('#retry-image').hidden = true; $('#render-status').textContent = '';
  $('#access-status').textContent = ''; $('#studio-access-link').value = ''; $('#studio-access-link').hidden = true;
  studioPhotos(); setStep(0);
});
$('#photos').addEventListener('change', async e => { await addPhotos(e.target.files); e.target.value = ''; });
const drop = $('#upload-zone');
for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('dragover'); });
for (const type of ['dragleave', 'drop']) drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove('dragover'); });
drop.addEventListener('drop', e => addPhotos(e.dataTransfer.files));
if ('contacts' in navigator && 'ContactsManager' in window) {
  const button = $('#share-contact'); button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      const available = await navigator.contacts.getProperties();
      const contacts = await navigator.contacts.select(['name', 'email', 'tel', 'address'].filter(p => available.includes(p)), { multiple: false });
      if (!contacts.length) return;
      for (const [name, value] of Object.entries(contactValues(contacts[0]))) {
        const field = form.elements.namedItem(name);
        if (field && value) field.value = name === 'state' ? ({ 'NORTH CAROLINA': 'NC', 'SOUTH CAROLINA': 'SC' }[value.toUpperCase()] || value.toUpperCase()) : value;
      }
      message('Contact details added. Please check them and use the project’s address.');
    } catch (e) { if (e.name !== 'AbortError') message('Saved contact sharing isn’t available here. Use your keyboard’s autofill or enter your details below.'); }
  });
}
function colorOptions() {
  const area = $('#color-options'); area.replaceChildren();
  COLORS.forEach((color, i) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'color-choice';
    button.setAttribute('aria-pressed', String(state.color === i)); button.style.setProperty('--swatch', color.hex);
    const swatch = document.createElement('span'); swatch.setAttribute('aria-hidden', 'true');
    button.append(swatch, document.createTextNode(color.name)); button.addEventListener('click', () => { state.color = i; colorOptions(); }); area.append(button);
  });
}
async function fetchPrivateImage(path) {
  const access = { id: state.lead.id, token: state.lead.token };
  const url = privateMediaUrl(path, apiBase, location.origin);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${access.token}` }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Your image could not be downloaded. Use your private studio link to return and retrieve it later.');
  const blob = await response.blob(); if (!blob.type.startsWith('image/')) throw new Error('The image could not be displayed. Please ask the team for help.');
  if (!sameStudioAccess(state.lead, access)) throw new Error('This studio session has been cleared.');
  return objectUrl(blob);
}
async function showRender(result, color) {
  if (state.shownResults.has(result.id)) return;
  const url = await fetchPrivateImage(result.imageUrl);
  const figure = document.createElement('figure'); figure.className = 'render-result';
  const image = document.createElement('img'); image.src = url; image.alt = `AI color visualization in ${color.name}`;
  const caption = document.createElement('figcaption'), label = document.createElement('span'), download = document.createElement('a');
  label.textContent = `${color.name} · AI visualization`; download.href = url;
  download.download = `spray-net-${color.name.toLowerCase().replaceAll(' ', '-')}.jpg`; download.textContent = 'Save image ↓';
  caption.append(label, download); figure.append(image, caption); $('#render-results').prepend(figure); state.shownResults.add(result.id);
}
$('#render-button').addEventListener('click', async () => {
  if (state.busy) return; message();
  if (!state.lead) { message('Submit your project first to unlock your studio.'); return; }
  if (sameStudioAccess(state.mediaLoadAccess, state.lead)) { message('Your saved studio is loading. Please wait a moment before starting a visualization.'); return; }
  if (!state.pendingRender && !state.photos.length) { message('Add a photo of your home or cabinets to create a visualization.'); return; }
  if (!state.pendingRender && state.remaining <= 0) { message('You’ve used your free visualizations. Our team can help you explore your next ideas.'); return; }
  const button = $('#render-button'), status = $('#render-status'); state.busy = true; setBusy(button, true, 'Creating your new look…');
  try {
    if (!state.pendingRender) {
      const photo = state.photos[state.selectedPhoto], color = COLORS[state.color];
      if (!photo.remote) { status.textContent = 'Securely uploading your selected photo…'; await uploadPhoto(photo); studioPhotos(); }
      state.pendingRender = { key: crypto.randomUUID(), body: { photoId: photo.remote.id, colorName: color.name, colorHex: color.hex, surface: $('#surface').value }, color };
      saveSession({ pendingRender: state.pendingRender });
    }
    const pending = state.pendingRender;
    status.textContent = 'Creating your visualization. This can take a couple of minutes. Keep this page open.';
    let result = await request(`/api/leads/${state.lead.id}/renders`, { method: 'POST', body: pending.body, token: state.lead.token, headers: { 'Idempotency-Key': pending.key }, timeout: 240000 });
    for (let n = 0; n < 30 && result.status === 'pending'; n++) {
      status.textContent = 'Your image is still processing. Checking its progress…';
      await new Promise(resolve => setTimeout(resolve, 2500));
      result = await request(`/api/leads/${state.lead.id}/renders/${result.id}`, { token: state.lead.token });
    }
    if (Number.isInteger(result.remainingRenders)) { state.remaining = result.remainingRenders; $('#remaining-renders').textContent = String(state.remaining); }
    if (result.status === 'pending') throw new Error('This visualization is still processing. Use the render button again to check the same request.');
    state.pendingRender = null; saveSession({ pendingRender: null });
    if (result.status === 'failed') throw new Error(result.error?.message || 'The visualization did not finish. Your credit has been restored.');
    state.completedRender = { result, color: pending.color }; saveSession({ completedRender: state.completedRender }); $('#retry-image').hidden = false;
    await showRender(result, pending.color); state.completedRender = null; saveSession({ completedRender: null }); $('#retry-image').hidden = true;
    status.textContent = 'Your new look is ready. Save the image or try another color.';
  } catch (e) { status.textContent = ''; message(e.name === 'TimeoutError' ? 'The connection timed out. Retry to check the same request without creating a second one.' : e.message); }
  finally { state.busy = false; setBusy(button, false); updateRenderAvailability(); }
});
$('#retry-image').addEventListener('click', async () => {
  if (state.busy || !state.lead || !state.completedRender) return;
  state.busy = true; const button = $('#retry-image'); setBusy(button, true, 'Retrieving your image…');
  try { await showRender(state.completedRender.result, state.completedRender.color); state.completedRender = null; saveSession({ completedRender: null }); $('#retry-image').hidden = true; message(); }
  catch (e) { message(e.message); }
  finally { state.busy = false; setBusy(button, false); }
});
$$('[data-location]').forEach(el => { el.textContent = config.location || 'South Charlotte'; });
$$('[data-render-count]').forEach(el => { el.textContent = String(state.remaining); });
if (safeLink(config.portfolioUrl)) $('#portfolio-link').href = config.portfolioUrl;
if (safeLink(config.privacyUrl)) {
  const a = document.createElement('a'); a.href = config.privacyUrl; a.textContent = 'Read the full privacy policy'; a.target = '_blank'; a.rel = 'noopener noreferrer'; $('#privacy-extra').append(a);
}
if (calendarUrl) { $('#submit-and-schedule').innerHTML = 'Submit & schedule a quote <span aria-hidden="true">→</span>'; $('#scheduling-summary').textContent = 'Request follow-up or choose a time'; }
const range = $('#comparison-range');
range.addEventListener('input', () => { $('#before-layer').style.clipPath = `inset(0 ${100 - Number(range.value)}% 0 0)`; $('#comparison-divider').style.left = `${Number(range.value)}%`; });
const privacy = $('#privacy-dialog');
for (const selector of ['#privacy-button', '#footer-privacy']) $(selector).addEventListener('click', () => privacy.showModal());
for (const selector of ['#close-privacy', '#privacy-done']) $(selector).addEventListener('click', () => privacy.close());
privacy.addEventListener('click', e => { if (e.target === privacy) { const r = privacy.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) privacy.close(); } });
window.addEventListener('beforeunload', () => { for (const url of state.urls) URL.revokeObjectURL(url); });
colorOptions(); connect();

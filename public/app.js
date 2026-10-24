import { COLORS, MAX_PHOTOS, validatePhoto, safeApiBase, privateMediaUrl } from './lib.js';
import { parseStudioAccess, sameStudioAccess } from './access.js';
import { renderQr } from './qr.js';
import { createCalendarFile } from './calendar.js';
import { attachAddressAutocomplete } from './address-autocomplete.js';
import { requestAddressSuggestions } from './address-client.js';
import { createVisitRecorder } from './visits.js';
import { VISUALIZER_SURFACES, selectedSurfaces, visitorAppointment } from './project-options.js';
import { createVisitorStorage } from './visitor-storage.js';
import { resetTabletSession } from './kiosk.js';
import { setupTabletApp } from './pwa.js';
import { createRenderPreview } from './render-preview.js';
import { tabletHandoff } from './tablet-handoff.js';
import { renderBalance } from './render-balance.js';
import { createStudioLayout } from './studio-layout.js';
import { setBusy } from './ui-feedback.js';
const config = window.SPRAYNET_CONFIG || {};
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const form = $('#lead-form'), mode = new URLSearchParams(location.search).get('mode') === 'tablet' ? 'tablet' : 'mobile';
document.body.dataset.mode = mode;
setupTabletApp({mode,button:$('#install-app'),dialog:$('#install-dialog'),install:$('#install-native'),fullscreen:$('#install-fullscreen'),close:$('#close-install'),status:$('#install-status')});
const studioLayout=createStudioLayout({mode,studio:$('#studio'),results:$('#render-results'),resultHome:$('#studio-result-home'),sidebar:$('#tablet-studio-media'),resultDock:$('#tablet-render-dock'),qr:$('.public-qr-card'),qrHome:$('.booth-intro'),qrDock:$('#studio-qr-dock')});
let tabStorage,persistentStorage;try{tabStorage=sessionStorage;persistentStorage=localStorage;}catch{}
const visitorStorage=createVisitorStorage(mode,tabStorage,persistentStorage);
const incoming = parseStudioAccess(location.hash);
if (location.hash.startsWith('#studio=')) history.replaceState(null, '', location.pathname + location.search);
const state = { lead: null, session: null, ready: false, renderAvailable: false, busy: false, remaining: null,
  photos: [], selectedPhoto: 0, color: 0, urls: new Set(), shownResults: new Map(), slots: [], day: '', selectedSlot: '',
  pendingLead: null, pendingBooking: null, pendingRender: null, completedRender: null, savedMedia: null, loadedMediaFor: null, mediaLoadAccess: null };
let apiBase = '';
const lookupAddress = (query,options) => requestAddressSuggestions(apiBase,query,options);
const leadAddress = attachAddressAutocomplete($('#lead-address'),{lookup:lookupAddress});
const bookingAddress = attachAddressAutocomplete($('#booking-address'),{lookup:lookupAddress});
const visits = createVisitRecorder((access,body,signal) => request(`/api/leads/${access.id}/visits`,{method:'POST',token:access.token,body,signal}));
function readSession() {return visitorStorage.read();}
function saveSession(extra = {}) {visitorStorage.save({apiBase,...extra});}
function leadToken() { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
function message(text = '') { const el = $('#form-alert'); el.textContent = text; el.hidden = !text; }
function objectUrl(blob) { const url = URL.createObjectURL(blob); state.urls.add(url); return url; }
function release(url) { URL.revokeObjectURL(url); state.urls.delete(url); }
function unlocked() { return state.session?.visualizerUnlocked === true && state.session?.booking?.status === 'confirmed'; }
const renderPreview=createRenderPreview($('#render-preview'),{isActive:()=>unlocked(),onEdit:()=>$('.colors-fieldset').scrollIntoView({block:'start',behavior:'smooth'})});
async function request(path, { method = 'GET', body, token, headers = {}, timeout = 30000, signal } = {}) {
  if (!apiBase) throw new Error('Live submissions are unavailable. Please speak with our booth team.');
  const options = { method, headers: { ...headers }, signal: signal || AbortSignal.timeout(timeout) };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  const response = await fetch(apiBase + path, options);
  let data; try { data = await response.json(); } catch { throw new Error('The connection returned an unreadable response. Please try again.'); }
  if (!response.ok) { const e = new Error(data.error?.message || 'We could not complete that request. Please try again.'); e.code = data.error?.code; e.status = response.status; throw e; }
  return data;
}
$('.brand').href = `${location.pathname}?mode=${mode}`;
function updateTabletHandoff() {
  if(mode!=='tablet')return;
  const qr=$('#public-mobile-qr');qr.replaceChildren();
  try{const handoff=tabletHandoff(location.href,state.lead);
    $('#tablet-qr-title').textContent=handoff.title;$('#tablet-qr-description').textContent=handoff.description;
    renderQr(qr,handoff.url,{label:handoff.label});
  }catch{$('#tablet-qr-title').textContent='Project QR unavailable';$('#tablet-qr-description').textContent='Ask our team to reopen this project on the published website.';}
}
updateTabletHandoff();
function updateRenderAvailability() {
  const balance=Number.isInteger(state.remaining)?String(state.remaining):'Checking…';
  $('#remaining-renders').textContent=balance;$$('[data-remaining-renders]').forEach(element=>{element.textContent=balance;});
  $('#create-render').disabled = state.busy || !unlocked() || !state.renderAvailable || !Number.isInteger(state.remaining) || (state.remaining <= 0 && !state.pendingRender);
  $('#photos').disabled = state.busy || !unlocked();
  $('#studio-status').textContent = state.renderAvailable ? 'Your project is saved. Explore a color idea whenever you are ready.' : 'Your consultation is confirmed. Image generation is unavailable right now.';
}
function showSaved({ focus = false } = {}) {
  renderPreview.clear();
  updateTabletHandoff();
  void visits.record(state.lead);
  $('#lead-panel').hidden = true; $('#page-intro').hidden = true; $('#saved-panel').hidden = false; $('#studio').hidden = true;
  studioLayout.sync();
  const name=String(state.session?.lead?.firstName || state.session?.lead?.name || '').trim().split(/\s+/)[0];
  $('#saved-title').textContent=name?`Thanks, ${name}, you’re on our list.`:'Thanks, you’re on our list.';
  const confirmed = unlocked(); $('#confirmed-panel').hidden = !confirmed; $('#booking-invitation').hidden = confirmed;
  const calendar = $('#download-appointment'); calendar.hidden = true;
  if (calendar.dataset.objectUrl) { release(calendar.dataset.objectUrl); delete calendar.dataset.objectUrl; calendar.removeAttribute('href'); }
  if (confirmed) {
    state.pendingBooking = null; saveSession({pendingBooking:null});
    const visit=visitorAppointment(state.session.booking);
    $('#booking-panel').hidden = true; $('#confirmed-time').textContent = formatAppointment(visit.start, visit.end);
    $('#confirmed-address').textContent = state.session.lead?.address || '';
    if (mode === 'mobile') try { const text = createCalendarFile({id:state.lead.id,...visit,address:state.session.lead?.address || ''});
      const url = objectUrl(new Blob([text],{type:'text/calendar;charset=utf-8'})); calendar.href = url; calendar.dataset.objectUrl = url; calendar.hidden = false;
    } catch {}
  }
  const lead = state.session?.lead;
  if (lead && !$('#booking-panel').contains(document.activeElement)) {
    $('#booking-address').value = lead.address || ''; bookingAddress.adopt({display:lead.address || '',street:lead.address || '',city:lead.city || '',state:lead.state || '',zip:lead.zip || ''});
    $('#booking-email').value = lead.email || '';
  }
  if (focus) $('#saved-title').focus({ preventScroll: true });
  updateRenderAvailability();
}
const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const dayKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
function formatAppointment(start, end) { return start && end ? `${dateFormat.format(new Date(start))} · ${timeFormat.format(new Date(start))}–${timeFormat.format(new Date(end))} Eastern Time` : ''; }
async function refreshSession() {
  const access = state.lead; if (!access) return;
  const session = await request(`/api/leads/${access.id}/session`, { token: access.token });
  if (!sameStudioAccess(access, state.lead)) return;
  const remaining=renderBalance(session);state.session = session; state.remaining = remaining;
  state.savedMedia = { photos: session.photos || [], renders: session.renders || [] };
}
async function restoreSession() {
  const saved = readSession(); let matching = saved?.apiBase === apiBase ? saved : null;
  if (incoming && !sameStudioAccess(incoming, matching?.lead)) matching = null;
  state.pendingLead = matching?.pendingLead || null; state.pendingBooking = matching?.pendingBooking || null;
  if (!matching && incoming) visitorStorage.clear();
  if (incoming) state.lead = incoming;
  else if (matching?.pendingLead) {
    const p = matching.pendingLead;
    try { state.lead = await request('/api/leads', { method: 'POST', body: p.payload, headers: { 'Idempotency-Key': p.key, 'X-Lead-Token': p.token } }); }
    catch (e) { if ([400,422].includes(e.status) || e.code === 'ALREADY_REGISTERED') {state.pendingLead = null;saveSession({pendingLead:null});} throw e; }
  } else state.lead = matching?.lead || null;
  if (!state.lead) return;
  state.pendingLead = null; saveSession({ lead: state.lead, pendingLead: null });
  try {await refreshSession();}
  catch(error) {
    if(error.status!==401)throw error;
    // Deleted or revoked saved access must not trap a test device on a dead
    // project. Network failures still retain the session for safe recovery.
    visits.reset();state.lead=null;state.session=null;state.pendingLead=null;state.pendingBooking=null;
    state.pendingRender=null;state.completedRender=null;
    visitorStorage.clear();
    message('This saved project is no longer available. You can submit a new request below.');return;
  }
  state.pendingRender = matching?.pendingRender || null; state.completedRender = matching?.completedRender || null;
  showSaved();
  if (state.session.booking?.status === 'pending') $('#booking-status').textContent = 'Your appointment is still being verified. Reopen scheduling to check the same request.';
}
async function connect() {
  state.busy = true; $('#submit-lead').disabled = true;
  try {
    apiBase = safeApiBase(config.apiBase, location.origin);
    if (incoming && apiBase) {
      const previous = readSession();
      if (previous?.apiBase !== apiBase || !sameStudioAccess(previous?.lead,incoming)) visitorStorage.clear();
      saveSession({lead:incoming,pendingLead:null});
    }
    const health = apiBase ? await request('/api/health') : null;
    state.ready = health?.ready === true; state.renderAvailable = health?.renderAvailable === true;
    const availability = $('#visualizer-availability'); if (availability) availability.hidden = state.renderAvailable;
    const allowance=health?.freeRenders ?? config.freeRenders ?? 5;
    $$('[data-free-renders]').forEach(e => { e.textContent = String(allowance); });
    $('#connection-status').textContent = state.ready ? 'Connected securely · South Charlotte' : 'Live submissions are unavailable. Please speak with our booth team.';
    $('#connection-status').classList.toggle('live', state.ready);
    if (state.ready) try { await restoreSession(); } catch {
      if (state.lead) { $('#lead-panel').hidden = true; $('#page-intro').hidden = true; }
      message('We could not reopen your saved project. Reload to try again, or ask our team for help before submitting another lead.');
    }
  } catch { state.ready = false; $('#connection-status').textContent = 'Connection unavailable. Your information has not been submitted. Please speak with our booth team.'; }
  finally { state.busy = false; $('#submit-lead').disabled = !state.ready || Boolean(state.lead); }
}
function validForm(target) { for (const field of target.querySelectorAll('input')) if (!field.checkValidity()) { field.reportValidity(); return false; } return true; }
form.addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy || state.lead || !validForm(form)) return;
  if (!state.ready) { message('The form is not connected. Nothing has been submitted. Please speak with our booth team.'); return; }
  if (!$('#lead-name').value.trim()) { $('#lead-name').focus(); message('Please enter your name.'); return; }
  if ($('#lead-phone').value.replace(/\D/g, '').length < 10) { $('#lead-phone').focus(); message('Please enter a complete phone number.'); return; }
  state.busy = true; const button = $('#submit-lead'); setBusy(button, true, 'Saving your details…'); message();
  try {
    const payload = {...Object.fromEntries(new FormData(form)),...leadAddress.parts()}; payload.contactConsent = true; payload.event = config.event || 'Home Show'; payload.captureMode = mode;
    const saved = readSession(); let pending = state.pendingLead || (saved?.apiBase === apiBase ? saved.pendingLead : null);
    if (pending && JSON.stringify(pending.payload) !== JSON.stringify(payload)) throw new Error('Your previous submission needs checking. Reload to recover it before changing details.');
    if (!pending) pending = { key: crypto.randomUUID(), token: leadToken(), payload };
    state.pendingLead = pending; saveSession({ pendingLead: pending });
    const lead = await request('/api/leads', { method: 'POST', body: pending.payload, headers: { 'Idempotency-Key': pending.key, 'X-Lead-Token': pending.token } });
    if (!sameStudioAccess(lead, lead)) throw new Error('We could not confirm your saved details. Reload to check this request.');
    state.lead = lead; state.pendingLead = null; state.remaining = renderBalance(lead); saveSession({ lead, pendingLead: null });
    state.session = { lead: { ...payload }, booking: { status: 'none' }, visualizerUnlocked: false };
    showSaved({ focus: true });
  } catch (e) { if ([400,422].includes(e.status) || e.code === 'ALREADY_REGISTERED') { state.pendingLead = null; saveSession({ pendingLead: null }); } message(e.name === 'TimeoutError' ? 'The connection timed out. Submit again to check this same request.' : e.message); }
  finally { state.busy = false; setBusy(button, false); }
});
function renderSlots() {
  const days = [...new Set(state.slots.map(s => dayKey(s.start)))];
  if (!days.includes(state.day)) state.day = days[0] || '';
  $('#slot-days').replaceChildren(); $('#slot-times').replaceChildren();
  for (const day of days) {
    const slot = state.slots.find(s => dayKey(s.start) === day), date = new Date(slot.start), button = document.createElement('button');
    button.type = 'button'; button.className = 'slot-day'; button.setAttribute('aria-pressed', String(day === state.day));
    button.textContent = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', weekday:'short', month:'short', day:'numeric' }).format(date);
    button.addEventListener('click', () => { state.day = day; state.selectedSlot = ''; renderSlots(); }); $('#slot-days').append(button);
  }
  for (const slot of state.slots.filter(s => dayKey(s.start) === state.day)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'slot-time'; button.textContent = timeFormat.format(new Date(slot.start));
    button.setAttribute('aria-pressed', String(state.selectedSlot === slot.start));
    button.addEventListener('click', () => { state.selectedSlot = slot.start; renderSlots(); }); $('#slot-times').append(button);
  }
  const slot = state.slots.find(s => s.start === state.selectedSlot);
  const visit=slot?visitorAppointment(slot):null;
  $('#selected-time').textContent = visit ? formatAppointment(visit.start, visit.end) : 'Choose a time above.';
  $('#confirm-booking').disabled = !slot;
}
async function loadSlots() {
  if (state.busy || !state.lead) return;
  $('#booking-panel').hidden = false; $('#booking-invitation').hidden=true; $('#booking-title').focus({ preventScroll: true }); state.busy = true;
  if (mode === 'tablet') window.scrollTo({top:0,behavior:'instant'});
  $('#booking-status').textContent = 'Checking available consultation times…'; $('#slot-picker').hidden = true; $('#booking-form').hidden = true; message();
  try {
    await refreshSession(); if (unlocked()) { showSaved(); return; }
    const pending = state.pendingBooking;
    if (pending) {
      $('#booking-status').textContent = 'Checking your previous appointment request…';
      await finishBooking(pending); return;
    }
    if (state.session?.consultationPreference !== 'schedule_now') {
      await request(`/api/leads/${state.lead.id}/consultation`,{method:'POST',token:state.lead.token,body:{consultationPreference:'schedule_now'}});
      state.session.consultationPreference = 'schedule_now';
    }
    const data = await request(`/api/leads/${state.lead.id}/consultation/slots`, { token: state.lead.token });
    state.slots = data.slots || []; state.selectedSlot = ''; renderSlots();
    $('#booking-status').textContent = state.slots.length ? '' : 'No online times are available right now. Your details are saved; our team can help find a time.';
    $('#slot-picker').hidden = !state.slots.length; $('#booking-form').hidden = !state.slots.length;
  } catch (e) {
    if (clearRejectedBooking(e)) $('#booking-status').textContent = `${e.message} Use Refresh to choose another time.`;
    else $('#booking-status').textContent = e.message;
  }
  finally { state.busy = false; }
}
async function finishBooking(pending) {
  $('#booking-address').value = pending.body.address;
  bookingAddress.adopt({display:pending.body.address,street:pending.body.address,city:pending.body.city || '',state:pending.body.state || '',zip:pending.body.zip || ''}); $('#booking-email').value = pending.body.email || '';
  $('#selected-time').textContent = `Checking the same request: ${dateFormat.format(new Date(pending.body.start))}, ${timeFormat.format(new Date(pending.body.start))} Eastern Time.`;
  const data = await request(`/api/leads/${state.lead.id}/consultation/book`, { method:'POST', token:state.lead.token, body:pending.body, headers:{'Idempotency-Key':pending.key}, timeout:60000 });
  if (data.visualizerUnlocked !== true || data.booking?.status !== 'confirmed') { $('#booking-status').textContent = 'We are still verifying this appointment. Your visualizer stays locked. Use Refresh to check this same request.'; return; }
  state.pendingBooking = null; saveSession({ pendingBooking: null }); await refreshSession(); showSaved(); $('#confirmed-title').focus({ preventScroll:true });
}
function clearRejectedBooking(error) {
  if (!['INVALID_ADDRESS','INVALID_EMAIL','INVALID_SLOT','SLOT_UNAVAILABLE','BOOKING_NOT_CREATED','BOOKING_CANCELLED','ALREADY_BOOKED'].includes(error.code)) return false;
  state.pendingBooking = null; saveSession({ pendingBooking:null }); return true;
}
$('#show-booking').addEventListener('click', loadSlots); $('#refresh-slots').addEventListener('click', loadSlots);
$('#booking-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy || !state.lead || !validForm(event.target) || !state.selectedSlot) return;
  if (!$('#booking-address').value.trim()) { $('#booking-address').focus(); return; }
  state.busy = true; const button = $('#confirm-booking'); setBusy(button, true, 'Reserving your consultation…'); message();
  try {
    const pending = state.pendingBooking || { key:crypto.randomUUID(), body:{ start:state.selectedSlot, address:$('#booking-address').value.trim(), email:$('#booking-email').value.trim(),...bookingAddress.parts() } };
    state.pendingBooking = pending; saveSession({ pendingBooking:pending }); $('#slot-picker').hidden = true; $('#booking-form').hidden = true; await finishBooking(pending);
  } catch (e) {
    clearRejectedBooking(e);
    $('#booking-status').textContent = e.name === 'TimeoutError' ? 'We could not finish checking the appointment. Use Refresh to retry the same booking.' : e.message;
  } finally { state.busy = false; setBusy(button,false); }
});
function resetVisitor() {
  if (mode !== 'tablet') return;
  if (state.busy) { message('Please wait for the current request to finish before clearing this tablet.'); return; }
  resetTabletSession({mode,url:location.href,history,body:document.body,storage:visitorStorage,reset:clearTabletForm});
}
function clearTabletForm() {
  renderPreview.clear();
  visits.reset();
  for (const url of [...state.urls]) release(url);
  Object.assign(state, { lead:null, session:null, remaining:null, photos:[], selectedPhoto:0, pendingLead:null, pendingBooking:null, pendingRender:null, completedRender:null, savedMedia:null, loadedMediaFor:null, mediaLoadAccess:null, slots:[], day:'', selectedSlot:'' });
  updateTabletHandoff();updateRenderAvailability();
  state.shownResults.clear(); form.reset(); $('#booking-form').reset();
  leadAddress.clear();bookingAddress.clear();
  for (const id of ['#render-results','#studio-photos','#slot-days','#slot-times']) $(id).replaceChildren();
  for (const id of ['#booking-status','#render-status','#selected-time','#confirmed-time','#confirmed-address']) $(id).textContent = '';
  surfaceOptions();
  $('#retry-image').hidden = true;
  $('#download-appointment').removeAttribute('href'); delete $('#download-appointment').dataset.objectUrl; $('#download-appointment').hidden = true;
  $('#lead-panel').hidden = false; $('#page-intro').hidden = true; $('#saved-panel').hidden = true; $('#studio').hidden = true; $('#booking-panel').hidden = true;
  studioLayout.sync();
  $('#submit-lead').disabled = !state.ready; message(); $('#lead-name').focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'});
}
$('#header-reset').hidden = mode !== 'tablet';
$('#header-reset').disabled = mode !== 'tablet';
if (mode === 'tablet') $('#header-reset').addEventListener('click', resetVisitor);
function studioPhotos() {
  const area = $('#studio-photos'); area.replaceChildren(); if (state.selectedPhoto >= state.photos.length) state.selectedPhoto = 0;
  state.photos.forEach((photo,i) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'studio-photo-option'; button.setAttribute('aria-label', `Use project photo ${i+1}`); button.setAttribute('aria-pressed', String(i === state.selectedPhoto));
    const img = document.createElement('img'); img.src = photo.url; img.alt = `Project photo ${i+1}`;
    const label = document.createElement('small'); label.textContent = photo.remote ? 'Uploaded' : 'Upload pending'; button.append(img,label);
    button.addEventListener('click', () => { state.selectedPhoto = i; studioPhotos(); }); area.append(button);
  });
}
function colorOptions() {
  $('#color-options').replaceChildren(); COLORS.forEach((color,i) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'color-choice'; button.setAttribute('aria-pressed',String(i === state.color)); button.style.setProperty('--swatch',color.hex);
    const swatch = document.createElement('span'); swatch.setAttribute('aria-hidden','true'); button.append(swatch,document.createTextNode(color.name));
    button.addEventListener('click', () => { state.color = i; colorOptions(); }); $('#color-options').append(button);
  });
}
function surfaceOptions() {
  const area=$('#surface-options');area.replaceChildren();
  for(const [index,surface] of VISUALIZER_SURFACES.entries()) {
    const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
    input.type='checkbox';input.name='surfaces';input.value=surface;input.checked=index===0;text.textContent=surface;
    label.append(input,text);area.append(label);
  }
}
async function fetchPrivateImage(path) {
  const access = state.lead; const url = privateMediaUrl(path,apiBase,location.origin);
  const response = await fetch(url, { headers:{Authorization:`Bearer ${access.token}`}, signal:AbortSignal.timeout(30000) });
  if (!response.ok) { const e = new Error('Your image could not be downloaded. Please reopen your project to check consultation access.'); e.status = response.status; throw e; }
  const blob = await response.blob(); if (!blob.type.startsWith('image/')) throw new Error('This image could not be displayed.');
  if (!sameStudioAccess(access,state.lead)) throw new Error('This project has been cleared.'); return objectUrl(blob);
}
function presentRender(view) {
  view.figure.scrollIntoView({block:'start',behavior:'instant'});view.figure.focus({preventScroll:true});renderPreview.show(view);
}
async function showRender(result,color,{present=false}={}) {
  if (state.shownResults.has(result.id)) {if(present)presentRender(state.shownResults.get(result.id));return;}
  const access = state.lead, url = await fetchPrivateImage(result.imageUrl);
  if (!sameStudioAccess(access,state.lead)) { release(url); return; }
  const figure = document.createElement('figure'); figure.className = 'render-result';figure.tabIndex=-1;
  const label=`${color.name} · AI visualization`,filename=`spray-net-visualization-${String(result.id).replace(/[^a-z0-9-]/gi,'').slice(0,36)}.jpg`;
  const img = document.createElement('img'); img.src = url; img.alt = label;
  try{await img.decode();}catch{release(url);throw new Error('Your visualization was saved, but the picture could not load. Use Retrieve my completed image to try again.');}
  if(!sameStudioAccess(access,state.lead)){release(url);return;}
  const caption = document.createElement('figcaption'), text = document.createElement('span'), download = document.createElement('a'),larger=document.createElement('button');
  text.textContent=label;download.href=url;download.download=filename;download.textContent='Save image ↓';
  larger.type='button';larger.className='render-view-button';larger.textContent='View larger';
  const view={figure,url,label,filename};larger.addEventListener('click',()=>{if(sameStudioAccess(access,state.lead)&&unlocked())presentRender(view);});
  caption.append(text,larger,download);figure.append(img,caption);$('#render-results').prepend(figure);state.shownResults.set(result.id,view);
  if(present)presentRender(view);
}
async function loadSavedStudioMedia() {
  if (!unlocked() || !state.savedMedia || sameStudioAccess(state.loadedMediaFor,state.lead)) return;
  const access = state.lead, media = state.savedMedia; state.mediaLoadAccess = access;
  let failed = false;
  try {
    for (const photo of media.photos) {
      if (!sameStudioAccess(access,state.lead)) return;
      try { const url = await fetchPrivateImage(photo.url); if (!sameStudioAccess(access,state.lead)) {release(url);return;}
        if (!state.photos.some(p => p.remote?.id === photo.id)) state.photos.push({file:null,url,remote:photo}); else release(url); studioPhotos();
      } catch (e) { failed = true; if (e.status === 401 || e.status === 403 || e.status === 503) throw e; }
    }
    for (const result of media.renders) if (result.status === 'completed') {
      if (!sameStudioAccess(access,state.lead)) return;
      try { await showRender(result,{name:result.colorName || 'Your color'}); } catch (e) { failed = true; if (e.status === 401 || e.status === 403 || e.status === 503) throw e; state.completedRender = {result,color:{name:result.colorName || 'Your color'}}; $('#retry-image').hidden = false; }
    }
    if (!failed && sameStudioAccess(access,state.lead)) state.loadedMediaFor = access;
  } finally { if (sameStudioAccess(access,state.mediaLoadAccess)) state.mediaLoadAccess = null; }
}
$('#open-studio').addEventListener('click', async () => {
  if (state.busy || !state.lead) return; state.busy = true; message();
  try { await refreshSession(); if (!unlocked()) {showSaved();throw new Error('Your consultation must be confirmed before visualizer access.');}
    $('#saved-panel').hidden = true; $('#studio').hidden = false;studioLayout.sync(); $('#studio-title').focus({preventScroll:true}); await loadSavedStudioMedia();
  } catch (e) { state.session = null; showSaved(); message(e.message); } finally {state.busy = false;updateRenderAvailability();}
});
$('#close-studio').addEventListener('click', () => { if (!state.busy) showSaved(); });
async function uploadPhoto(photo) {
  if (photo.remote) return; const body = new FormData(); body.append('photo',photo.file);
  photo.remote = await request(`/api/leads/${state.lead.id}/photos`,{method:'POST',body,token:state.lead.token});
}
async function handleStudioError(e) {
  if (e.code === 'BOOKING_REQUIRED' || e.status === 401 || e.status === 403 || (e.status === 503 && /^(?:BOOKING_|SERVICE_UNAVAILABLE)/.test(e.code || ''))) { state.session = null; try {await refreshSession();} catch {} showSaved(); }
  message(e.name === 'TimeoutError' ? 'The connection timed out. Retry to check the same request.' : e.message);
}
async function addPhotos(files) {
  if (!unlocked() || state.busy || state.mediaLoadAccess) return;
  state.busy = true; updateRenderAvailability(); message();
  try {
    for (const file of files) {
      if (state.photos.length >= MAX_PHOTOS) {message('You can add up to 3 photos to this project.');break;}
      const error = validatePhoto(file); if (error) {message(error);continue;}
      const url = objectUrl(file); let photo;
      try { const image = new Image(); image.src = url; await image.decode(); if (image.width*image.height > 50000000) throw new Error('Please choose a smaller photo.');
        photo = {file,url,remote:null}; state.photos.push(photo);state.selectedPhoto=state.photos.length-1; studioPhotos();$('#render-status').textContent='New photo selected.';
      } catch {release(url);message('That photo could not be opened. Please choose another JPG, PNG, or WebP.');continue;}
      try { await uploadPhoto(photo); studioPhotos(); } catch (e) { await handleStudioError(e); break; }
    }
  } finally {state.busy = false;updateRenderAvailability();}
}
$('#photos').addEventListener('change', async e => {await addPhotos(e.target.files);e.target.value = '';});
for (const type of ['dragenter','dragover']) $('#upload-zone').addEventListener(type,e => {e.preventDefault();$('#upload-zone').classList.add('dragover');});
for (const type of ['dragleave','drop']) $('#upload-zone').addEventListener(type,e => {e.preventDefault();$('#upload-zone').classList.remove('dragover');});
$('#upload-zone').addEventListener('drop',e => addPhotos(e.dataTransfer.files));
$('#create-render').addEventListener('click', async () => {
  if (state.busy || !unlocked() || !state.renderAvailable) return;
  if (!state.pendingRender && !state.photos.length) {message('Add a photo of your home or cabinets first.');return;}
  if (!state.pendingRender && state.remaining <= 0) {message('You’ve used your free visualizations. Our team can help explore more ideas.');return;}
  let surfaces;
  try {if(!state.pendingRender)surfaces=selectedSurfaces($$('#surface-options input:checked').map(input=>input.value));}
  catch(error){message(error.message);$('#surface-options input').focus();return;}
  state.busy = true; const button = $('#create-render'), status = $('#render-status'); setBusy(button,true,'Creating your new look…');status.classList.add('is-rendering');status.setAttribute('aria-busy','true');updateRenderAvailability();message();
  try {
    if (!state.pendingRender) {const photo = state.photos[state.selectedPhoto], color = COLORS[state.color]; await uploadPhoto(photo);studioPhotos();
      state.pendingRender = {key:crypto.randomUUID(),body:{photoId:photo.remote.id,colorName:color.name,colorHex:color.hex,surfaces},color}; saveSession({pendingRender:state.pendingRender});}
    const pending = state.pendingRender; status.textContent = 'Creating your visualization. This can take a couple of minutes. Keep this page open.';
    let result = await request(`/api/leads/${state.lead.id}/renders`,{method:'POST',body:pending.body,token:state.lead.token,headers:{'Idempotency-Key':pending.key},timeout:240000});
    for (let n=0;n<30 && result.status === 'pending';n++) {await new Promise(resolve => setTimeout(resolve,2500));result = await request(`/api/leads/${state.lead.id}/renders/${result.id}`,{token:state.lead.token});}
    state.remaining=renderBalance(result);
    if (result.status === 'pending') throw new Error('Your visualization is still processing. Use the button again to check this same request.');
    state.pendingRender = null;saveSession({pendingRender:null});
    if (result.status === 'failed') throw new Error(result.error?.message || 'The visualization did not finish. Your credit has been restored.');
    state.completedRender = {result,color:pending.color};saveSession({completedRender:state.completedRender});$('#retry-image').hidden = false;
    await showRender(result,pending.color,{present:true}); state.completedRender = null;saveSession({completedRender:null});$('#retry-image').hidden = true;status.textContent = 'Your new look is ready. Save the image or try another color.';
  } catch (e) { if ([400,404].includes(e.status)) {state.pendingRender = null;saveSession({pendingRender:null});} status.textContent = '';await handleStudioError(e);}
  finally {state.busy = false;setBusy(button,false);status.classList.remove('is-rendering');status.setAttribute('aria-busy','false');updateRenderAvailability();}
});
$('#retry-image').addEventListener('click', async () => {
  if (state.busy || !unlocked() || !state.completedRender) return; state.busy = true; const button = $('#retry-image');setBusy(button,true,'Retrieving image…');
  try {await showRender(state.completedRender.result,state.completedRender.color,{present:true});state.completedRender = null;saveSession({completedRender:null});button.hidden = true;message();}
  catch (e) {await handleStudioError(e);}finally {state.busy = false;setBusy(button,false);updateRenderAvailability();}
});
const privacy = $('#privacy-dialog');
for (const id of ['#privacy-button','#footer-privacy']) $(id).addEventListener('click',() => privacy.showModal());
for (const id of ['#close-privacy','#privacy-done']) $(id).addEventListener('click',() => privacy.close());
privacy.addEventListener('click',e => { if (e.target === privacy) {const r = privacy.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)privacy.close();} });
window.addEventListener('beforeunload',() => {for(const url of state.urls)URL.revokeObjectURL(url);});
colorOptions();surfaceOptions();connect();

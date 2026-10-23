import { safeApiBase } from './lib.js';
import { createCalendarFile } from './calendar.js';
import { createOwnerAuth } from './owner-auth.js';
import { createConfirmationTools, updateConfirmationDrafts } from './confirmation-tools.js';
import { mondayOfWeek, addCalendarDays } from './calendar-dates.js';
import { renderWeekCalendar, calendarWeekLabel, calendarTime, directionsLink, previousConsultation } from './week-calendar.js';

const EASTERN_ZONE = 'America/New_York';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGES = {lead_submitted:'Lead received',consultation_requested:'Scheduling started',booking_pending:'Booking pending',
  consultation_booked:'Consultation booked',photos_uploaded:'Photos uploaded',visualizations_created:'Visualizations created',consultation_cancelled:'Consultation cancelled'};
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
  const pageOptions=new URLSearchParams(location.search);let initialWeek=mondayOfWeek();
  try{if(pageOptions.has('date')){const week=mondayOfWeek(pageOptions.get('date'));calendarWeekLabel(week);initialWeek=week;}}catch{}
  const state = { busy: false, authenticated: false, generation: 0, controllers: new Set(), downloads: new Set(),leadPage:1,leadPages:1,
    calendarWeek:initialWeek,calendarData:null };
  const initialTab=pageOptions.get('view')==='calendar'?'calendar':'leads';
  let apiBase = '', auth = null;
  try { apiBase = safeApiBase(window.SPRAYNET_CONFIG?.apiBase, location.origin); } catch {}
  try { auth = createOwnerAuth(window.SPRAYNET_CONFIG,location.origin); } catch {}
  const message = (text = '', success = false) => {
    const box = $('#admin-message'); box.textContent = text; box.hidden = !text; box.classList.toggle('success', success);
  };
  function clearCalendar() {
    closeCalendarDetail();state.calendarData=null;$('#week-calendar').replaceChildren();$('#week-empty').hidden=true;
    $('#appointments-list').replaceChildren(); $('#blocks-list').replaceChildren();
    $('#appointment-count').textContent = ''; $('#block-count').textContent = '';
    $('#appointments-empty').hidden = true; $('#blocks-empty').hidden = true; $('#calendar-status').textContent = '';
  }
  function clearLeads() {
    $('#leads-list').replaceChildren();$('#lead-count').textContent='';$('#leads-empty').hidden=true;
    $('#lead-page-status').textContent='';$('#lead-activity-note').textContent='';
    for (const id of ['#total-leads','#needs-booking','#booked-leads','#visualizer-leads']) $(id).textContent='—';
  }
  function busy(value, label = '') {
    state.busy = value;
    $('#sign-in').disabled = value || !apiBase || !auth; $('#retry-sign-in').disabled = value;
    for (const button of document.querySelectorAll('[data-action-button]')) button.disabled = value;
    for (const link of document.querySelectorAll('.confirmation-actions a')) link.setAttribute('aria-disabled',String(value));
    $('#lead-stage').disabled=value;$('#previous-leads').disabled=value || state.leadPage<=1;
    $('#calendar-date').disabled=value;
    $('#next-leads').disabled=value || state.leadPage>=state.leadPages;
    if (label) $('#calendar-status').textContent = label;
  }
  function clearSessionView(text = 'You’re signed out.', focus = true) {
    state.generation++; state.authenticated = false;
    for (const controller of state.controllers) controller.abort(); state.controllers.clear();
    for (const url of state.downloads) URL.revokeObjectURL(url); state.downloads.clear();
    clearCalendar();clearLeads();state.leadPage=1;state.leadPages=1;$('#lead-search-form').reset();showTab('leads');$('#owner-password').value = ''; $('#block-form').reset();
    $('#calendar-workspace').hidden = true; $('#sign-in-panel').hidden = false; $('#sign-out').hidden = true;
    $('#retry-sign-in').hidden = true;
    busy(false); message(text); if (focus) $('#owner-email').focus({ preventScroll: true });
  }
  function safeError(error) {
    if (error?.status === 401) return 'Your saved sign-in was not accepted. Sign in again with your review-portal email and password.';
    if (error?.status === 403) return 'This account does not have owner access. Sign in with your Spray-Net owner account.';
    if (error?.status === 404) return 'Staff scheduling is unavailable at this connection. No calendar data is shown.';
    if (error?.code === 'INTERNAL_SCHEDULER_REQUIRED') return 'This staff calendar is available only with the internal scheduler. No calendar data is shown.';
    return error?.safeMessage || 'The connection was interrupted. Your sign-in is saved. Refresh the portal to check the latest status.';
  }
  function handleFailure(error) {
    if ([401,403].includes(error?.status)) clearSessionView(safeError(error));
    else message(safeError(error));
  }
  async function authorizedFetch(path, options) {
    const accessToken = await auth.getAccessToken();
    if (!accessToken) { const error = new Error('SIGN_IN_REQUIRED'); error.status=401; throw error; }
    const send = token => fetch(apiBase+path,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`}});
    let response = await send(accessToken);
    if (response.status === 401) {
      await response.body?.cancel();
      const refreshedToken = await auth.getAccessToken(true);
      if (!refreshedToken) { const error = new Error('SIGN_IN_REQUIRED'); error.status=401; throw error; }
      response = await send(refreshedToken);
    }
    return response;
  }
  async function request(path, { method = 'GET', body, keepalive=false } = {}) {
    if (!apiBase || !auth) throw new Error('CONNECTION_UNAVAILABLE');
    const generation = state.generation;
    const controller = new AbortController();if(!keepalive)state.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await authorizedFetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, keepalive,credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
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
  function confirmationTools(appointment) {
    const generation=state.generation,leadId=appointment.leadId||appointment.id;
    return createConfirmationTools(appointment,{document,device:navigator,clipboard:navigator.clipboard,
      isActive:()=>state.authenticated && !state.busy && generation===state.generation,
      onDraft:async channel=>{
        if(!state.authenticated||generation!==state.generation)throw new Error('SESSION_CLEARED');
        // Keep this small, idempotent write alive while the browser hands off to
        // the mail/SMS app. Logout still prevents late responses changing UI.
        const data=await request(`/api/admin/leads/${leadId}/confirmation-drafts`,{method:'POST',keepalive:true,
          body:{channel,draftVersion:appointment.draftVersion,start:appointment.start,end:appointment.end}});
        if(data.leadId!==leadId||data.draftVersion!==appointment.draftVersion||!data.confirmationDrafts
          ||!['email','sms'].every(key=>data.confirmationDrafts[key]===null||validInstant(data.confirmationDrafts[key])))throw new Error('INVALID_DRAFT_RESPONSE');
        for(const root of document.querySelectorAll('[data-confirmation-lead]'))
          if(root.getAttribute('data-confirmation-lead')===leadId&&root.getAttribute('data-confirmation-version')===appointment.draftVersion)
            updateConfirmationDrafts(root,data.confirmationDrafts);
        for(const row of state.calendarData?.bookings||[])if(row.leadId===leadId&&row.draftVersion===appointment.draftVersion)row.confirmationDrafts=data.confirmationDrafts;
        return data.confirmationDrafts;
      }});
  }
  function closeCalendarDetail() {
    const dialog=$('#calendar-detail');if(dialog.open)dialog.close();$('#calendar-detail-content').replaceChildren();
  }
  function openCalendarDetail({kind,record}) {
    if(!state.authenticated||state.busy)return;
    closeCalendarDetail();$('#calendar-detail-title').textContent=kind==='block'?'Unavailable time':'Consultation details';
    $('#calendar-detail-content').append(kind==='block'?blockCard(record):appointmentCard(record));$('#calendar-detail').showModal();
  }
  function showTab(view,focus=false) {
    for (const name of ['leads','calendar']) {
      const active=name===view,tab=$(`#${name}-tab`);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
      $(`#${name}-panel`).hidden=!active;if(active && focus)tab.focus();
    }
  }
  function renderLeads(data) {
    if (!data || !Array.isArray(data.leads) || !data.overview || !Number.isInteger(data.total) || !Number.isInteger(data.page) || data.pageSize!==50)
      throw new Error('INVALID_LEAD_RESPONSE');
    for (const row of data.leads) if (!row || !UUID.test(row.id) || !Object.hasOwn(STAGES,row.stage) || !validInstant(row.createdAt)
      || ![row.photoCount,row.renderCount,row.visitCount,row.remainingRenders].every(value=>Number.isInteger(value)&&value>=0)
      || (row.lastAccessedAt && !validInstant(row.lastAccessedAt))) throw new Error('INVALID_LEAD_RESPONSE');
    clearLeads();state.leadPages=Math.max(1,Math.ceil(data.total/data.pageSize));
    for (const [selector,key] of [['#total-leads','total'],['#needs-booking','needsBooking'],['#booked-leads','booked'],['#visualizer-leads','visualizerUsed']]) {
      if (!Number.isInteger(data.overview[key]) || data.overview[key]<0) throw new Error('INVALID_LEAD_RESPONSE');
      $(selector).textContent=String(data.overview[key]);
    }
    for (const lead of data.leads) {
      const card=element('article','lead-card'),header=element('div','lead-card-header');
      const badge=lead.booking?.status==='cancelled'?' cancelled':lead.booking?.status==='confirmed'?' booked':'';
      header.append(element('h3','',lead.name || 'Home show visitor'),element('span','lead-stage'+badge,STAGES[lead.stage]));
      card.append(header,element('p','lead-created',`Submitted ${formatEasternInstant(lead.createdAt)} · ${lead.captureMode==='tablet'?'Booth tablet':'Mobile'}`),detail('Phone',lead.phone,true));
      if(lead.email)card.append(detail('Email',lead.email));
      card.append(detail('Project address',lead.address));
      if(lead.booking?.start && validInstant(lead.booking.start)) card.append(element('p','lead-booking',`${lead.booking.status==='confirmed'?'Consultation':lead.booking.status==='cancelled'?'Cancelled consultation':'Pending consultation'} · ${formatEasternInstant(lead.booking.start)}`));
      const progress=element('div','lead-progress');
      for(const [value,label] of [[lead.visitCount,'Recorded visits'],[lead.photoCount,'Photos uploaded'],[lead.renderCount,'Renders completed']]) {
        const metric=element('div');metric.append(element('strong','',String(value)),element('span','',label));progress.append(metric);
      }
      card.append(progress,element('p','lead-last-visit',`Last project open: ${lead.lastAccessedAt?formatEasternInstant(lead.lastAccessedAt):'Not recorded'}`),
        element('p','lead-last-visit',`${lead.remainingRenders} free renders remaining${lead.pendingRenderCount?' · Render in progress':''}`));
      const confirmations=confirmationTools({...lead,...lead.booking});if(confirmations)card.append(confirmations);
      const actions=element('div','lead-actions'),remove=element('button','danger-button','Delete lead');
      remove.type='button';remove.setAttribute('data-action-button','');remove.setAttribute('aria-label',`Delete lead for ${lead.name || 'this visitor'}`);
      remove.addEventListener('click',()=>{
        if(state.busy || !state.authenticated || !confirm(`Delete ${lead.name || 'this lead'} (${lead.phone})? This permanently removes their contact details, saved project, photos, visualizations, visits and internal consultation. Their phone number can be registered again. This cannot be undone.`))return;
        mutate(`/api/admin/leads/${lead.id}`,'DELETE',{confirmation:'DELETE'},'Lead deleted. The phone number can be used for a new submission. Use Next visitor on the tablet, or refresh the visitor page to start again.');
      });
      actions.append(remove);card.append(actions);
      $('#leads-list').append(card);
    }
    $('#lead-count').textContent=String(data.total);$('#leads-empty').hidden=data.leads.length>0;
    $('#lead-page-status').textContent=`Page ${data.page} of ${state.leadPages} · ${data.total} ${data.total===1?'lead':'leads'}`;
    const since=validInstant(data.trackingStartedAt)?` Tracking began ${formatEasternInstant(data.trackingStartedAt)}; earlier visits are unavailable.`:'';
    $('#lead-activity-note').textContent='Visits count saved-project page opens, including the first submission. Reloading counts as another visit; steps within the same page do not. Stages reflect saved bookings, uploads and completed renders.'+since
      +(data.pendingMediaCleanups?' Some deleted-project files are waiting for cleanup. Refresh the portal to retry.':'');
  }
  function appointmentCard(appointment) {
      const card = element('article', 'appointment');
      card.append(element('p', 'appointment-time', `${formatEasternInstant(appointment.start)} – ${formatEasternInstant(appointment.end)}`));
      const heading = element('div', 'appointment-heading');
      heading.append(element('h3', '', appointment.name || 'Home show visitor'), element('span', `badge${appointment.status === 'pending' ? ' pending' : ''}`, appointment.status === 'pending' ? 'PENDING' : 'CONFIRMED'));
      card.append(heading, detail('Phone', appointment.phone, true), detail('Project address', appointment.address));
      if (appointment.email) card.append(detail('Email', appointment.email));
      const end=Date.parse(appointment.end),customerEnd=new Date(Math.min(end,Date.parse(appointment.start)+3600000)).toISOString();
      const travelEnd=new Date(end+(state.calendarData?.bufferMinutes??30)*60000).toISOString();
      card.append(detail('Customer appointment',`${calendarTime(appointment.start)}–${calendarTime(customerEnd)} Eastern`),
        detail('Staff reservation',`${calendarTime(appointment.start)}–${calendarTime(appointment.end)} Eastern`),
        detail('Travel gap after visit',`${calendarTime(appointment.end)}–${calendarTime(travelEnd)} Eastern`));
      if(appointment.address?.trim()) {
        const routes=element('div','appointment-directions'),link=element('a','button secondary small','Directions to project');
        link.href=directionsLink(appointment.address);link.target='_blank';link.rel='noopener noreferrer';routes.append(link);
        const previous=previousConsultation(appointment,state.calendarData?.bookings||[]);
        if(previous) {
          const route=element('a','button secondary small','Route from previous consultation');route.href=directionsLink(appointment.address,previous.address);
          route.target='_blank';route.rel='noopener noreferrer';routes.append(route);
          card.append(detail('Previous consultation',`${previous.name} · ${previous.address}`));
        }
        card.append(routes);
      }
      const actions = element('div', 'appointment-actions'), cancel = element('button', 'danger-button', 'Cancel consultation');
      if (appointment.status === 'confirmed') {
        card.append(confirmationTools(appointment));
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
        if (state.busy || !state.authenticated || !confirm(`Cancel the consultation for ${appointment.name || 'this visitor'} on ${formatEasternInstant(appointment.start)}? Their visualizer access will be locked.`)) return;
        closeCalendarDetail();
        mutate(`/api/admin/bookings/${appointment.leadId}/cancel`, 'POST', undefined, 'Consultation cancelled.');
      });
      actions.append(cancel);card.append(actions);return card;
  }
  function blockCard(block) {
      const card = element('article', 'block-entry');
      card.append(element('p', '', `${formatEasternInstant(block.start)} – ${formatEasternInstant(block.end)}`));
      if (block.note) card.append(element('p', 'block-note', block.note));
      const remove = element('button', 'danger-button', 'Remove block'); remove.type = 'button'; remove.setAttribute('data-action-button', '');
      remove.addEventListener('click', () => {
        if (state.busy || !state.authenticated || !confirm('Remove this unavailable block? Its times may become bookable.')) return;
        closeCalendarDetail();
        mutate(`/api/admin/blocks/${block.id}`, 'DELETE', undefined, 'Unavailable block removed.');
      });
      card.append(remove);return card;
  }
  function renderCalendar(data) {
    if (!data || !Array.isArray(data.bookings) || !Array.isArray(data.blocks) || data.week!==state.calendarWeek
      || !Number.isInteger(data.bufferMinutes) || data.bufferMinutes<0 || data.bufferMinutes>180) throw new Error('INVALID_CALENDAR_RESPONSE');
    for (const row of data.bookings) if (!row || !UUID.test(row.leadId) || !validInstant(row.start) || !validInstant(row.end) || Date.parse(row.end)<=Date.parse(row.start)
      || !['confirmed', 'pending'].includes(row.status)) throw new Error('INVALID_CALENDAR_RESPONSE');
    for (const row of data.blocks) if (!row || !UUID.test(row.id) || !validInstant(row.start) || !validInstant(row.end) || Date.parse(row.end)<=Date.parse(row.start))throw new Error('INVALID_CALENDAR_RESPONSE');
    clearCalendar();state.calendarData=data;
    const generation=state.generation;
    renderWeekCalendar($('#week-calendar'),data,{week:state.calendarWeek,onSelect:openCalendarDetail,
      isActive:()=>state.authenticated&&!state.busy&&generation===state.generation&&state.calendarData===data});
    $('#week-label').textContent=calendarWeekLabel(state.calendarWeek);$('#calendar-date').value=state.calendarWeek;
    $('#week-empty').hidden=data.bookings.length+data.blocks.length>0;
    const appointments=[...data.bookings].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),blocks=[...data.blocks].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    for(const appointment of appointments)$('#appointments-list').append(appointmentCard(appointment));
    for(const block of blocks)$('#blocks-list').append(blockCard(block));
    $('#appointment-count').textContent = String(appointments.length); $('#block-count').textContent = String(blocks.length);
    $('#appointments-empty').hidden = appointments.length > 0; $('#blocks-empty').hidden = blocks.length > 0;
    $('#calendar-status').textContent = `Updated ${new Intl.DateTimeFormat('en-US', { timeZone: EASTERN_ZONE, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date())} · Eastern Time`;
  }
  async function loadCalendar(generation = state.generation) {
    clearCalendar(); $('#calendar-status').textContent = 'Loading the private calendar…';
    $('#week-label').textContent=calendarWeekLabel(state.calendarWeek);$('#calendar-date').value=state.calendarWeek;
    const data = await request('/api/admin/bookings?week='+encodeURIComponent(state.calendarWeek));
    if (generation !== state.generation) return false;
    renderCalendar(data); return true;
  }
  async function loadLeads(generation=state.generation) {
    clearLeads();
    const query=new URLSearchParams({page:String(state.leadPage)});
    if($('#lead-search').value.trim())query.set('q',$('#lead-search').value.trim());
    if($('#lead-stage').value)query.set('stage',$('#lead-stage').value);
    const data=await request('/api/admin/leads?'+query);
    if(generation!==state.generation)return false;
    const pages=Math.max(1,Math.ceil(data.total/data.pageSize));
    if(state.leadPage>pages){state.leadPage=pages;return loadLeads(generation);}
    renderLeads(data);return true;
  }
  async function loadWorkspace(generation=state.generation) {
    const results=await Promise.all([loadCalendar(generation),loadLeads(generation)]);
    return generation===state.generation && results.every(Boolean);
  }
  async function mutate(path, method, body, successMessage) {
    if (!state.authenticated || state.busy) return;
    const generation = state.generation; busy(true, 'Updating the portal…'); message();
    try {
      await request(path, { method, body }); if (generation !== state.generation) return;
      if (path === '/api/admin/blocks' && method === 'POST') $('#block-form').reset();
      if (await loadWorkspace(generation)) message(successMessage, true);
    } catch (error) {
      if (generation !== state.generation) return;
      if ([400, 409, 422].includes(error.status) && error.code !== 'INTERNAL_SCHEDULER_REQUIRED') message(safeError(error));
      else handleFailure(error);
    } finally { if (generation === state.generation) busy(false); }
  }
  $('#sign-in-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.busy) return;
    if (!apiBase) { message('The staff calendar is not connected in this preview. Open the connected site or ask your team for access.'); return; }
    for (const input of event.target.querySelectorAll('input')) if (!input.checkValidity()) { input.reportValidity(); return; }
    if (!auth) { message('Owner sign-in is not configured. Refresh the published portal.'); return; }
    state.generation++; const generation = state.generation;
    const password = $('#owner-password').value;
    busy(true); message('Signing in…');
    try {
      await auth.signIn($('#owner-email').value,password); $('#owner-password').value = '';
      if (generation !== state.generation) return;
      if (await loadWorkspace(generation)) {
        state.authenticated = true; $('#sign-in-panel').hidden = true; $('#calendar-workspace').hidden = false; $('#sign-out').hidden = false;
        message();showTab(initialTab,true);
      }
    } catch (error) {
      if (generation === state.generation) {
        if ([400,422].includes(error?.status) || ['invalid_credentials','email_not_confirmed','user_banned'].includes(error?.code)) message('Email or password is incorrect, or this account is unavailable. Use your existing review-portal account.');
        else if (error?.status === 429) message('Too many sign-in attempts. Wait a moment and try again.');
        else handleFailure(error);
      }
    }
    finally { $('#owner-password').value = ''; if (generation === state.generation) busy(false); }
  });
  async function restoreAccess() {
    if (!apiBase || !auth || state.busy) return;
    state.generation++; const generation = state.generation; busy(true); message('Restoring your saved sign-in…');
    $('#retry-sign-in').hidden=true;
    try {
      const token = await auth.getAccessToken();
      if (generation !== state.generation) return;
      if (!token) { message(); return; }
      if (await loadWorkspace(generation)) {
        state.authenticated=true; $('#sign-in-panel').hidden=true; $('#calendar-workspace').hidden=false; $('#sign-out').hidden=false;
        message();showTab(initialTab);
      }
    } catch (error) {
      if (generation === state.generation) {
        handleFailure(error); if (![401,403].includes(error?.status)) $('#retry-sign-in').hidden=false;
      }
    } finally { if (generation === state.generation) busy(false); }
  }
  $('#retry-sign-in').addEventListener('click',restoreAccess);
  async function changeCalendarWeek(value,offset=0) {
    if(state.busy||!state.authenticated)return;
    let week;try{week=addCalendarDays(mondayOfWeek(value),offset);calendarWeekLabel(week);}catch{message('Choose a valid calendar date.');return;}
    if(week===state.calendarWeek)return;
    state.calendarWeek=week;const generation=state.generation;busy(true);message();
    try{await loadCalendar(generation);}catch(error){if(generation===state.generation)handleFailure(error);}
    finally{if(generation===state.generation)busy(false);}
  }
  $('#previous-week').addEventListener('click',()=>changeCalendarWeek(state.calendarWeek,-7));
  $('#next-week').addEventListener('click',()=>changeCalendarWeek(state.calendarWeek,7));
  $('#calendar-today').addEventListener('click',()=>changeCalendarWeek(Date.now()));
  $('#calendar-date').addEventListener('change',event=>changeCalendarWeek(event.target.value));
  $('#close-calendar-detail').addEventListener('click',closeCalendarDetail);
  $('#calendar-detail').addEventListener('close',()=>{if(!$('#calendar-detail').open)$('#calendar-detail-content').replaceChildren();});
  $('#refresh-calendar').addEventListener('click', async () => {
    if (state.busy || !state.authenticated) return;
    const generation = state.generation; busy(true); message();
    try { await loadWorkspace(generation); }
    catch (error) { if (generation === state.generation) handleFailure(error); }
    finally { if (generation === state.generation) busy(false); }
  });
  async function changeLeadPage(page=1) {
    if(state.busy || !state.authenticated)return;
    state.leadPage=page;const generation=state.generation;busy(true);message();
    try{await loadLeads(generation);}catch(error){if(generation===state.generation)handleFailure(error);}
    finally{if(generation===state.generation)busy(false);}
  }
  $('#lead-search-form').addEventListener('submit',event=>{event.preventDefault();changeLeadPage();});
  $('#lead-stage').addEventListener('change',()=>changeLeadPage());
  $('#previous-leads').addEventListener('click',()=>changeLeadPage(Math.max(1,state.leadPage-1)));
  $('#next-leads').addEventListener('click',()=>changeLeadPage(Math.min(state.leadPages,state.leadPage+1)));
  for(const name of ['leads','calendar']) {
    $(`#${name}-tab`).addEventListener('click',()=>showTab(name));
    $(`#${name}-tab`).addEventListener('keydown',event=>{
      if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();showTab(event.key==='Home'?'leads':event.key==='End'?'calendar':name==='leads'?'calendar':'leads',true);}
    });
  }
  $('#download-leads').addEventListener('click', async () => {
    if (state.busy || !state.authenticated) return;
    const generation = state.generation, controller = new AbortController(); state.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000); busy(true, 'Preparing your private lead export…'); message();
    try {
      const response = await authorizedFetch('/api/admin/leads.csv', { headers: {},
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
      if (generation !== state.generation) return;
      if (!response.ok) { const error = new Error('EXPORT_FAILED'); error.status = response.status; throw error; }
      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.toLowerCase().includes('text/csv')) throw new Error('INVALID_EXPORT_RESPONSE');
      const blob = await response.blob(); if (generation !== state.generation) return;
      downloadFile(blob, `spray-net-home-show-leads-${new Date().toISOString().slice(0, 10)}.csv`);
      message('Lead CSV downloaded. Keep it private and use the approved Spray-Network import mapping.', true);
      $('#calendar-status').textContent = 'Private lead export downloaded.';
    } catch (error) { if (generation === state.generation) handleFailure(error); }
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
  $('#sign-out').addEventListener('click', async () => {
    clearSessionView('You’re signed out on this browser.');
    try { await auth?.signOut(); } catch { message('Sign-out could not finish. Reconnect and try again before leaving a shared device.'); $('#retry-sign-in').hidden=false; }
  });
  auth?.subscribe(event => {
    if (event === 'SIGNED_OUT') clearSessionView('You’re signed out on this browser.',false);
    if (event === 'SIGNED_IN' && !state.authenticated && !state.busy) setTimeout(restoreAccess,0);
  });
  // Clear private page contents for navigation, while retaining the provider's
  // saved session. A history restore revalidates access with the private API.
  window.addEventListener('pagehide', () => clearSessionView('',false));
  window.addEventListener('pageshow', event => { if (event.persisted) restoreAccess(); });
  busy(false);
  if (!apiBase) message('The staff calendar is not connected in this preview. Open the connected site or ask your team for access.');
  else if (!auth) message('Owner sign-in is unavailable. Refresh the published portal.');
  else restoreAccess();
}

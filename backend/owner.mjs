/** Called only after Worker authentication. No visitor identifiers, tokens,
 * IP addresses or browser fingerprints are exposed by the owner dashboard. */
import { confirmationDraftColumns, confirmationDraftValues } from './confirmation-drafts.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGES = ['lead_submitted','consultation_requested','scheduling_followup','booking_pending','consultation_booked','photos_uploaded','visualizations_created','consultation_cancelled'];
export class OwnerError extends Error {
  constructor(status,code,message) {super(message);this.status=status;this.code=code;}
}
const fail = (status,code,message) => {throw new OwnerError(status,code,message);};

async function cleanDeletedMedia(env,job) {
  try {
    // Never clean objects for an active lead, even if a damaged queue row exists.
    if(await env.DB.prepare('SELECT id FROM leads WHERE id=?').bind(job.lead_id).first())return false;
    const keys=JSON.parse(job.object_keys);
    if(!Array.isArray(keys) || keys.length>10000 || !UUID.test(job.lead_id) || keys.some(key=>typeof key!=='string'
      || !(key.startsWith(`photos/${job.lead_id}/`) || key.startsWith(`renders/${job.lead_id}/`))))return false;
    for(let index=0;index<keys.length;index+=16)await Promise.all(keys.slice(index,index+16).map(key=>env.PHOTOS.delete(key)));
    await env.DB.prepare('DELETE FROM lead_media_cleanup WHERE lead_id=?').bind(job.lead_id).run();return true;
  } catch {return false;}
}
export async function retryDeletedMedia(env) {
  const jobs=await env.DB.prepare('SELECT lead_id,object_keys FROM lead_media_cleanup ORDER BY requested_at LIMIT 10').all();
  for(const job of jobs.results)await cleanDeletedMedia(env,job);
}

export async function deleteOwnerLead(env,leadId,body) {
  if(!UUID.test(leadId))fail(400,'INVALID_LEAD','Choose a valid lead.');
  leadId=leadId.toLowerCase();
  if(body?.confirmation!=='DELETE')fail(400,'DELETE_CONFIRMATION_REQUIRED','Confirm deletion of this lead.');
  // A live paid render or unresolved booking must finish before its lead goes.
  // The same conditions are checked inside the atomic capture-and-delete batch.
  const guard=`NOT EXISTS(SELECT 1 FROM renders WHERE lead_id=? AND status='pending')
    AND NOT EXISTS(SELECT 1 FROM consultation_bookings WHERE lead_id=? AND
      (status='pending' OR (calendar_key NOT LIKE 'internal:%' AND status='confirmed')))`;
  const result=await env.DB.batch([
    env.DB.prepare(`INSERT INTO lead_media_cleanup(lead_id,object_keys,requested_at)
      SELECT id,(SELECT json_group_array(object_key) FROM (
        SELECT object_key FROM photos WHERE lead_id=?
        UNION SELECT object_key FROM renders WHERE lead_id=? AND object_key IS NOT NULL)),?
      FROM leads WHERE id=? AND ${guard} ON CONFLICT(lead_id) DO NOTHING`)
      .bind(leadId,leadId,new Date().toISOString(),leadId,leadId,leadId),
    env.DB.prepare(`DELETE FROM leads WHERE id=? AND ${guard}
      AND EXISTS(SELECT 1 FROM lead_media_cleanup WHERE lead_id=?)`).bind(leadId,leadId,leadId,leadId),
  ]);
  if(result[1].meta.changes!==1 && await env.DB.prepare('SELECT id FROM leads WHERE id=?').bind(leadId).first())
    fail(409,'LEAD_BUSY','Wait for any visualization or pending booking to finish. Cancel any linked Outlook appointment before deleting this lead.');
  const job=await env.DB.prepare('SELECT lead_id,object_keys FROM lead_media_cleanup WHERE lead_id=?').bind(leadId).first();
  const cleaned=!job || await cleanDeletedMedia(env,job);
  return {deleted:true,mediaCleanupPending:!cleaned};
}

export async function recordProjectVisit(env,leadId,body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.visitId !== 'string' || !UUID.test(body.visitId))
    fail(400,'INVALID_VISIT','A valid project visit identifier is required.');
  const visitId = body.visitId.toLowerCase();
  if (await env.DB.prepare('SELECT visit_id FROM lead_visits WHERE lead_id=? AND visit_id=?').bind(leadId,visitId).first()) return {recorded:false};
  const recent = await env.DB.prepare('SELECT COUNT(*) AS count FROM lead_visits WHERE lead_id=? AND accessed_at>=?')
    .bind(leadId,new Date(Date.now()-3600000).toISOString()).first();
  if (recent.count >= 120) fail(429,'VISIT_RATE_LIMIT','Project visit tracking is temporarily limited.');
  const result = await env.DB.prepare('INSERT OR IGNORE INTO lead_visits(lead_id,visit_id,accessed_at) VALUES (?,?,?)')
    .bind(leadId,visitId,new Date().toISOString()).run();
  return {recorded:result.meta.changes === 1};
}

export async function markConfirmationDraft(env,leadId,body) {
  if(!UUID.test(leadId)||!body||typeof body!=='object'||Array.isArray(body)||!['email','sms'].includes(body.channel)
    ||typeof body.draftVersion!=='string'||!body.draftVersion||body.draftVersion.length>128
    ||typeof body.start!=='string'||typeof body.end!=='string')fail(400,'INVALID_CONFIRMATION_DRAFT','Choose a valid consultation and message channel.');
  leadId=leadId.toLowerCase();
  await env.DB.prepare(`INSERT OR IGNORE INTO confirmation_drafts(lead_id,booking_transaction_id,channel,drafted_at)
    SELECT lead_id,transaction_id,?,? FROM consultation_bookings
    WHERE lead_id=? AND transaction_id=? AND status='confirmed' AND start_at=? AND end_at=?`)
    .bind(body.channel,new Date().toISOString(),leadId,body.draftVersion,body.start,body.end).run();
  const row=await env.DB.prepare(`SELECT b.transaction_id,${confirmationDraftColumns} FROM consultation_bookings b
    WHERE b.lead_id=? AND b.transaction_id=? AND b.status='confirmed' AND b.start_at=? AND b.end_at=?`)
    .bind(leadId,body.draftVersion,body.start,body.end).first();
  if(!row)fail(409,'CONSULTATION_CHANGED','This consultation changed. Refresh the portal before drafting its confirmation.');
  return {leadId,draftVersion:row.transaction_id,confirmationDrafts:confirmationDraftValues(row)};
}

const PROGRESS = `WITH progress AS (
  SELECT l.id,l.first_name,l.last_name,l.phone,l.phone_normalized,l.email,l.address,l.city,l.state,l.zip,
    l.event_label,l.capture_mode,l.consultation_preference,l.remaining_renders,l.created_at,
    (SELECT requested_at FROM scheduling_followups f WHERE f.lead_id=l.id) AS scheduling_followup_requested_at,
    b.status AS booking_status,b.start_at AS booking_start,b.end_at AS booking_end,b.transaction_id AS draft_version,${confirmationDraftColumns},
    (SELECT COUNT(*) FROM photos p WHERE p.lead_id=l.id AND p.status='ready') AS photo_count,
    (SELECT COUNT(*) FROM renders r WHERE r.lead_id=l.id AND r.status='completed') AS render_count,
    (SELECT COUNT(*) FROM renders r WHERE r.lead_id=l.id AND r.status='pending') AS pending_render_count,
    (SELECT COUNT(*) FROM lead_visits v WHERE v.lead_id=l.id) AS visit_count,
    (SELECT MAX(accessed_at) FROM lead_visits v WHERE v.lead_id=l.id) AS last_accessed_at
  FROM leads l LEFT JOIN consultation_bookings b ON b.lead_id=l.id
), staged AS (SELECT progress.*,CASE
  WHEN booking_status='pending' THEN 'booking_pending'
  WHEN booking_status='confirmed' AND render_count>0 THEN 'visualizations_created'
  WHEN booking_status='confirmed' AND photo_count>0 THEN 'photos_uploaded'
  WHEN booking_status='confirmed' THEN 'consultation_booked'
  WHEN scheduling_followup_requested_at IS NOT NULL THEN 'scheduling_followup'
  WHEN booking_status='cancelled' THEN 'consultation_cancelled'
  WHEN consultation_preference='schedule_now' THEN 'consultation_requested'
  ELSE 'lead_submitted' END AS stage FROM progress)
`;

export async function listOwnerLeads(env,url) {
  const pageText = url.searchParams.get('page') || '1', stage = url.searchParams.get('stage') || '', query = (url.searchParams.get('q') || '').trim();
  if (!/^[1-9]\d{0,4}$/.test(pageText) || Number(pageText)>10000 || (stage && !STAGES.includes(stage)) || query.length>160 || /[\u0000-\u001f\u007f]/.test(query))
    fail(400,'INVALID_LEAD_FILTER','Check your lead search and filters.');
  const page = Number(pageText), pageSize = 50, bindings = [], conditions = [];
  if (stage) {conditions.push('stage=?');bindings.push(stage);}
  if (query) {
    conditions.push("INSTR(LOWER(first_name||' '||last_name||' '||phone||' '||phone_normalized||' '||email||' '||address),LOWER(?))>0");bindings.push(query);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  await retryDeletedMedia(env);
  const [overview,total,rows,tracking,cleanup] = await Promise.all([
    env.DB.prepare(PROGRESS+`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN booking_status='confirmed' THEN 1 ELSE 0 END),0) AS booked,
      COALESCE(SUM(CASE WHEN booking_status IS NULL OR booking_status<>'confirmed' THEN 1 ELSE 0 END),0) AS needs_booking,
      COALESCE(SUM(CASE WHEN render_count>0 THEN 1 ELSE 0 END),0) AS visualizer_used FROM staged`).first(),
    env.DB.prepare(PROGRESS+'SELECT COUNT(*) AS count FROM staged'+where).bind(...bindings).first(),
    env.DB.prepare(PROGRESS+'SELECT * FROM staged'+where+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(...bindings,pageSize,(page-1)*pageSize).all(),
    env.DB.prepare("SELECT value FROM app_metadata WHERE key='activity_tracking_started_at'").first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM lead_media_cleanup').first(),
  ]);
  return {page,pageSize,total:total.count,trackingStartedAt:tracking?.value || null,pendingMediaCleanups:cleanup.count,
    overview:{total:overview.total,booked:overview.booked,needsBooking:overview.needs_booking,visualizerUsed:overview.visualizer_used},
    leads:rows.results.map(row => ({id:row.id,name:`${row.first_name} ${row.last_name}`.trim(),phone:row.phone,email:row.email,
      address:row.address,city:row.city,state:row.state,zip:row.zip,event:row.event_label,captureMode:row.capture_mode,createdAt:row.created_at,
      stage:row.stage,schedulingFollowUpRequestedAt:row.stage==='scheduling_followup'?row.scheduling_followup_requested_at:null,
      booking:{status:row.booking_status || 'none',start:row.booking_start || null,end:row.booking_end || null,
        draftVersion:row.draft_version||null,confirmationDrafts:confirmationDraftValues(row)},
      photoCount:row.photo_count,renderCount:row.render_count,pendingRenderCount:row.pending_render_count,remainingRenders:row.remaining_renders,
      visitCount:row.visit_count,lastAccessedAt:row.last_accessed_at || null}))};
}

/** Called only after Worker authentication. No visitor identifiers, tokens,
 * IP addresses or browser fingerprints are exposed by the owner dashboard. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGES = ['lead_submitted','consultation_requested','booking_pending','consultation_booked','photos_uploaded','visualizations_created','consultation_cancelled'];
export class OwnerError extends Error {
  constructor(status,code,message) {super(message);this.status=status;this.code=code;}
}
const fail = (status,code,message) => {throw new OwnerError(status,code,message);};

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

const PROGRESS = `WITH progress AS (
  SELECT l.id,l.first_name,l.last_name,l.phone,l.phone_normalized,l.email,l.address,l.city,l.state,l.zip,
    l.event_label,l.capture_mode,l.consultation_preference,l.remaining_renders,l.created_at,
    b.status AS booking_status,b.start_at AS booking_start,b.end_at AS booking_end,
    (SELECT COUNT(*) FROM photos p WHERE p.lead_id=l.id AND p.status='ready') AS photo_count,
    (SELECT COUNT(*) FROM renders r WHERE r.lead_id=l.id AND r.status='completed') AS render_count,
    (SELECT COUNT(*) FROM renders r WHERE r.lead_id=l.id AND r.status='pending') AS pending_render_count,
    (SELECT COUNT(*) FROM lead_visits v WHERE v.lead_id=l.id) AS visit_count,
    (SELECT MAX(accessed_at) FROM lead_visits v WHERE v.lead_id=l.id) AS last_accessed_at
  FROM leads l LEFT JOIN consultation_bookings b ON b.lead_id=l.id
), staged AS (SELECT progress.*,CASE
  WHEN booking_status='cancelled' THEN 'consultation_cancelled'
  WHEN booking_status='pending' THEN 'booking_pending'
  WHEN booking_status='confirmed' AND render_count>0 THEN 'visualizations_created'
  WHEN booking_status='confirmed' AND photo_count>0 THEN 'photos_uploaded'
  WHEN booking_status='confirmed' THEN 'consultation_booked'
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
  const [overview,total,rows,tracking] = await Promise.all([
    env.DB.prepare(PROGRESS+`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN booking_status='confirmed' THEN 1 ELSE 0 END),0) AS booked,
      COALESCE(SUM(CASE WHEN booking_status IS NULL OR booking_status<>'confirmed' THEN 1 ELSE 0 END),0) AS needs_booking,
      COALESCE(SUM(CASE WHEN render_count>0 THEN 1 ELSE 0 END),0) AS visualizer_used FROM staged`).first(),
    env.DB.prepare(PROGRESS+'SELECT COUNT(*) AS count FROM staged'+where).bind(...bindings).first(),
    env.DB.prepare(PROGRESS+'SELECT * FROM staged'+where+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(...bindings,pageSize,(page-1)*pageSize).all(),
    env.DB.prepare("SELECT value FROM app_metadata WHERE key='activity_tracking_started_at'").first(),
  ]);
  return {page,pageSize,total:total.count,trackingStartedAt:tracking?.value || null,
    overview:{total:overview.total,booked:overview.booked,needsBooking:overview.needs_booking,visualizerUsed:overview.visualizer_used},
    leads:rows.results.map(row => ({id:row.id,name:`${row.first_name} ${row.last_name}`.trim(),phone:row.phone,email:row.email,
      address:row.address,city:row.city,state:row.state,zip:row.zip,event:row.event_label,captureMode:row.capture_mode,createdAt:row.created_at,
      stage:row.stage,booking:{status:row.booking_status || 'none',start:row.booking_start || null,end:row.booking_end || null},
      photoCount:row.photo_count,renderCount:row.render_count,pendingRenderCount:row.pending_render_count,remainingRenders:row.remaining_renders,
      visitCount:row.visit_count,lastAccessedAt:row.last_accessed_at || null}))};
}

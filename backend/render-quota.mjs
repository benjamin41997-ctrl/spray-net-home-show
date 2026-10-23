const encoder=new TextEncoder();
async function quotaKey(lead) {
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(['render-quota-v1',lead.event_id,lead.phone_normalized])));
  return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
/** Usage survives deleted lead/media records. No browser-supplied balance,
 * allowance, phone or event can select or reset this private quota record. */
export async function ensureRenderQuota(env,lead,config) {
  const key=await quotaKey(lead),stamp=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO render_event_usage(event_id,attempts,attempt_limit)
      SELECT ?,COUNT(*),? FROM renders r JOIN leads l ON l.id=r.lead_id WHERE l.event_id=?
      ON CONFLICT(event_id) DO UPDATE SET attempts=MAX(render_event_usage.attempts,excluded.attempts),attempt_limit=excluded.attempt_limit`)
      .bind(lead.event_id,config.eventRenderLimit,lead.event_id),
    env.DB.prepare(`INSERT INTO render_quotas(quota_key,event_id,allowance,consumed,attempts,attempt_limit,updated_at)
      SELECT ?,?,?,COALESCE(SUM(CASE WHEN r.status IN ('completed','pending') THEN 1 ELSE 0 END),0),COUNT(r.id),?,?
      FROM leads l LEFT JOIN renders r ON r.lead_id=l.id WHERE l.event_id=? AND l.phone_normalized=?
      ON CONFLICT(quota_key) DO UPDATE SET allowance=MAX(render_quotas.allowance,excluded.allowance),
        consumed=MAX(render_quotas.consumed,excluded.consumed),attempts=MAX(render_quotas.attempts,excluded.attempts),
        attempt_limit=excluded.attempt_limit,updated_at=excluded.updated_at`)
      .bind(key,lead.event_id,config.freeRenders,config.phoneRenderAttemptLimit,stamp,lead.event_id,lead.phone_normalized),
    env.DB.prepare(`INSERT OR IGNORE INTO render_quota_leads(lead_id,quota_key)
      SELECT id,? FROM leads WHERE event_id=? AND phone_normalized=?`).bind(key,lead.event_id,lead.phone_normalized),
    env.DB.prepare(`UPDATE leads SET remaining_renders=(SELECT MAX(0,allowance-consumed) FROM render_quotas WHERE quota_key=?)
      WHERE id IN (SELECT lead_id FROM render_quota_leads WHERE quota_key=?)`).bind(key,key),
  ]);
  return readRenderQuota(env,lead.id);
}
export async function readRenderQuota(env,leadId) {
  const row=await env.DB.prepare(`SELECT q.allowance,q.consumed,q.attempts,q.attempt_limit FROM render_quotas q
    JOIN render_quota_leads m ON m.quota_key=q.quota_key WHERE m.lead_id=?`).bind(leadId).first();
  if(!row)throw new Error('RENDER_QUOTA_UNAVAILABLE');
  return {remainingRenders:Math.max(0,row.allowance-row.consumed),renderAllowance:row.allowance,renderAttemptsRemaining:Math.max(0,row.attempt_limit-row.attempts)};
}

import {OwnerError} from './owner.mjs';
/** An explicit callback request, separate from merely opening the scheduler. */
export async function schedulingFollowUp(env,leadId) {
  const row=await env.DB.prepare(`SELECT requested_at FROM scheduling_followups WHERE lead_id=?
    AND NOT EXISTS(SELECT 1 FROM consultation_bookings WHERE lead_id=? AND status IN ('pending','confirmed'))`)
    .bind(leadId,leadId).first();
  return row?.requested_at || null;
}
export async function requestSchedulingFollowUp(env,leadId) {
  await env.DB.prepare(`INSERT INTO scheduling_followups(lead_id,requested_at)
    SELECT id,? FROM leads WHERE id=? AND NOT EXISTS
    (SELECT 1 FROM consultation_bookings WHERE lead_id=? AND status IN ('pending','confirmed'))
    ON CONFLICT(lead_id) DO NOTHING`).bind(new Date().toISOString(),leadId,leadId).run();
  const requestedAt=await schedulingFollowUp(env,leadId);
  if(!requestedAt)throw new OwnerError(409,'BOOKING_ALREADY_ACTIVE','Your appointment is already booked or being checked. Refresh to see its status.');
  return {schedulingFollowUpRequestedAt:requestedAt};
}

// Only used in authenticated owner reads. Alias b is the current booking.
export const confirmationDraftColumns=`
  (SELECT d.drafted_at FROM confirmation_drafts d WHERE d.lead_id=b.lead_id AND d.booking_transaction_id=b.transaction_id AND d.channel='email') AS email_drafted_at,
  (SELECT d.drafted_at FROM confirmation_drafts d WHERE d.lead_id=b.lead_id AND d.booking_transaction_id=b.transaction_id AND d.channel='sms') AS sms_drafted_at`;
export const confirmationDraftValues=row=>({email:row.email_drafted_at||null,sms:row.sms_drafted_at||null});

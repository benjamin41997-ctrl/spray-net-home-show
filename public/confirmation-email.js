import { visitorAppointment } from './project-options.js';
/** Prepare a draft in the owner's email app. This never sends a message or
 * claims Microsoft mail authorization exists. Choose the Spray-Net sender. */
export function confirmationEmailDraft(appointment) {
  if(typeof appointment?.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appointment.email)
    || /[\r\n]/.test(appointment.email))throw new TypeError('A valid customer email is required.');
  const visit=visitorAppointment(appointment);
  const date=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'});
  const greeting=String(appointment.name||'').trim().split(/\s+/)[0]||'there';
  const body=`Hi ${greeting},\n\nYour Spray-Net South Charlotte consultation is confirmed for ${date.format(new Date(visit.start))}, ${time.format(new Date(visit.start))}–${time.format(new Date(visit.end))} Eastern Time.\n\nProject address: ${appointment.address||''}\n\nWe look forward to talking about your project and your exclusive home-show rewards. Your confirmed booking also unlocks 3 free visualizations on the home-show page you used to book.\n\nReply to this email if you need to change your appointment.\n\nBen Hessler\nSpray-Net South Charlotte\nben.hessler@spray-net.com`;
  return `mailto:${encodeURIComponent(appointment.email)}?subject=${encodeURIComponent('Your Spray-Net consultation is confirmed')}&body=${encodeURIComponent(body)}`;
}

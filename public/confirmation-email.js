import { visitorAppointment } from './project-options.js';

export const CONFIRMATION_SENDER = 'ben.hessler@spray-net.com';
const oneLine = value => String(value || '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();

/** A phone URI must contain one US recipient, never another URI or a query. */
export function confirmationPhone(value) {
  if (typeof value !== 'string' || !/^[+\d(). \-]+$/.test(value)) throw new TypeError('A valid customer phone is required.');
  const digits = value.replace(/[(). \-]/g, '');
  if (/^\d{10}$/.test(digits)) return '+1' + digits;
  if (/^\+?1\d{10}$/.test(digits)) return '+' + digits.replace(/^\+/, '');
  throw new TypeError('A valid customer phone is required.');
}

function messageDetails(appointment) {
  const visit=visitorAppointment(appointment);
  const date=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const shortDate=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',year:'numeric'});
  const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'});
  return {greeting:oneLine(appointment.name).split(' ')[0]||'there',address:oneLine(appointment.address),
    date:date.format(new Date(visit.start)),shortDate:shortDate.format(new Date(visit.start)),
    time:`${time.format(new Date(visit.start))}–${time.format(new Date(visit.end))}`};
}

/** Draft content stays on the owner device. Neither function sends a message. */
export function confirmationEmail(appointment) {
  if(typeof appointment?.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appointment.email)
    || /[\u0000-\u001f\u007f]/.test(appointment.email))throw new TypeError('A valid customer email is required.');
  const {greeting,date,time,address}=messageDetails(appointment);
  const to=appointment.email,subject='Your Spray-Net consultation is confirmed';
  const body=`Hi ${greeting},\n\nYour Spray-Net South Charlotte consultation is confirmed for ${date}, ${time} Eastern Time.${address?`\n\nProject address: ${address}`:''}\n\nAs a home show attendee, you can take advantage of our Home Show Deal: save up to $1,000 on kitchen cabinet refinishing, based on your project value.\n\n$250 OFF projects from $3,000–$4,999\n$500 OFF projects from $5,000–$6,999\n$750 OFF projects from $7,000–$8,999\n$1,000 OFF projects of $9,000+\n\nWe look forward to talking about your project!`;
  return {to,subject,body,href:`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`};
}

/** iOS uses a different compose separator; other SMS handlers use RFC 5724.
 * Some handlers ignore bodies, so the owner UI always offers a copy fallback. */
export function confirmationText(appointment,device={}) {
  const to=confirmationPhone(appointment?.phone),{greeting,shortDate,time,address}=messageDetails(appointment);
  const body=`Hi ${greeting}, your Spray-Net South Charlotte consultation is confirmed for ${shortDate}, ${time} Eastern Time.${address?` Address: ${address}.`:''} - Ben Hessler`;
  const ios=/iPad|iPhone|iPod/.test(device.userAgent||'') || (device.platform==='MacIntel' && device.maxTouchPoints>1);
  return {to,body,href:`sms:${to}${ios?'&':'?'}body=${encodeURIComponent(body)}`};
}

// Retain the original mailto helper for existing integrations.
export function confirmationEmailDraft(appointment) {
  return confirmationEmail(appointment).href;
}

// Calendar files are generated locally for an already confirmed appointment.
// They do not send invitations or authorize access to another calendar.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?Z$/.test(value)) throw new TypeError('A UTC appointment time is required.');
  const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid appointment time.');
  return date;
}
const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const escapeText = value => String(value || '').replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
function fold(line) {
  const encoder = new TextEncoder(); let out = '', current = '', length = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) { out += current + '\r\n'; current = ' '; length = 1; }
    current += character; length += bytes;
  }
  return out + current;
}
export function createCalendarFile({ id, start, end, address = '', bufferMinutes = 0 }, now = new Date()) {
  if (!uuid.test(id || '')) throw new TypeError('A saved appointment ID is required.');
  const a = instant(start), b = instant(end);
  if (b <= a || b - a > 86400000 || !Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 180) throw new TypeError('Invalid appointment duration.');
  const finalEnd = new Date(b.getTime() + bufferMinutes * 60000);
  const description = bufferMinutes ? `Consultation ends at ${b.toISOString()}. Includes ${bufferMinutes} minutes reserved after the visit for travel. Contact Spray-Net South Charlotte to change this appointment.` : 'Contact Spray-Net South Charlotte to change this appointment.';
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Spray-Net South Charlotte//Consultations//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
    `UID:${id.toLowerCase()}@home-show.spray-net-south-charlotte`, `DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(a)}`,`DTEND:${stamp(finalEnd)}`,
    'SUMMARY:Spray-Net consultation',`LOCATION:${escapeText(address)}`,`DESCRIPTION:${escapeText(description)}`,
    'STATUS:CONFIRMED','TRANSP:OPAQUE','END:VEVENT','END:VCALENDAR',''].map(fold).join('\r\n');
}

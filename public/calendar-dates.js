const zone='America/New_York';
const partsFormat=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function easternParts(value) {
  const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new TypeError('Choose a valid calendar date.');
  return Object.fromEntries(partsFormat.formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
}
export function validateCalendarDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new TypeError('Choose a valid calendar date.');
  const date=new Date(value+'T12:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||value<'1970-01-01'||value>'2100-12-31')throw new TypeError('Choose a valid calendar date.');
  return value;
}
export function easternDay(value=Date.now()) {
  const p=easternParts(value);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
export function addCalendarDays(key,days) {
  validateCalendarDate(key);if(!Number.isInteger(days))throw new TypeError('Choose a whole number of days.');
  return validateCalendarDate(new Date(Date.parse(key+'T12:00:00Z')+days*86400000).toISOString().slice(0,10));
}
export function mondayOfWeek(value=Date.now()) {
  const key=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?validateCalendarDate(value):easternDay(value);
  return addCalendarDays(key,-((new Date(key+'T12:00:00Z').getUTCDay()+6)%7));
}
export function easternMidnight(key) {
  validateCalendarDate(key);const [year,month,day]=key.split('-').map(Number),target=Date.UTC(year,month-1,day);
  let instant=target;
  for(let attempt=0;attempt<4;attempt++) {
    const p=easternParts(instant),wall=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute),difference=target-wall;
    if(!difference)return new Date(instant).toISOString();instant+=difference;
  }
  throw new TypeError('That calendar day is unavailable.');
}
export function calendarWeekRange(week) {
  validateCalendarDate(week);if(mondayOfWeek(week)!==week)throw new TypeError('Choose a Monday for the calendar week.');
  return {week,start:easternMidnight(week),end:easternMidnight(addCalendarDays(week,7))};
}

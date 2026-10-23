import { addCalendarDays, calendarWeekRange, easternDay, easternMidnight, easternParts } from './calendar-dates.js';
const dateFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'long',day:'numeric',year:'numeric'});
const timeFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'});
export const calendarTime=value=>timeFormat.format(new Date(value));
export function calendarWeekLabel(week) {
  calendarWeekRange(week);
  return `${dateFormat.format(new Date(week+'T12:00:00Z'))} – ${dateFormat.format(new Date(addCalendarDays(week,6)+'T12:00:00Z'))}`;
}
export function directionsLink(address,origin='') {
  if(typeof address!=='string'||!address.trim())throw new TypeError('A project address is needed.');
  const url=new URL('https://www.google.com/maps/dir/');url.searchParams.set('api','1');
  url.searchParams.set('destination',address.trim());url.searchParams.set('travelmode','driving');
  if(typeof origin==='string'&&origin.trim())url.searchParams.set('origin',origin.trim());
  return url.href;
}
export function previousConsultation(appointment,bookings) {
  return bookings.filter(row=>row!==appointment && row.status==='confirmed' && row.address?.trim()
    && Date.parse(row.end)<=Date.parse(appointment.start) && easternDay(row.start)===easternDay(appointment.start))
    .sort((a,b)=>Date.parse(b.end)-Date.parse(a.end))[0]||null;
}

// Place overlapping records beside one another instead of covering a meeting
// with a travel hold. Abutting intervals can share the same lane.
export function calendarLanes(items) {
  const sorted=items.map(item=>({...item})).sort((a,b)=>a.startMinute-b.startMinute||b.endMinute-a.endMinute);
  let group=[],ends=[],groupEnd=-1;
  const finish=()=>{for(const item of group)item.columns=ends.length;group=[];ends=[];};
  for(const item of sorted) {
    if(group.length && item.startMinute>=groupEnd){finish();groupEnd=-1;}
    let lane=ends.findIndex(end=>end<=item.startMinute);if(lane<0)lane=ends.length;
    item.lane=lane;ends[lane]=item.endMinute;group.push(item);groupEnd=Math.max(groupEnd,item.endMinute);
  }
  finish();return sorted;
}
export function weekCalendarModel(schedule,week) {
  calendarWeekRange(week);
  const buffer=Number.isInteger(schedule.bufferMinutes)&&schedule.bufferMinutes>=0&&schedule.bufferMinutes<=180?schedule.bufferMinutes:30;
  const records=[];
  for(const [kind,rows] of [['booking',schedule.bookings||[]],['block',schedule.blocks||[]]])for(const record of rows) {
    const start=Date.parse(record.start),end=Date.parse(record.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new TypeError('The calendar returned an invalid time.');
    records.push({kind,record,start,end});
    if(buffer)records.push({kind:'travel',sourceKind:kind,record,start:end,end:end+buffer*60000});
  }
  const days=Array.from({length:7},(_,index)=>{
    const key=addCalendarDays(week,index),start=Date.parse(easternMidnight(key)),end=Date.parse(easternMidnight(addCalendarDays(key,1)));
    const items=records.filter(item=>item.start<end&&item.end>start).map(item=>{
      const first=Math.max(start,item.start),last=Math.min(end,item.end),p=easternParts(first),q=easternParts(last);
      const startMinute=first===start?0:p.hour*60+p.minute,endMinute=last===end?1440:q.hour*60+q.minute;
      return {...item,startMinute,endMinute:Math.max(startMinute+1,endMinute),allDay:item.kind==='block'&&first===start&&last===end};
    });
    return {key,items:calendarLanes(items.filter(item=>!item.allDay)),allDay:items.filter(item=>item.allDay)};
  });
  const timed=days.flatMap(day=>day.items),startMinute=Math.min(420,...timed.map(item=>Math.floor(item.startMinute/60)*60));
  const endMinute=Math.max(1200,...timed.map(item=>Math.ceil(item.endMinute/60)*60));
  return {days,startMinute,endMinute,bufferMinutes:buffer};
}

/** Render only private API data supplied by the signed-in owner page. No
 * calendar or maps provider is contacted by constructing this view. */
export function renderWeekCalendar(container,schedule,{week,onSelect,isActive=()=>true,today=easternDay()}={}) {
  const document=container.ownerDocument,model=weekCalendarModel(schedule,week),height=model.endMinute-model.startMinute;
  const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const grid=node('div','week-grid');grid.style.setProperty('--calendar-height',height+'px');
  const corner=node('div','week-corner','ET');corner.setAttribute('aria-label','Eastern Time');grid.append(corner);
  const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short'});
  const dayDate=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'});
  function event(item,allDay=false) {
    const {kind,record}=item,travel=kind==='travel',block=kind==='block'||item.sourceKind==='block';
    const title=travel?'Travel gap':block?(record.note||'Unavailable'):record.name||'Consultation';
    const when=allDay?'All day':`${calendarTime(item.start)}–${calendarTime(item.end)}`;
    const button=node('button',`week-event ${kind}${record.status==='pending'?' pending':''}${allDay?' all-day':''}`);
    button.type='button';button.setAttribute('data-action-button','');
    button.setAttribute('aria-label',`${title}, ${when}${record.address?', '+record.address:''}`);button.title=button.getAttribute('aria-label');
    button.append(node('strong','',title),node('span','',when));
    if(!travel&&!block&&record.address)button.append(node('span','week-event-address',record.address));
    if(!allDay) {
      button.style.top=(item.startMinute-model.startMinute)+'px';button.style.height=Math.max(29,item.endMinute-item.startMinute-2)+'px';
      button.style.left=`calc(${item.lane/item.columns*100}% + 2px)`;button.style.width=`calc(${100/item.columns}% - 4px)`;
    }
    button.addEventListener('click',()=>{if(isActive()&&container.isConnected)onSelect({kind:travel?item.sourceKind:kind,record});});
    return button;
  }
  for(const day of model.days) {
    const heading=node('div','week-day-heading'+(day.key===today?' today':'')),stamp=new Date(day.key+'T12:00:00Z');
    heading.append(node('span','',weekday.format(stamp)),node('strong','',dayDate.format(stamp)));
    for(const item of day.allDay)heading.append(event(item,true));grid.append(heading);
  }
  const axis=node('div','week-time-axis');axis.setAttribute('aria-hidden','true');
  for(let minute=model.startMinute;minute<model.endMinute;minute+=60) {
    const hour=minute/60,label=node('span','',`${hour%12||12} ${hour<12?'AM':'PM'}`);label.style.top=(minute-model.startMinute)+'px';axis.append(label);
  }
  grid.append(axis);
  for(const day of model.days) {
    const column=node('section','week-day');column.setAttribute('aria-label',day.key);
    for(const item of day.items)column.append(event(item));grid.append(column);
  }
  container.replaceChildren(grid);return model;
}

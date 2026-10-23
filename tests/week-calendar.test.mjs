import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mondayOfWeek, easternDay, addCalendarDays, easternMidnight, calendarWeekRange } from '../public/calendar-dates.js';
import { weekCalendarModel, calendarLanes, directionsLink, previousConsultation, renderWeekCalendar } from '../public/week-calendar.js';
const booking={leadId:'00000000-0000-4000-8000-000000000001',name:'Alex Homeowner',phone:'7045550101',email:'alex@example.com',
  address:'101 Main St, Belmont, NC 28012',status:'confirmed',start:'2026-10-26T14:00:00.000Z',end:'2026-10-26T15:30:00.000Z'};
const schedule={bufferMinutes:30,bookings:[booking],blocks:[]};

test('calendar navigation uses Eastern dates and Monday weeks even across midnight, months and DST',()=>{
  assert.equal(easternDay('2026-10-26T02:00:00Z'),'2026-10-25');assert.equal(mondayOfWeek('2026-10-26T02:00:00Z'),'2026-10-19');
  assert.equal(mondayOfWeek('2026-11-01'),'2026-10-26');assert.equal(addCalendarDays('2026-10-26',7),'2026-11-02');
  const fall=calendarWeekRange('2026-10-26'),spring=calendarWeekRange('2026-03-02');
  assert.equal(fall.start,'2026-10-26T04:00:00.000Z');assert.equal(fall.end,'2026-11-02T05:00:00.000Z');
  assert.equal((Date.parse(fall.end)-Date.parse(fall.start))/3600000,169);
  assert.equal((Date.parse(spring.end)-Date.parse(spring.start))/3600000,167);
  assert.equal(easternMidnight('2026-11-01'),'2026-11-01T04:00:00.000Z');
  assert.equal(easternMidnight('2026-11-02'),'2026-11-02T05:00:00.000Z');
  for(const invalid of ['2026-02-30','2026-10-27','anything','2026-10-26T00:00:00Z',null])assert.throws(()=>calendarWeekRange(invalid));
});

test('week model shows the full staff reservation and separate 30-minute travel gap at the right wall-clock hours',()=>{
  for(const [week,start,end,index] of [['2026-10-26',booking.start,booking.end,0],['2026-11-02','2026-11-08T15:00:00Z','2026-11-08T16:30:00Z',6]]) {
    const model=weekCalendarModel({...schedule,bookings:[{...booking,start,end}]},week),items=model.days[index].items;
    assert.equal(model.days.length,7);assert.deepEqual(items.map(item=>[item.kind,item.startMinute,item.endMinute]),[['booking',600,690],['travel',690,720]]);
    assert.equal(model.days.filter(day=>day.items.length).length,1);assert.equal(model.bufferMinutes,30);
  }
});

test('overnight and all-day staff blocks clip to each Eastern day, including travel that spills across a week boundary',()=>{
  const block={id:'block',note:'Outside commitment',start:'2026-10-25T04:00:00Z',end:'2026-10-28T04:00:00Z'};
  const model=weekCalendarModel({bookings:[],blocks:[block],bufferMinutes:30},'2026-10-26');
  assert.equal(model.days[0].allDay.length,1);assert.equal(model.days[1].allDay.length,1);
  assert.deepEqual(model.days[2].items.map(item=>[item.kind,item.startMinute,item.endMinute]),[['travel',0,30]]);
  const spill=weekCalendarModel({bookings:[],blocks:[{...block,start:'2026-10-26T02:45:00Z',end:'2026-10-26T03:45:00Z'}],bufferMinutes:30},'2026-10-26');
  assert.deepEqual(spill.days[0].items.map(item=>[item.kind,item.startMinute,item.endMinute]),[['travel',0,15]]);
});

test('overlapping calendar items occupy separate lanes while touching reservations use the available lane',()=>{
  const items=[{id:'a',startMinute:600,endMinute:690},{id:'b',startMinute:630,endMinute:660},
    {id:'c',startMinute:660,endMinute:720},{id:'d',startMinute:720,endMinute:750}];
  const result=calendarLanes(items),a=result.find(item=>item.id==='a'),b=result.find(item=>item.id==='b'),c=result.find(item=>item.id==='c'),d=result.find(item=>item.id==='d');
  assert.notEqual(a.lane,b.lane);assert.equal(b.lane,c.lane);assert.equal(a.columns,2);assert.equal(c.columns,2);assert.equal(d.columns,1);
  assert.equal(items[0].lane,undefined);
});

test('directions safely encode addresses and only offer a previous confirmed consultation on the same Eastern day',()=>{
  const current={...booking,start:'2026-10-26T18:00:00Z',end:'2026-10-26T19:30:00Z'};
  const earlier={...booking,address:'2 A&B St #3?origin=other'},priorDay={...booking,start:'2026-10-25T14:00:00Z',end:'2026-10-25T15:30:00Z'};
  assert.equal(previousConsultation(current,[priorDay,{...earlier,status:'pending'},earlier,current]),earlier);
  assert.equal(previousConsultation(current,[priorDay,current]),null);
  const url=new URL(directionsLink(current.address,earlier.address));assert.equal(url.origin,'https://www.google.com');
  assert.equal(url.searchParams.get('api'),'1');assert.equal(url.searchParams.get('destination'),current.address);
  assert.equal(url.searchParams.get('origin'),earlier.address);assert.equal(url.searchParams.get('travelmode'),'driving');
  assert.throws(()=>directionsLink(''));assert.equal(new URL(directionsLink(current.address)).searchParams.has('origin'),false);
});

function fixture() {
  const document={createElement:tag=>new Element(tag)};
  class Element extends EventTarget {
    constructor(tag){super();this.tagName=tag;this.ownerDocument=document;this.children=[];this.attributes=new Map();this.style={setProperty:(key,value)=>{this.style[key]=value;}};this._text='';}
    append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}
    replaceChildren(...items){this.children=[];this.append(...items);}
    setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key)??null;}
    get isConnected(){return this===mount||Boolean(this.parentNode?.isConnected);}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set innerHTML(_){throw new Error('Calendar data must stay text.');}
  }
  const mount=new Element('main'),container=new Element('div');mount.append(container);
  const all=(root=container)=>[root,...root.children.flatMap(child=>all(child))];
  return {container,all};
}
test('weekly view renders seven headings, handles appointment and travel clicks, and ignores stale signed-out controls',()=>{
  const view=fixture(),clicks=[];let active=true;
  renderWeekCalendar(view.container,{...schedule,bookings:[{...booking,name:'<img src=x onerror=alert(1)>'}]},
    {week:'2026-10-26',today:'2026-10-26',isActive:()=>active,onSelect:entry=>clicks.push(entry)});
  assert.equal(view.all().filter(node=>node.className?.startsWith('week-day-heading')).length,7);
  const buttons=view.all().filter(node=>node.tagName==='button');assert.equal(buttons.length,2);
  assert.ok(buttons[0].textContent.includes('<img src=x onerror=alert(1)>'));assert.equal(buttons[0].style.top,'180px');
  buttons[0].dispatchEvent(new Event('click'));buttons[1].dispatchEvent(new Event('click'));
  assert.deepEqual(clicks.map(entry=>entry.kind),['booking','booking']);assert.equal(clicks[0].record.address,booking.address);
  active=false;buttons[0].dispatchEvent(new Event('click'));assert.equal(clicks.length,2);
});

test('tablet confirmation has only the public QR and top reset; all retained app ID selectors still exist',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="public-mobile-qr"/);assert.match(html,/id="header-reset"[^>]*tablet-only/);
  assert.doesNotMatch(html,/id="(?:private-project-qr|copy-project-link|next-visitor)"/);
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
  for(const match of app.matchAll(/['"]#([\w-]+)['"]/g))assert.ok(ids.has(match[1]),`Missing app element: ${match[1]}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarFile} from '../public/calendar.js';
const appointment = {id:'12345678-1234-4123-8123-123456789012',start:'2026-11-02T14:00:00.000Z',end:'2026-11-02T15:30:00.000Z'};
test('calendar file uses UTC across daylight saving and offers a separate staff travel hold',()=>{
 const visitor=createCalendarFile(appointment,new Date('2026-10-22T12:00:00Z'));
 assert.match(visitor,/DTSTART:20261102T140000Z/);assert.match(visitor,/DTEND:20261102T153000Z/);
 const staff=createCalendarFile({...appointment,bufferMinutes:30});assert.match(staff,/DTEND:20261102T160000Z/);
 assert.doesNotMatch(visitor,/ATTENDEE|ORGANIZER|METHOD:REQUEST/);
});
test('calendar text cannot inject an event or invitation and UTF-8 lines fold safely',()=>{
 const text=createCalendarFile({...appointment,address:'House; One, café\nATTENDEE:attacker@example.com\r\n'+ '庭'.repeat(100)});
 assert.match(text,/House\\; One\\, café\\nATTENDEE/);assert.equal((text.match(/BEGIN:VEVENT/g)||[]).length,1);
 for(const line of text.split('\r\n'))assert.ok(new TextEncoder().encode(line).length<=75);
 assert.throws(()=>createCalendarFile({...appointment,id:'invalid'}));assert.throws(()=>createCalendarFile({...appointment,end:appointment.start}));
 assert.throws(()=>createCalendarFile({...appointment,start:'2026-11-02T09:00:00-05:00'}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationEmail, confirmationEmailDraft, confirmationPhone, confirmationText } from '../public/confirmation-email.js';
import { createConfirmationTools } from '../public/confirmation-tools.js';

const appointment={name:'Alex Homeowner',phone:'(704) 555-0101',email:'alex+show@example.com',address:'101 Main St, Belmont, NC 28012',
  status:'confirmed',start:'2026-11-08T15:00:00.000Z',end:'2026-11-08T16:30:00.000Z',token:'private-project-token'};

test('email and SMS drafts agree on Eastern date and one-hour customer times on both sides of DST',()=>{
  for(const [start,end,date] of [['2026-10-26T14:00:00.000Z','2026-10-26T15:30:00.000Z','October 26, 2026'],
    ['2026-11-08T15:00:00.000Z','2026-11-08T16:30:00.000Z','November 8, 2026']]) {
    const booking={...appointment,start,end},email=confirmationEmail(booking),text=confirmationText(booking);
    assert.match(email.body,/Hi Alex,/);assert.ok(email.body.includes(date));
    for(const draft of [email,text]) {
      assert.match(draft.body,/10:00 AM–11:00 AM Eastern Time/);assert.ok(draft.body.includes(booking.address));
      assert.doesNotMatch(draft.body,/private-project-token|90.minute|travel|buffer/i);
    }
    assert.equal(booking.end,end);
  }
});

test('message URIs encode recipients, subject and text without creating extra headers or SMS recipients',()=>{
  const special={...appointment,name:'Alex & Friends',address:'101 A&B St #2?bcc=other@example.com'};
  const email=confirmationEmail(special),url=new URL(email.href),text=confirmationText(special),sms=new URL(text.href);
  assert.equal(decodeURIComponent(url.pathname),special.email);assert.equal(url.searchParams.get('subject'),email.subject);
  assert.equal(url.searchParams.get('body'),email.body);assert.deepEqual([...url.searchParams.keys()],['subject','body']);
  assert.equal(confirmationEmailDraft(special),email.href);assert.equal(sms.pathname,'+17045550101');
  assert.equal(sms.searchParams.get('body'),text.body);assert.deepEqual([...sms.searchParams.keys()],['body']);
  assert.doesNotMatch(email.href+text.href,/private-project-token/);
});

test('SMS normalizes one US number and rejects invalid numbers, multiple recipients and scheme/query injection',()=>{
  for(const value of ['7045550101','704-555-0101','(704) 555-0101','1 704 555 0101','+1 (704) 555-0101'])assert.equal(confirmationPhone(value),'+17045550101');
  for(const value of [null,'','704','+447123456789','++17045550101','7045550101,7045550102','7045550101;7045550102',
    '7045550101?body=other','sms:7045550101','7045550101\r\n','7045550101 ext 5'])assert.throws(()=>confirmationPhone(value));
  for(const value of ['alex@example.com\r\nBcc:other@example.com','alex@example.com\0','not-an-email'])
    assert.throws(()=>confirmationEmail({...appointment,email:value}));
});

test('iPhone and touch iPad compose links use their separator while Android and desktop use the standard SMS URI',()=>{
  for(const device of [{userAgent:'Mozilla iPhone'}, {userAgent:'Mozilla iPad'}, {platform:'MacIntel',maxTouchPoints:5}]) {
    const draft=confirmationText(appointment,device);assert.ok(draft.href.startsWith('sms:+17045550101&body='));
    assert.equal(decodeURIComponent(draft.href.split('&body=')[1]),draft.body);
  }
  for(const device of [{userAgent:'Mozilla Android'}, {platform:'MacIntel',maxTouchPoints:0}, {}])
    assert.ok(confirmationText(appointment,device).href.startsWith('sms:+17045550101?body='));
});

// Component events execute in an in-memory DOM fixture. No browser, messaging
// handler or customer endpoint is opened, and no message is sent by these tests.
function fixture(booking=appointment,clipboard) {
  let permitted=true;
  const document={createElement:tag=>new Element(tag)};
  class Element extends EventTarget {
    constructor(tag){super();this.tagName=tag;this.children=[];this.attributes=new Map();this.parentNode=null;this.value='';this._text='';}
    setAttribute(key,value){this.attributes.set(key,String(value));}
    getAttribute(key){return this.attributes.get(key)??null;}
    append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set textContent(text){this._text=String(text);this.children=[];}
    get isConnected(){return this===mount || Boolean(this.parentNode?.isConnected);}
    focus(){this.focused=true;}
    select(){this.selected=true;}
    set innerHTML(_){throw new Error('Drafts must be inserted as text, never HTML.');}
  }
  const mount=new Element('main'),root=createConfirmationTools(booking,{document,clipboard,isActive:()=>permitted});
  if(root)mount.append(root);
  const all=(node=root)=>node?[node,...node.children.flatMap(child=>all(child))]:[];
  const find=text=>all().find(node=>['button','a'].includes(node.tagName) && node.textContent===text);
  const click=target=>{const event=new Event('click',{cancelable:true});target.dispatchEvent(event);return event;};
  return {root,all,find,click,lock:()=>{permitted=false;},detach:()=>{if(root)root.parentNode=null;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('confirmed booking cards expose email/text drafts and read-only copyable messages without sending',async()=>{
  const writes=[],view=fixture(appointment,{writeText:async value=>writes.push(value)});
  assert.ok(view.find('Draft email').href.startsWith('mailto:'));assert.ok(view.find('Draft text').href.startsWith('sms:'));
  assert.equal(view.click(view.find('Draft email')).defaultPrevented,false);
  const status=view.all().find(node=>node.getAttribute('role')==='status');
  assert.match(status.textContent,/ben.hessler@spray-net.com/);assert.doesNotMatch(status.textContent,/email sent/i);
  assert.equal(writes.length,0);view.click(view.find('Copy text message'));await settle();
  assert.deepEqual(writes,[confirmationText(appointment).body]);assert.match(status.textContent,/Copied/);
  for(const input of view.all().filter(node=>['input','textarea'].includes(node.tagName)))assert.equal(input.readOnly,true);
});

test('missing or denied clipboard selects the appropriate message for manual copying',async()=>{
  for(const clipboard of [undefined,{writeText:async()=>{throw new Error('Denied');}}]) {
    const view=fixture(appointment,clipboard);view.click(view.find('Copy text message'));await settle();
    const selected=view.all().find(node=>node.selected);
    assert.equal(selected.value,confirmationText(appointment).body);assert.equal(selected.focused,true);
    assert.equal(view.all().find(node=>node.tagName==='details').open,true);
    assert.match(view.all().find(node=>node.getAttribute('role')==='status').textContent,/Copy the selected text/);
  }
});

test('pending/cancelled leads cannot prepare a confirmation, and one missing contact channel does not disable the other',()=>{
  for(const status of ['none','pending','cancelled',undefined])assert.equal(fixture({...appointment,status}).root,null);
  const noEmail=fixture({...appointment,email:''});assert.equal(noEmail.find('Draft email'),undefined);assert.ok(noEmail.find('Draft text'));
  const noPhone=fixture({...appointment,phone:''});assert.equal(noPhone.find('Draft text'),undefined);assert.ok(noPhone.find('Draft email'));
  const badTime=fixture({...appointment,end:appointment.start});assert.equal(badTime.find('Draft text'),undefined);assert.equal(badTime.find('Draft email'),undefined);
});

test('stale or signed-out draft controls cannot open apps, copy customer details or restore status after an async copy',async()=>{
  let writes=0,finish;
  const view=fixture(appointment,{writeText:()=>{writes++;return new Promise(resolve=>{finish=resolve;});}});
  view.click(view.find('Copy email message'));assert.equal(writes,1);
  view.lock();view.detach();finish();await settle();
  const status=view.all().find(node=>node.getAttribute('role')==='status');assert.equal(status.hidden,true);assert.equal(status.textContent,'');
  assert.equal(view.click(view.find('Draft text')).defaultPrevented,true);assert.equal(view.click(view.find('Draft email')).defaultPrevented,true);
  view.click(view.find('Copy text message'));assert.equal(writes,1);
});

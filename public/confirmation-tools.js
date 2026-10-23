import { confirmationEmail, confirmationText, CONFIRMATION_SENDER } from './confirmation-email.js';
const draftViews=new WeakMap();
const draftTime=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
export function updateConfirmationDrafts(root,drafts) {draftViews.get(root)?.(drafts);}

/** Manual confirmation actions shared by lead and calendar cards. Creating or
 * opening a draft does not send it or record a delivery. No provider is called. */
export function createConfirmationTools(appointment, {document, device={}, clipboard, isActive=()=>true,onDraft}={}) {
  if (appointment?.status !== 'confirmed') return null;
  const node=(tag,className,text)=>{
    const result=document.createElement(tag);
    if(className)result.className=className;
    if(text!==undefined)result.textContent=text;
    return result;
  };
  const root=node('section','confirmation-tools');root.setAttribute('aria-label','Consultation confirmation drafts');
  root.setAttribute('data-confirmation-lead',appointment.leadId||appointment.id||'');
  root.setAttribute('data-confirmation-version',appointment.draftVersion||'');
  root.append(node('h4','','Send confirmation'));
  const actions=node('div','confirmation-actions'),preview=node('details','confirmation-preview');
  const status=node('p','confirmation-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  status.hidden=true;
  const active=()=>root.isConnected && isActive();
  const feedback=text=>{if(active()){status.textContent=text;status.hidden=false;}};
  const links=new Map(),saved={},pending=new Set(),history=node('p','confirmation-draft-history');history.hidden=true;
  function update(drafts={}) {
    for(const channel of ['email','sms']) {
      const stamp=drafts[channel];if(typeof stamp==='string'&&Number.isFinite(Date.parse(stamp)))saved[channel]=stamp;
      const link=links.get(channel);if(!link)continue;
      const label=channel==='email'?'Email':'Text',drafted=Boolean(saved[channel]),saving=pending.has(channel)&&!drafted;
      link.textContent=drafted?`${label} drafted`:saving?`${label} drafted · saving…`:`Draft ${channel==='email'?'email':'text'}`;
      link.className='button small'+(drafted?' drafted':saving?' draft-saving':'');
      link.setAttribute('aria-label',drafted?`${label} drafted. Open another draft.`:link.textContent);
      link.title=drafted?`Draft first opened ${draftTime.format(new Date(saved[channel]))} Eastern. Click to open again.`:'';
    }
    history.textContent=['email','sms'].filter(channel=>saved[channel]).map(channel=>`${channel==='email'?'Email':'Text'} drafted ${draftTime.format(new Date(saved[channel]))} ET`).join(' · ');
    history.hidden=!history.textContent;
  }
  draftViews.set(root,update);
  async function recordDraft(channel) {
    if(typeof onDraft!=='function'||pending.has(channel)||saved[channel])return;
    pending.add(channel);update();
    try{const drafts=await onDraft(channel);if(active())update(drafts);}
    catch{if(active())feedback('The draft was requested, but its marker could not be saved. Open the draft again when connected to save the marker.');}
    finally{pending.delete(channel);if(active())update();}
  }
  preview.append(node('summary','','View or copy messages'));
  function field(label,value,multiline=false) {
    const wrap=node('label','confirmation-field');wrap.append(node('span','',label));
    const input=node(multiline?'textarea':'input');input.value=value;input.readOnly=true;
    if(multiline)input.rows=5;else input.type='text';
    input.spellcheck=false;input.setAttribute('autocomplete','off');wrap.append(input);return {wrap,input};
  }
  function copyButton(label,input) {
    const button=node('button','button secondary small',label);button.type='button';button.setAttribute('data-action-button','');
    button.addEventListener('click',async()=>{
      if(!active())return;
      try {
        if(!clipboard?.writeText)throw new Error('COPY_UNAVAILABLE');
        await clipboard.writeText(input.value);
        feedback('Copied. Paste into your message, review it, and send.');
      } catch {
        if(!active())return;
        preview.open=true;input.focus();input.select();
        feedback('Copy the selected text, then paste it into your message.');
      }
    });
    return button;
  }
  let email=null,text=null;
  try {email=confirmationEmail(appointment);}catch{}
  try {text=confirmationText(appointment,device);}catch{}
  function draftLink(channel,label,draft,help) {
    const link=node('a','button small',label);link.href=draft.href;
    link.addEventListener('click',event=>{
      if(!active()){event.preventDefault();return;}
      feedback(help);
      void recordDraft(channel);
    });
    links.set(channel,link);
    actions.append(link);
  }
  if(email) {
    draftLink('email','Draft email',email,`Review and send in your email app. Choose ${CONFIRMATION_SENDER} as the sender. If it did not open, use View or copy messages below.`);
    const group=node('div','confirmation-message');
    const to=field('Email recipient',email.to),subject=field('Email subject',email.subject),body=field('Email message',email.body,true);
    const copies=node('div','confirmation-copy-actions');copies.append(copyButton('Copy email',to.input),copyButton('Copy subject',subject.input),copyButton('Copy email message',body.input));
    group.append(to.wrap,subject.wrap,body.wrap,copies);preview.append(group);
  }
  if(text) {
    draftLink('sms','Draft text',text,'Review and send in your phone’s messaging app using your personal line. If the message is blank or did not open, use View or copy messages below.');
    const group=node('div','confirmation-message');
    const to=field('Text recipient',text.to),body=field('Text message',text.body,true);
    const copies=node('div','confirmation-copy-actions');copies.append(copyButton('Copy phone',to.input),copyButton('Copy text message',body.input));
    group.append(to.wrap,body.wrap,copies);preview.append(group);
  }
  update(appointment.confirmationDrafts||{});
  root.append(actions,history,node('p','confirmation-help',`Drafted records opening a draft. Review and send from your own apps. For email, choose ${CONFIRMATION_SENDER}; texts use the line selected on your phone.`));
  if(!email)root.append(node('p','confirmation-help','A valid customer email is needed for an email draft.'));
  if(!text)root.append(node('p','confirmation-help','A valid US customer phone is needed for a text draft.'));
  if(email||text)root.append(preview);
  root.append(status);return root;
}

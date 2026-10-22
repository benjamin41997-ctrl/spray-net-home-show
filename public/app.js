import {COLORS,MAX_PHOTOS,validatePhoto,safeApiBase,privateMediaUrl,contactValues} from './lib.js';
const config=window.SPRAYNET_CONFIG||{};
const $=(s)=>document.querySelector(s);
const $$=(s)=>[...document.querySelectorAll(s)];
const form=$('#lead-form');const alertBox=$('#form-alert');
const state={step:0,photos:[],lead:null,remaining:config.freeRenders??3,selectedPhoto:0,color:0,ready:false,renderAvailable:false,busy:false,urls:new Set()};
let apiBase='';
const STORAGE_KEY='spraynet-home-show-session-v1';
function readSession(){try{return JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null');}catch{return null;}}
function saveSession(extra={}){try{sessionStorage.setItem(STORAGE_KEY,JSON.stringify({...readSession(),...extra}));}catch{}}
function leadToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
async function restoreSession(){
 const saved=readSession();if(!saved||saved.apiBase!==apiBase)return;
 try{
  if(saved.pendingLead){const p=saved.pendingLead;const lead=await request('/api/leads',{method:'POST',body:p.payload,headers:{'X-Lead-Token':p.token,'Idempotency-Key':p.key}});state.lead=lead;saveSession({lead,pendingLead:null});}
  else if(saved.lead)state.lead=saved.lead;
  if(!state.lead)return;
  const session=await request('/api/leads/'+state.lead.id+'/session',{token:state.lead.token});state.remaining=session.remainingRenders;state.pendingRender=saved.pendingRender||null;setStep(2);$('#remaining-renders').textContent=String(state.remaining);
  for(const photo of session.photos||[]){try{state.photos.push({file:null,url:await fetchPrivateImage(photo.url),remote:photo});}catch{}}
  studioPhotos();
  for(const result of session.renders||[]){if(result.status==='completed'){try{await showRender(result,{name:result.colorName||'Your color'});}catch{state.completedRender={result,color:{name:result.colorName||'Your color'}};$('#retry-image').hidden=false;}}}
  if(state.pendingRender)$('#render-status').textContent='A previous visualization request needs checking. Use the button below to resume it.';
  $('#render-button').disabled=state.remaining<=0&&!state.pendingRender;
  if(!state.renderAvailable){$('#studio-message').textContent='Your project is saved. Rendering is currently unavailable.';$('#render-button').disabled=true;}
 }catch{message('Your previous project could not be reopened. Please ask the team for help; avoid submitting the same details again.');}
}

function message(text=''){alertBox.textContent=text;alertBox.hidden=!text;if(text)alertBox.scrollIntoView({block:'nearest',behavior:'smooth'});}
function objectUrl(blob){const url=URL.createObjectURL(blob);state.urls.add(url);return url;}
function release(url){URL.revokeObjectURL(url);state.urls.delete(url);}
function buttonBusy(button,busy,label){button.disabled=busy;if(busy){button.dataset.label=button.innerHTML;button.textContent=label;}else if(button.dataset.label){button.innerHTML=button.dataset.label;delete button.dataset.label;}}
function setStep(step){state.step=step;$$('[data-step]').forEach(el=>el.hidden=Number(el.dataset.step)!==step);$$('[data-progress]').forEach(el=>{const n=Number(el.dataset.progress);el.classList.toggle('active',n===step);el.classList.toggle('done',n<step);if(n===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});form.hidden=step===2;message();const title=$(`[data-step="${step}"] h3`);title?.focus({preventScroll:true});$('#project').scrollIntoView({block:'start',behavior:'smooth'});}
async function request(path,{method='GET',body,token,headers={},timeout=30000}={}){
  if(!apiBase)throw new Error('This is a design preview. Live lead capture and rendering have not been connected. Nothing has been submitted.');
  const opts={method,headers:{...headers},signal:AbortSignal.timeout(timeout)};
  if(token)opts.headers.Authorization=`Bearer ${token}`;
  if(body instanceof FormData)opts.body=body;else if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
  const res=await fetch(`${apiBase}${path}`,opts);let data;
  try{data=await res.json();}catch{throw new Error('Our project connection returned an unreadable response. Please ask the booth team for help.');}
  if(!res.ok){const err=new Error(data.error?.message||data.error||'We could not save that request. Please try again.');err.status=res.status;err.code=data.error?.code;throw err;}
  return data;
}
function safeLink(value){if(!value)return '';try{const u=new URL(value);return u.protocol==='https:'?u.href:'';}catch{return '';}}
async function connect(){
  try{apiBase=safeApiBase(config.apiBase,location.origin);if(!apiBase)return;const health=await request('/api/health');state.ready=health.ready===true;state.renderAvailable=health.renderAvailable===true;state.remaining=health.freeRenders??state.remaining;$$('[data-render-count]').forEach(el=>el.textContent=String(state.remaining));const banner=$('#connection-banner');banner.textContent=state.ready?(state.renderAvailable?'Home show color studio · 3 free visualizations for your project':'Project requests are open · color rendering is currently unavailable'):'Design preview · the project connection is not ready to accept submissions.';banner.classList.toggle('live',state.ready);if(state.ready)await restoreSession();}
  catch{state.ready=false;$('#connection-banner').textContent='Our project connection is unavailable. Please speak with the team at the booth. Nothing has been submitted.';}
}
$$('[data-location]').forEach(el=>el.textContent=config.location||'South Charlotte');
$$('[data-render-count]').forEach(el=>el.textContent=String(state.remaining));
if(safeLink(config.portfolioUrl))$('#portfolio-link').href=config.portfolioUrl;
if(safeLink(config.bookingUrl)){$('#booking-link').href=config.bookingUrl;$('#booking-link').hidden=false;$('#booking-link').target='_blank';$('#booking-link').rel='noopener';}
if(safeLink(config.privacyUrl)){const a=document.createElement('a');a.href=config.privacyUrl;a.textContent='Read the full privacy policy';a.target='_blank';a.rel='noopener';$('#privacy-extra').append(a);}
const range=$('#comparison-range');range.addEventListener('input',()=>{const value=Number(range.value);$('#before-layer').style.clipPath=`inset(0 ${100-value}% 0 0)`;$('#comparison-divider').style.left=`${value}%`;});
function photoPreviews(){
  const area=$('#photo-previews');area.replaceChildren();
  state.photos.forEach((p,i)=>{const tile=document.createElement('div');tile.className='photo-tile';const img=document.createElement('img');img.src=p.url;img.alt=`Project photo ${i+1}`;const b=document.createElement('button');b.type='button';b.textContent='×';b.setAttribute('aria-label',`Remove project photo ${i+1}`);b.addEventListener('click',()=>{release(p.url);state.photos.splice(i,1);photoPreviews();});tile.append(img,b);area.append(tile);});
}
async function addPhotos(files){
  if(state.busy){message('Please wait for your current request to finish before adding photos.');return;}message();for(const file of files){if(state.photos.length>=MAX_PHOTOS){message('You can add up to 3 photos. Remove one to choose another.');break;}const error=validatePhoto(file);if(error){message(error);continue;}const url=objectUrl(file);
    try{const img=new Image();img.src=url;await img.decode();if(img.width*img.height>50000000)throw new Error('That photo is very large. Please choose a smaller version.');state.photos.push({file,url,remote:null});}catch(err){release(url);message(err.message==='That photo is very large. Please choose a smaller version.'?err.message:'That file could not be opened as a photo. Please try another JPG, PNG, or WebP.');}
  }photoPreviews();if(state.step===2){studioPhotos();if(state.lead){state.busy=true;for(const photo of state.photos.filter(p=>!p.remote)){try{const body=new FormData();body.append('photo',photo.file);photo.remote=await request('/api/leads/'+state.lead.id+'/photos',{method:'POST',body,token:state.lead.token});}catch{message('Your project is saved, but a photo could not upload. Please keep this page open and retry your visualization.');}}state.busy=false;}}
}
$('#photos').addEventListener('change',async e=>{await addPhotos(e.target.files);e.target.value='';});
$('#studio-photo').addEventListener('change',async e=>{await addPhotos(e.target.files);e.target.value='';});
const drop=$('#upload-zone');for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('dragover');});for(const type of ['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragover');});drop.addEventListener('drop',e=>addPhotos(e.dataTransfer.files));
$('#to-details').addEventListener('click',()=>{if(!form.querySelector('[name=service]:checked')){message('Choose the type of project you’re considering.');form.querySelector('[name=service]').focus();return;}setStep(1);});
$('#back-project').addEventListener('click',()=>setStep(0));
if('contacts' in navigator && 'ContactsManager' in window){const b=$('#share-contact');b.hidden=false;b.addEventListener('click',async()=>{try{const available=await navigator.contacts.getProperties();const props=['name','email','tel','address'].filter(p=>available.includes(p));const contacts=await navigator.contacts.select(props,{multiple:false});if(!contacts.length)return;const values=contactValues(contacts[0]);for(const [name,value]of Object.entries(values)){const field=form.elements.namedItem(name);if(field&&value){if(name==='state'){const v=value.toUpperCase();field.value=v==='NORTH CAROLINA'?'NC':v==='SOUTH CAROLINA'?'SC':v;}else field.value=value;}}message('Contact details added. Please check them and use the project’s address.');}catch(e){if(e.name!=='AbortError')message('Saved contact sharing isn’t available here. You can use your keyboard’s autofill or enter your details below.');}});}
function validateDetails(){for(const el of $$('[data-step="1"] input,[data-step="1"] select,[data-step="1"] textarea')){if(!el.checkValidity()){el.reportValidity();el.focus();return false;}}return true;}
form.addEventListener('submit',async e=>{
  e.preventDefault();if(state.busy)return;if(state.step!==1||!validateDetails())return;
  if(!state.ready){message(apiBase?'The project connection is not ready. Your information has not been submitted. Please ask the booth team for help.':'This is a design preview. Live lead capture and rendering have not been connected. Your information has not been submitted.');return;}
  const submit=$('#submit-lead');state.busy=true;buttonBusy(submit,true,'Saving your project…');message();
  try{
    const payload=Object.fromEntries(new FormData(form));payload.contactConsent=form.elements.contactConsent.checked;payload.event=config.event||'Home Show';
    const prior=readSession();let pending=prior?.apiBase===apiBase?prior.pendingLead:null;
    if(pending&&JSON.stringify(pending.payload)!==JSON.stringify(payload))throw new Error('A previous submission needs checking. Restore the original details or reload this page to recover that request before changing them.');
    if(!pending)pending={key:crypto.randomUUID(),token:leadToken(),payload};saveSession({apiBase,pendingLead:pending});
    const lead=await request('/api/leads',{method:'POST',body:payload,headers:{'Idempotency-Key':pending.key,'X-Lead-Token':pending.token}});
    if(!lead.id||!lead.token)throw new Error('We could not confirm your saved project. Please ask the team to check before submitting again.');
    state.lead=lead;saveSession({lead,pendingLead:null});state.remaining=lead.remainingRenders;setStep(2);$('#remaining-renders').textContent=String(state.remaining);$('#surface').value=payload.service==='Kitchen cabinets'?'Cabinets':payload.service==='Doors and windows'?'Front door':'Exterior siding';studioPhotos();
    let failedUploads=0;$('#render-status').textContent=state.photos.length?'Saving your project photos…':'';
    for(const photo of state.photos){try{const body=new FormData();body.append('photo',photo.file);photo.remote=await request('/api/leads/'+lead.id+'/photos',{method:'POST',body,token:lead.token});}catch{failedUploads++;}}
    $('#render-status').textContent='';if(failedUploads)message('Your project is saved, but '+failedUploads+' photo(s) could not upload. Keep this page open and try creating a visualization to retry the selected photo.');
    if(!state.renderAvailable){$('#studio-message').textContent='Your project is saved. Our team will follow up. Color rendering is currently unavailable.';$('#render-button').disabled=true;}
  }
  catch(err){if(err.status===400||err.status===422)saveSession({pendingLead:null});message(err.name==='TimeoutError'?'The connection timed out. Reload this page to recover the same saved request; your three-render allowance will stay with your project.':err.message);}finally{state.busy=false;buttonBusy(submit,false);}
});
function studioPhotos(){const area=$('#studio-photo-list');area.replaceChildren();if(state.selectedPhoto>=state.photos.length)state.selectedPhoto=0;state.photos.forEach((p,i)=>{const b=document.createElement('button');b.type='button';b.className='studio-photo-option';b.setAttribute('aria-label',`Use project photo ${i+1}`);b.setAttribute('aria-pressed',String(i===state.selectedPhoto));const img=document.createElement('img');img.src=p.url;img.alt=`Project photo ${i+1}`;b.append(img);b.addEventListener('click',()=>{state.selectedPhoto=i;studioPhotos();});area.append(b);});}
function colorOptions(){const area=$('#color-options');area.replaceChildren();COLORS.forEach((c,i)=>{const b=document.createElement('button');b.type='button';b.className='color-choice';b.setAttribute('aria-pressed',String(state.color===i));b.style.setProperty('--swatch',c.hex);const swatch=document.createElement('span');swatch.setAttribute('aria-hidden','true');b.append(swatch,document.createTextNode(c.name));b.addEventListener('click',()=>{state.color=i;colorOptions();});area.append(b);});}
async function fetchPrivateImage(path){const url=privateMediaUrl(path,apiBase,location.origin);const res=await fetch(url,{headers:{Authorization:`Bearer ${state.lead.token}`},signal:AbortSignal.timeout(30000)});if(!res.ok)throw new Error('Your visualization was created, but the image could not be downloaded. Please ask the team to help retrieve it.');const blob=await res.blob();if(!blob.type.startsWith('image/'))throw new Error('The image could not be displayed. Please ask the team for help.');return objectUrl(blob);}
async function showRender(result,color){const url=await fetchPrivateImage(result.imageUrl);const fig=document.createElement('figure');fig.className='render-result';const img=document.createElement('img');img.src=url;img.alt=`AI color visualization in ${color.name}`;const caption=document.createElement('figcaption');const label=document.createElement('span');label.textContent=`${color.name} · AI visualization`;const download=document.createElement('a');download.href=url;download.download=`spray-net-${color.name.toLowerCase().replaceAll(' ','-')}.jpg`;download.textContent='Save image ↓';caption.append(label,download);fig.append(img,caption);$('#render-results').prepend(fig);}
$('#render-button').addEventListener('click',async()=>{
 if(state.busy)return;message();if(!state.lead){message('Please save your project first.');return;}if(!state.pendingRender&&!state.photos.length){message('Add a photo of your home or cabinets to create a visualization.');return;}if(!state.pendingRender&&state.remaining<=0){message('You’ve used your three free visualizations. Our team can help you explore your next ideas.');return;}
 const button=$('#render-button'),status=$('#render-status');state.busy=true;buttonBusy(button,true,'Creating your new look…');
 try{
  if(!state.pendingRender){const photo=state.photos[state.selectedPhoto],color=COLORS[state.color];if(!photo.remote){status.textContent='Securely uploading your selected photo…';const body=new FormData();body.append('photo',photo.file);photo.remote=await request('/api/leads/'+state.lead.id+'/photos',{method:'POST',body,token:state.lead.token});}state.pendingRender={key:crypto.randomUUID(),body:{photoId:photo.remote.id,colorName:color.name,colorHex:color.hex,surface:$('#surface').value},color};saveSession({pendingRender:state.pendingRender});}
  const pending=state.pendingRender;status.textContent='Creating your visualization. This can take a couple of minutes. Keep this page open.';
  let result=await request('/api/leads/'+state.lead.id+'/renders',{method:'POST',body:pending.body,token:state.lead.token,headers:{'Idempotency-Key':pending.key},timeout:240000});
  if(result.status==='pending'){status.textContent='Your image is still processing. Checking its progress…';for(let n=0;n<30&&result.status==='pending';n++){await new Promise(resolve=>setTimeout(resolve,2500));result=await request('/api/leads/'+state.lead.id+'/renders/'+result.id,{token:state.lead.token});}}
  if(Number.isInteger(result.remainingRenders)){state.remaining=result.remainingRenders;$('#remaining-renders').textContent=String(state.remaining);}
  if(result.status==='pending')throw new Error('This visualization is still processing. Use the render button again to check the same request. Your selected settings will be used for your next new render.');
  state.pendingRender=null;saveSession({pendingRender:null});
  if(result.status==='failed')throw new Error(result.error?.message||'The visualization did not finish. Your credit has been restored.');
  state.completedRender={result,color:pending.color};saveSession({completedRender:state.completedRender});$('#retry-image').hidden=false;
  await showRender(result,pending.color);state.completedRender=null;saveSession({completedRender:null});$('#retry-image').hidden=true;status.textContent='Your new look is ready. Save the image or try another color.';
 }catch(err){status.textContent='';message(err.name==='TimeoutError'?'The connection timed out. Retry to check the same request without creating a second one.':err.message);}finally{state.busy=false;buttonBusy(button,false);button.disabled=state.remaining<=0&&!state.pendingRender;}
});
$('#retry-image').addEventListener('click',async()=>{if(!state.completedRender)return;try{await showRender(state.completedRender.result,state.completedRender.color);state.completedRender=null;saveSession({completedRender:null});$('#retry-image').hidden=true;message();}catch(e){message(e.message);}});
$('#reset-session').addEventListener('click',()=>{if(state.busy){message('Please wait for your current request to finish before clearing this device.');return;}try{sessionStorage.removeItem(STORAGE_KEY);}catch{}for(const url of state.urls)release(url);form.reset();state.photos=[];state.lead=null;state.pendingRender=null;state.completedRender=null;state.remaining=config.freeRenders??3;$('#render-results').replaceChildren();$('#retry-image').hidden=true;$('#render-status').textContent='';$('#render-button').disabled=false;photoPreviews();setStep(0);});
const privacy=$('#privacy-dialog');for(const selector of ['#privacy-button','#footer-privacy'])$(selector).addEventListener('click',()=>privacy.showModal());for(const selector of ['#close-privacy','#privacy-done'])$(selector).addEventListener('click',()=>privacy.close());privacy.addEventListener('click',e=>{if(e.target===privacy){const r=privacy.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)privacy.close();}});
window.addEventListener('beforeunload',()=>{for(const url of state.urls)URL.revokeObjectURL(url);});
colorOptions();connect();

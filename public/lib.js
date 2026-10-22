export const COLORS = [
  {name:'Soft white',hex:'#F2EFE6'}, {name:'Warm greige',hex:'#B8B0A2'},
  {name:'Sage green',hex:'#8B9485'}, {name:'Deep navy',hex:'#293C50'},
  {name:'Charcoal',hex:'#454747'}, {name:'Classic black',hex:'#242626'}
];
export const MAX_PHOTOS=3;
export function validatePhoto(file) {
  if(!Number.isFinite(file.size)||file.size<=0) return 'That photo is empty. Please choose another.';
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) return 'Please choose a JPG, PNG, or WebP photo. For iPhone HEIC photos, export as JPG or take a screenshot first.';
  if(file.size>10*1024*1024) return 'Each photo must be 10 MB or smaller.';
  if(!file.size) return 'That photo is empty. Please choose another.';
  return '';
}
export function splitName(name='') {
  const parts=name.trim().split(/\s+/);return {firstName:parts.shift()||'',lastName:parts.join(' ')};
}
export function safeApiBase(value, pageOrigin) {
  if(!value) return '';
  const url=new URL(value,pageOrigin);
  if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('The project connection must use HTTPS.');
  if(url.username||url.password||url.search||url.hash) throw new Error('Invalid API address.');
  return url.href.replace(/\/$/,'');
}
export function privateMediaUrl(path,apiBase,pageOrigin) {
  const base=new URL(apiBase||pageOrigin);const target=new URL(path,base);
  if(target.username||target.password||target.origin!==base.origin || !target.pathname.startsWith('/api/leads/')||target.search||target.hash) throw new Error('The server returned an unexpected photo address.');
  return target.href;
}
export function contactValues(contact) {
  const values=splitName(contact.name?.[0]);
  values.email=contact.email?.[0]||'';values.phone=contact.tel?.[0]||'';
  const a=contact.address?.[0];
  if(a){values.address=a.addressLine?.join(' ')||'';values.city=a.city||'';values.state=a.region||'';values.zip=a.postalCode||'';}
  return values;
}

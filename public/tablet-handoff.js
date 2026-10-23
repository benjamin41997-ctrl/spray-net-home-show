import {createStudioLink} from './access.js';
/** Reuse the one booth QR. An active visitor always gets their authenticated
 * mobile project; a reset clears that access and restores the public form. */
export function tabletHandoff(pageUrl,lead) {
  const publicUrl=new URL(pageUrl);publicUrl.search='';publicUrl.hash='';publicUrl.searchParams.set('mode','mobile');
  if(!lead)return {url:publicUrl.href,title:'Prefer your phone?',description:'Scan to fill this out on your own device.',label:'Scan to open our mobile lead form',private:false};
  const privateUrl=new URL(createStudioLink(pageUrl,lead));privateUrl.searchParams.set('mode','mobile');
  return {url:privateUrl.href,title:'Your project, on your phone.',description:'Scan to continue your saved project and visualizer. This QR is private to you.',label:'Scan your private project link to continue on your phone',private:true};
}

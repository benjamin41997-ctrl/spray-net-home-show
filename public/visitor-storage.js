import { sameStudioAccess } from './access.js';
const TAB_KEY='spraynet-home-show-session-v2',MOBILE_KEY='spraynet-home-show-mobile-v1';
const read=(storage,key)=>{try{return JSON.parse(storage?.getItem(key)||'null');}catch{return null;}};
/** Persist only mobile access and the trusted API origin, never contact fields.
 * Pending work remains tab-scoped. Kiosk access never uses persistent storage. */
export function createVisitorStorage(mode,tab,persistent) {
  return {
    read() {return read(tab,TAB_KEY) || (mode==='mobile'?read(persistent,MOBILE_KEY):null);},
    save(extra) {
      const value={...(this.read()||{}),...extra};
      try{tab?.setItem(TAB_KEY,JSON.stringify(value));}catch{}
      if(mode==='mobile' && sameStudioAccess(value.lead,value.lead)) {
        try{persistent?.setItem(MOBILE_KEY,JSON.stringify({apiBase:value.apiBase,lead:{id:value.lead.id,token:value.lead.token}}));}catch{}
      }
    },
    clear() {try{tab?.removeItem(TAB_KEY);}catch{}if(mode==='mobile')try{persistent?.removeItem(MOBILE_KEY);}catch{}}
  };
}

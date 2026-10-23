import {AddressError,addressSuggestions,validateAddressQuery} from './address.mjs';

/** JSON remains compatible with older pages. New pages receive each county's
 * sanitized matches as it finishes, without waiting for the other counties. */
export async function addressResponse(env,body,request,context,{fetcher=fetch,cache=globalThis.caches?.default}={}) {
  validateAddressQuery(body);
  const options={cache,waitUntil:context?.waitUntil?.bind(context)};
  if (!request.headers.get('Accept')?.includes('application/x-ndjson'))
    return Response.json(await addressSuggestions(env,body,request,fetcher,options));
  if(request.signal.aborted)throw new AddressError(408,'ADDRESS_LOOKUP_CANCELLED','Address lookup was cancelled.');
  const controller=new AbortController(),encoder=new TextEncoder();
  const abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});
  let closed=false;
  const stream=new ReadableStream({
    start(output) {
      const send=value=>{if(!closed)output.enqueue(encoder.encode(JSON.stringify(value)+'\n'));};
      send({suggestions:[],sources:[],done:false});
      const work=addressSuggestions(env,body,{url:request.url,signal:controller.signal},fetcher,{
        ...options,onUpdate:value=>send({...value,done:false})
      }).then(result=>send({...result,done:true}),error=>{
        if(!controller.signal.aborted)send({error:{code:'ADDRESS_LOOKUP_UNAVAILABLE',message:'Address suggestions are temporarily unavailable. You can type the complete address instead.'},done:true});
      }).finally(()=>{
        request.signal.removeEventListener('abort',abort);
        if(!closed){closed=true;output.close();}
      });
      context?.waitUntil?.(work);
    },
    cancel() {closed=true;controller.abort();request.signal.removeEventListener('abort',abort);}
  });
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8'}});
}

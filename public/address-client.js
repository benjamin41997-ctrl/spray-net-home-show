/** Address-only streaming transport. Other private API requests remain JSON. */
export async function requestAddressSuggestions(apiBase,query,{signal,onUpdate,fetcher=fetch}={}) {
  if(!apiBase)throw new Error('Address suggestions are unavailable.');
  const response=await fetcher(apiBase+'/api/addresses/suggest',{
    method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({query}),signal
  });
  const failure=value=>{
    const error=new Error(value?.error?.message || 'Address suggestions are unavailable.');
    error.code=value?.error?.code;error.status=response.status;return error;
  };
  if(!response.ok)throw failure(await response.json().catch(()=>null));
  if(!response.headers.get('Content-Type')?.includes('application/x-ndjson') || !response.body)return response.json();
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,latest=null,done=false;
  function line(text) {
    if(!text.trim())return;
    const value=JSON.parse(text);
    if(value.error)throw failure(value);
    if(!Array.isArray(value.suggestions))throw new Error('Invalid address suggestions.');
    latest=value;done=value.done===true;onUpdate?.(value);
  }
  try {
    while(true) {
      const chunk=await reader.read();if(chunk.done)break;
      bytes+=chunk.value.byteLength;if(bytes>128*1024)throw new Error('Address suggestions are too large.');
      buffer+=decoder.decode(chunk.value,{stream:true});
      let end;while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end));buffer=buffer.slice(end+1);}
    }
    buffer+=decoder.decode();if(buffer.trim())line(buffer);
    if(!latest || !done)throw new Error('Address suggestions were interrupted.');
    return latest;
  } catch(error) {await reader.cancel().catch(()=>{});throw error;}
  finally {reader.releaseLock();}
}

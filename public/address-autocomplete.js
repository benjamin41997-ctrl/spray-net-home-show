// Search supplements the browser's native contact autofill. A suggestion is
// never required, and only an explicit selection supplies structured parts.
export function addressParts(value, selection) {
  if (!selection || String(value).trim() !== selection.display) return {city:'',state:'',zip:''};
  return {city:selection.city || '',state:selection.state || '',zip:selection.zip || ''};
}
export function eligibleAddressQuery(value) {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 120) return false;
  const match = /^(\d{1,6})(?:\s*([A-Za-z].*))?$/.exec(value.trim());
  return Boolean(match && !/^0+$/.test(match[1]) && (match[1].length >= 3 || ((match[2] || '').match(/[A-Za-z]/g) || []).length >= 2));
}
function suggestion(value) {
  if (!value || typeof value.display !== 'string' || !value.display.trim() || value.display.length > 180) return null;
  for (const key of ['street','city','state','zip']) if (value[key] != null && typeof value[key] !== 'string') return null;
  if (value.city?.length > 100 || (value.state && !/^[A-Z]{2}$/.test(value.state)) || (value.zip && !/^\d{5}(?:-\d{4})?$/.test(value.zip))) return null;
  return {display:value.display.trim(),street:value.street || '',city:value.city || '',state:value.state || '',zip:value.zip || ''};
}
const abbreviations = new Map(Object.entries({NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW',STREET:'ST',ROAD:'RD',DRIVE:'DR',COURT:'CT',LANE:'LN',AVENUE:'AVE',BOULEVARD:'BLVD',CIRCLE:'CIR',PLACE:'PL',PARKWAY:'PKWY',TERRACE:'TER',TRAIL:'TRL',HIGHWAY:'HWY'}));
const normalize = value => String(value).toUpperCase().replace(/[.,]/g,' ').replace(/\s+/g,' ').trim();
const canonical = value => normalize(value).split(' ').map(word => abbreviations.get(word) || word).join(' ');
const queryKey = value => String(value).toUpperCase().replace(/\s+/g,' ').trim();
const houseNumber = value => /^(\d{1,6})(?:\s*[A-Za-z].*)?$/.exec(String(value).trim())?.[1] || '';
const prefix = (value, query) => normalize(value).startsWith(normalize(query)) || canonical(value).startsWith(canonical(query));

// Filter only real, previously returned addresses. House numbers remain exact;
// adding a digit must never leave suggestions for a different property visible.
export function filterAddressSuggestions(query, values) {
  if (!eligibleAddressQuery(query)) return [];
  const match = /^(\d{1,6})\s*(.*)$/.exec(query.trim()), parts = match[2].split(',');
  const streetQuery = parts[0].trim(), placeQuery = parts.slice(1).join(' ').trim();
  return values.filter(value => {
    const street = /^(\d{1,6})\s+(.+)$/.exec(value.street || value.display);
    if (!street || street[1] !== match[1]) return false;
    const variants = [street[2],street[2].replace(/^(?:NORTH(?:EAST|WEST)?|SOUTH(?:EAST|WEST)?|EAST|WEST|NE|NW|SE|SW|N|S|E|W)\.?\s+/i,'')];
    const place = [value.city,value.state,value.zip].filter(Boolean).join(' ');
    return parts.length > 1 ? prefix(place,placeQuery) && variants.some(text => prefix(text,streetQuery))
      : variants.some(text => prefix(`${text} ${place}`,streetQuery));
  });
}

export function attachAddressAutocomplete(input, {lookup, delay = 120} = {}) {
  if (!input || typeof lookup !== 'function') throw new TypeError('An address field and lookup function are required.');
  const doc = input.ownerDocument, wrapper = doc.createElement('div'); wrapper.className = 'address-entry';
  input.before(wrapper); wrapper.append(input);
  const popup = doc.createElement('div'); popup.className = 'address-popup'; popup.hidden = true;
  const list = doc.createElement('div'); list.id = `${input.id}-suggestions`; list.setAttribute('role','listbox'); list.setAttribute('aria-label','Matching local addresses');
  const attribution = doc.createElement('p'); attribution.className = 'address-attribution'; attribution.textContent = 'Address data: NCOneMap · York County · Lancaster County';
  popup.append(list,attribution); wrapper.append(popup);
  const status = doc.createElement('p'); status.id = `${input.id}-lookup-status`; status.className = 'address-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); status.hidden = true; wrapper.after(status);
  const described = [input.getAttribute('aria-describedby'),status.id].filter(Boolean).join(' ');
  input.setAttribute('role','combobox'); input.setAttribute('aria-autocomplete','list'); input.setAttribute('aria-controls',list.id); input.setAttribute('aria-expanded','false'); input.setAttribute('aria-describedby',described);
  let selected = null, items = [], active = -1, timer, sequence = 0;
  // Visitor-local memory only. Reset discards both query history and matches.
  const cache = new Map(), pending = new Map(), CACHE_LIMIT = 20, CACHE_MS = 5 * 60 * 1000;
  function announce(text = '') {status.textContent = text;status.hidden = !text;}
  function close() {popup.hidden = true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active = -1;}
  function cancel() {clearTimeout(timer);for (const entry of pending.values()) entry.controller.abort();pending.clear();sequence++;input.setAttribute('aria-busy','false');}
  function clear() {cancel();cache.clear();selected = null;items = [];list.replaceChildren();close();announce();}
  function adopt(value) {clear();selected = suggestion(value);if (selected) input.value = selected.display;}
  function highlight(index, scroll = true) {
    active = index;
    for (let n = 0; n < list.children.length; n++) list.children[n].setAttribute('aria-selected',String(n === active));
    if (active >= 0) {input.setAttribute('aria-activedescendant',list.children[active].id);if (scroll) list.children[active].scrollIntoView?.({block:'nearest'});}
  }
  function choose(index) {
    const item = items[index];if (!item) return;
    select(item);
  }
  function select(item) {
    cancel();input.value = item.display;selected = item;close();announce('Address selected. You can edit it if needed.');input.focus({preventScroll:true});
  }
  function position() {
    const view = doc.defaultView; if (!view || popup.hidden) return;
    const rect = input.getBoundingClientRect(), viewport = view.visualViewport;
    const top = viewport?.offsetTop || 0, bottom = top + (viewport?.height || view.innerHeight);
    const below = Math.max(0,bottom - rect.bottom - 12), above = Math.max(0,rect.top - top - 12);
    const upwards = below < 180 && above > below;
    popup.classList.toggle('above',upwards);list.style.maxHeight = `${Math.min(260,Math.max(90,(upwards ? above : below) - 26))}px`;
  }
  function show(values) {
    const next = values.slice(0,8), previous = items[active]?.display;
    if (next.length === items.length && next.every((value,index) => value.display === items[index].display) && !popup.hidden) return;
    items = next;list.replaceChildren();active = -1;
    items.forEach((item,index) => {
      const option = doc.createElement('div');option.id = `${list.id}-${index}`;option.className = 'address-option';option.setAttribute('role','option');option.setAttribute('aria-selected','false');
      const street = doc.createElement('strong'), place = doc.createElement('span');street.textContent = item.street || item.display;place.textContent = [item.city,[item.state,item.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');option.append(street,place);
      option.addEventListener('pointerdown',event => event.preventDefault());option.addEventListener('click',() => select(item));list.append(option);
    });
    popup.hidden = !items.length;input.setAttribute('aria-expanded',String(Boolean(items.length)));
    if (!items.length) close();
    position();
    if (items.length) highlight(Math.max(0,items.findIndex(value => value.display === previous)),false);
  }
  function cached(key) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.time < CACHE_MS) return entry;
    cache.delete(key);return null;
  }
  function matches(query) {
    const key = queryKey(query), exact = cached(key), pool = exact ? [...exact.values] : [], seen = new Set(pool.map(value => normalize(value.display)));
    for (const oldKey of [...cache.keys()].reverse()) for (const value of cached(oldKey)?.values || []) {
      const id = normalize(value.display);if (!seen.has(id)) {pool.push(value);seen.add(id);}
    }
    return filterAddressSuggestions(query,pool).slice(0,8);
  }
  function refresh(query, searching = false, error = '') {
    const values = matches(query);show(values);input.setAttribute('aria-busy',String(searching));
    announce(values.length ? `${values.length} local address suggestions.${searching ? ' Checking for more matches…' : ' Choose an address, or keep typing.'}`
      : searching ? 'Looking for nearby addresses…' : error || 'No matching address yet. Keep typing, or enter your address yourself.');
  }
  async function search(query, version) {
    const key = queryKey(query);
    if (version !== sequence || input !== doc.activeElement || pending.has(key) || cached(key)?.complete) return;
    // Keep one useful broader lookup alive while a refined query runs. Typing
    // must not repeatedly throw away a response that is about to arrive.
    if (pending.size >= 2) {
      const entries = [...pending.entries()], ancestor = entries.find(([oldKey]) => key.startsWith(oldKey));
      const [oldKey,entry] = entries.find(([oldKey]) => oldKey !== ancestor?.[0]) || entries[0];
      entry.controller.abort();pending.delete(oldKey);
    }
    const entry = {controller:new AbortController(),version};pending.set(key,entry);
    const timeout = setTimeout(() => entry.controller.abort(),6500);
    refresh(input.value.trim(),true);
    function receive(result) {
      if (version !== sequence || entry.controller.signal.aborted || pending.get(key) !== entry) return;
      const values = (Array.isArray(result?.suggestions) ? result.suggestions : []).map(suggestion).filter(Boolean);
      if (values.length) {
        cache.delete(key);cache.set(key,{values,time:Date.now(),complete:result?.done===true});
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      }
      if (input === doc.activeElement && !selected && eligibleAddressQuery(input.value)) refresh(input.value.trim(),result?.done!==true);
    }
    try {
      const result = await lookup(query,{signal:entry.controller.signal,onUpdate:receive});
      receive({...result,done:true});
      if (pending.get(key) === entry) pending.delete(key);
    } catch (error) {
      if (version !== sequence || pending.get(key) !== entry) return;
      pending.delete(key);
      if (input === doc.activeElement && queryKey(input.value) === key) refresh(input.value.trim(),false,
        error?.name === 'AbortError' ? 'Address lookup took too long. You can enter your address yourself.' : 'Suggestions are unavailable right now. You can enter your address yourself.');
    } finally {clearTimeout(timeout);if (pending.get(key) === entry) pending.delete(key);}
  }
  function changed(event) {
    selected = null;clearTimeout(timer);
    if (event?.isComposing) {cancel();show([]);announce();return;}
    if (!eligibleAddressQuery(input.value)) {
      cancel();show([]);announce();
      if (input.value.trim()) announce('Keep typing your house number or add a few street letters to see suggestions.');
      return;
    }
    const query = input.value.trim(), key = queryKey(query);
    for (const [oldKey,entry] of pending) if (houseNumber(oldKey) !== houseNumber(query)) {entry.controller.abort();pending.delete(oldKey);}
    const complete = cached(key)?.complete===true;refresh(query,!complete);
    if (!complete && !pending.has(key)) {
      const version = sequence;
      // First useful prefix goes out immediately. Visible real matches narrow
      // synchronously, with refined network work coalesced while typing.
      const wait = pending.size ? delay : matches(query).length ? delay*2 : 0;
      timer = setTimeout(() => search(query,version),wait);
    }
  }
  input.addEventListener('input',changed);input.addEventListener('compositionend',changed);
  input.addEventListener('change',() => {
    if (input === doc.activeElement && input.value.trim() !== selected?.display && !pending.has(queryKey(input.value)) && !cached(queryKey(input.value))?.complete) changed();
  });
  input.addEventListener('focus',() => {
    if (input.value.trim() === selected?.display) return;
    if (input.value.trim()) changed();
  });
  input.addEventListener('keydown',event => {
    if (popup.hidden || !items.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault();highlight(event.key === 'ArrowDown' ? (active+1)%items.length : (active <= 0 ? items.length-1 : active-1));}
    else if (event.key === 'Enter' && active >= 0) {event.preventDefault();choose(active);}
    else if (event.key === 'Escape') {event.preventDefault();cancel();close();announce();}
  });
  input.addEventListener('blur',() => {cancel();close();announce();});
  doc.defaultView?.addEventListener('resize',position);doc.defaultView?.visualViewport?.addEventListener('resize',position);
  return {adopt,clear,parts:() => addressParts(input.value,selected)};
}

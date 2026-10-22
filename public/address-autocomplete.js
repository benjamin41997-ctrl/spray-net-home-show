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
export function attachAddressAutocomplete(input, {lookup, delay = 300} = {}) {
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
  let selected = null, items = [], resultQuery = '', active = -1, timer, controller, sequence = 0;
  function announce(text = '') {status.textContent = text;status.hidden = !text;}
  function close() {popup.hidden = true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active = -1;}
  function cancel() {clearTimeout(timer);controller?.abort();controller = null;sequence++;}
  function clear() {cancel();selected = null;items = [];resultQuery = '';list.replaceChildren();close();announce();}
  function adopt(value) {clear();selected = suggestion(value);if (selected) input.value = selected.display;}
  function highlight(index, scroll = true) {
    active = index;
    for (let n = 0; n < list.children.length; n++) list.children[n].setAttribute('aria-selected',String(n === active));
    if (active >= 0) {input.setAttribute('aria-activedescendant',list.children[active].id);if (scroll) list.children[active].scrollIntoView?.({block:'nearest'});}
  }
  function choose(index) {
    const item = items[index];if (!item) return;
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
    items = values.map(suggestion).filter(Boolean).slice(0,8);list.replaceChildren();active = -1;
    items.forEach((item,index) => {
      const option = doc.createElement('div');option.id = `${list.id}-${index}`;option.className = 'address-option';option.setAttribute('role','option');option.setAttribute('aria-selected','false');
      const street = doc.createElement('strong'), place = doc.createElement('span');street.textContent = item.street || item.display;place.textContent = [item.city,[item.state,item.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');option.append(street,place);
      option.addEventListener('pointerdown',event => event.preventDefault());option.addEventListener('click',() => choose(index));list.append(option);
    });
    popup.hidden = !items.length;input.setAttribute('aria-expanded',String(Boolean(items.length)));
    position();
    if (items.length) highlight(0,false);
    announce(items.length ? `${items.length} local address suggestions. Use the arrow keys to choose, or keep typing.` : 'No matching address yet. Keep typing, or enter your address yourself.');
  }
  async function search(query, version) {
    if (version !== sequence || input !== doc.activeElement) return;
    controller = new AbortController();const abort = controller, timeout = setTimeout(() => abort.abort(),6500);
    announce('Looking for nearby addresses…');
    try {
      const result = await lookup(query,{signal:abort.signal});
      if (version !== sequence || input.value.trim() !== query || input !== doc.activeElement) return;
      resultQuery = query;show(Array.isArray(result?.suggestions) ? result.suggestions : []);
    } catch (error) {
      if (version !== sequence || input.value.trim() !== query || input !== doc.activeElement) return;
      close();announce(error?.name === 'AbortError' ? 'Address lookup took too long. You can enter your address yourself.' : 'Suggestions are unavailable right now. You can enter your address yourself.');
    } finally {clearTimeout(timeout);if (controller === abort) controller = null;}
  }
  function changed(event) {
    selected = null;cancel();list.replaceChildren();items = [];resultQuery = '';close();announce();
    if (event?.isComposing) return;
    if (!eligibleAddressQuery(input.value)) {
      if (input.value.trim()) announce('Keep typing your house number or add a few street letters to see suggestions.');
      return;
    }
    announce('Looking for nearby addresses…');
    const query = input.value.trim(), version = sequence;timer = setTimeout(() => search(query,version),delay);
  }
  input.addEventListener('input',changed);input.addEventListener('compositionend',changed);
  input.addEventListener('change',() => {
    if (input === doc.activeElement && !controller && input.value.trim() !== selected?.display && input.value.trim() !== resultQuery) changed();
  });
  input.addEventListener('focus',() => {
    if (input.value.trim() === selected?.display) return;
    if (items.length && input.value.trim() === resultQuery) show(items);
    else if (input.value.trim()) changed();
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

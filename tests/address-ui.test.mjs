import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAddressAutocomplete } from '../public/address-autocomplete.js';

// Minimal DOM fixture for this component's DOM/EventTarget surface. It executes
// the actual module; no browser, remote page, or external lookup is controlled.
function fixture(lookup) {
  const document = { activeElement: null, createElement(tag) { return new Element(tag); } };
  const view = new EventTarget(); view.innerHeight = 800; view.visualViewport = new EventTarget();
  Object.assign(view.visualViewport, {offsetTop:0,height:800}); document.defaultView = view;
  class Element extends EventTarget {
    constructor(tag) {
      super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document;
      this.parentNode = null; this.children = []; this.attributes = new Map();
      this.id = ''; this.className = ''; this.value = ''; this.hidden = false; this._text = '';
      this.style = {}; this.classList = {toggle:(name,on) => {const names = new Set(this.className.split(' '));if(on)names.add(name);else names.delete(name);this.className = [...names].join(' ');}};
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    detach() {
      if (!this.parentNode) return;
      const siblings = this.parentNode.children, index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1); this.parentNode = null;
    }
    append(...nodes) {
      this._text = '';
      for (const node of nodes) { node.detach(); node.parentNode = this; this.children.push(node); }
    }
    before(node) {
      const parent = this.parentNode; assert.ok(parent, 'A DOM insertion needs a parent.'); node.detach();
      parent.children.splice(parent.children.indexOf(this), 0, node); node.parentNode = parent;
    }
    after(node) {
      const parent = this.parentNode; assert.ok(parent, 'A DOM insertion needs a parent.'); node.detach();
      parent.children.splice(parent.children.indexOf(this) + 1, 0, node); node.parentNode = parent;
    }
    replaceChildren(...nodes) {
      for (const child of this.children) child.parentNode = null;
      this.children = []; this._text = ''; this.append(...nodes);
    }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    focus() {
      const previous = document.activeElement;
      if (previous !== this) { document.activeElement = this; previous?.dispatchEvent(new Event('blur'));this.dispatchEvent(new Event('focus')); }
    }
    getBoundingClientRect() {return {top:200,bottom:248};}
    scrollIntoView() {}
    set innerHTML(_) { throw new Error('The address component must not insert HTML.'); }
  }
  const form = document.createElement('form'), input = document.createElement('input');
  input.id = 'project-address'; input.setAttribute('autocomplete', 'section-lead street-address');
  input.setAttribute('aria-describedby', 'existing-address-help'); form.append(input);
  const widget = attachAddressAutocomplete(input, { lookup, delay: 0 });
  const wrapper = form.children[0], popup = wrapper.children[1], list = popup.children[0], status = form.children[1];
  let submissions = 0; form.addEventListener('submit', () => { submissions++; });
  function type(value, extra = {}) {
    input.focus(); input.value = value;
    const event = new Event('input', { bubbles: true }); Object.assign(event, extra); input.dispatchEvent(event);
  }
  function key(value) {
    const event = new Event('keydown', { cancelable: true, bubbles: true }); Object.defineProperty(event, 'key', { value });
    input.dispatchEvent(event);
    // Browser implicit submission is a default action of unhandled Enter.
    if (value === 'Enter' && !event.defaultPrevented) form.dispatchEvent(new Event('submit', { cancelable: true }));
    return event;
  }
  return { document, form, input, wrapper, popup, list, status, widget, type, key, submissions: () => submissions };
}
function controlledLookup() {
  const calls = [], waiters = [];
  const lookup = (query, { signal }) => new Promise((resolve, reject) => {
    calls.push({ query, signal, resolve, reject });
    for (const waiter of [...waiters]) if (calls.length >= waiter.number) {
      waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(calls[waiter.number - 1]);
    }
  });
  return { calls, lookup, waitFor(number) {
    if (calls.length >= number) return Promise.resolve(calls[number - 1]);
    return new Promise(resolve => waiters.push({ number, resolve }));
  } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const address = (street = '101 Main St', city = 'Belmont', state = 'NC', zip = '28012') => ({
  display: `${street}, ${city}, ${state} ${zip}`, street, city, state, zip,
});
function cleanup(t, component, control) {
  t.after(async () => {
    component.widget.clear();
    for (const call of control.calls) call.resolve({ suggestions: [] });
    await settle();
  });
}

test('Enter selects the keyboard-highlighted real suggestion and consumes implicit form submission', async t => {
  const control = controlledLookup(), component = fixture(control.lookup); cleanup(t, component, control);
  const first = address(), second = address('101 Market St', 'Fort Mill', 'SC', '29715');
  component.type('101 ma'); const call = await control.waitFor(1);
  call.resolve({ suggestions: [first, second] }); await settle();
  assert.equal(component.input.getAttribute('aria-expanded'), 'true'); assert.equal(component.list.children.length, 2);
  assert.equal(component.list.children[0].getAttribute('aria-selected'), 'true');
  assert.equal(component.key('ArrowDown').defaultPrevented, true);
  assert.equal(component.list.children[1].getAttribute('aria-selected'), 'true');
  assert.equal(component.key('Enter').defaultPrevented, true); assert.equal(component.submissions(), 0);
  assert.equal(component.input.value, second.display); assert.deepEqual(component.widget.parts(), { city: 'Fort Mill', state: 'SC', zip: '29715' });
  assert.equal(component.popup.hidden, true); assert.equal(component.input.getAttribute('aria-activedescendant'), null);
  assert.equal(component.document.activeElement, component.input);
});

test('manual input after selection clears structured parts and a complete pasted address still receives suggestions', async t => {
  const control = controlledLookup(), component = fixture(control.lookup); cleanup(t, component, control);
  component.widget.adopt(address()); assert.deepEqual(component.widget.parts(), { city: 'Belmont', state: 'NC', zip: '28012' });
  component.type('101 Manually Edited Street, Charlotte, NC 28277');
  assert.deepEqual(component.widget.parts(), { city: '', state: '', zip: '' });
  assert.equal(component.list.children.length, 0); assert.equal(component.popup.hidden, true);
  const call = await control.waitFor(1);assert.equal(call.query,'101 Manually Edited Street, Charlotte, NC 28277');
  assert.equal(component.input.value, '101 Manually Edited Street, Charlotte, NC 28277');
});

test('a house number alone starts lookup, gives immediate feedback, and displays actual nearby options', async t => {
  const control = controlledLookup(), component = fixture(control.lookup); cleanup(t, component, control);
  component.type('10'); assert.match(component.status.textContent,/Keep typing/);assert.equal(control.calls.length,0);
  component.type('101');assert.match(component.status.textContent,/Looking/);
  const call = await control.waitFor(1);assert.equal(call.query,'101');
  call.resolve({suggestions:[address()]});await settle();
  assert.equal(component.popup.hidden,false);assert.equal(component.input.getAttribute('aria-expanded'),'true');
  assert.equal(component.list.children[0].children[0].textContent,'101 Main St');
});

test('returning to an address restarts an interrupted lookup and reopens completed matches without refetching', async t => {
  const control = controlledLookup(), component = fixture(control.lookup); cleanup(t, component, control);
  const other = component.document.createElement('input');component.form.append(other);
  component.type('101');const interrupted = await control.waitFor(1);other.focus();
  assert.equal(interrupted.signal.aborted,true);assert.equal(component.popup.hidden,true);
  component.input.focus();const resumed = await control.waitFor(2);
  resumed.resolve({suggestions:[address()]});await settle();assert.equal(component.popup.hidden,false);
  other.focus();component.input.focus();assert.equal(component.popup.hidden,false);
  await settle();assert.equal(control.calls.length,2);
});

test('suggestions open above the field when the mobile keyboard leaves little room below', async t => {
  const control = controlledLookup(), component = fixture(control.lookup); cleanup(t, component, control);
  component.document.defaultView.visualViewport.height = 310;
  component.type('101');const call = await control.waitFor(1);call.resolve({suggestions:[address()]});await settle();
  assert.match(component.popup.className,/\babove\b/);assert.equal(component.list.style.maxHeight,'162px');
});

test('a superseded lookup is aborted and its late response cannot replace newer suggestions', async t => {
  const control = controlledLookup(), component = fixture(control.lookup); cleanup(t, component, control);
  component.type('101 ma'); const old = await control.waitFor(1);
  component.type('202 oa'); assert.equal(old.signal.aborted, true);
  const latest = await control.waitFor(2), choice = address('202 Oak St', 'Charlotte', 'NC', '28277');
  latest.resolve({ suggestions: [choice] }); await settle();
  assert.equal(component.list.children[0].children[0].textContent, choice.street);
  // Deliberately ignore AbortSignal in the fake provider to model a raced response.
  old.resolve({ suggestions: [address('101 Old Result St')] }); await settle();
  assert.equal(component.list.children.length, 1); assert.equal(component.list.children[0].children[0].textContent, choice.street);
  component.key('Enter'); assert.equal(component.input.value, choice.display);
  assert.deepEqual(component.widget.parts(), { city: 'Charlotte', state: 'NC', zip: '28277' });
});

test('tablet reset clear cancels in-flight work, removes suggestions and status, and cannot resurrect prior visitor parts', async t => {
  const control = controlledLookup(), component = fixture(control.lookup); cleanup(t, component, control);
  component.widget.adopt(address()); component.type('303 ne'); const pending = await control.waitFor(1);
  assert.match(component.status.textContent, /Looking/);
  component.input.value = ''; component.widget.clear();
  assert.equal(pending.signal.aborted, true); assert.equal(component.popup.hidden, true); assert.equal(component.list.children.length, 0);
  assert.equal(component.status.textContent, ''); assert.equal(component.status.hidden, true);
  assert.equal(component.input.getAttribute('aria-expanded'), 'false'); assert.equal(component.input.getAttribute('aria-activedescendant'), null);
  assert.deepEqual(component.widget.parts(), { city: '', state: '', zip: '' });
  pending.resolve({ suggestions: [address('303 Previous Visitor St')] }); await settle();
  assert.equal(component.input.value, ''); assert.equal(component.popup.hidden, true); assert.equal(component.list.children.length, 0);
  assert.equal(component.status.hidden, true); assert.deepEqual(component.widget.parts(), { city: '', state: '', zip: '' });
});

test('lookup failure leaves typed text and manual Enter submission available while preserving native autofill semantics', async t => {
  const control = controlledLookup(), component = fixture(control.lookup); cleanup(t, component, control);
  component.type('404 Example'); const call = await control.waitFor(1); call.reject(new Error('Synthetic lookup outage.')); await settle();
  assert.equal(component.input.value, '404 Example'); assert.equal(component.popup.hidden, true);
  assert.match(component.status.textContent, /enter your address yourself/); assert.equal(component.status.hidden, false);
  assert.deepEqual(component.widget.parts(), { city: '', state: '', zip: '' });
  assert.equal(component.key('Enter').defaultPrevented, false); assert.equal(component.submissions(), 1);
  assert.equal(component.input.getAttribute('autocomplete'), 'section-lead street-address');
  assert.equal(component.input.getAttribute('aria-describedby'), 'existing-address-help project-address-lookup-status');
});

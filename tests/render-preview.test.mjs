import test from 'node:test';
import assert from 'node:assert/strict';
import {customRenderPrompt,MAX_CUSTOM_PROMPT} from '../public/render-settings.js';
import {createRenderPreview} from '../public/render-preview.js';

test('custom visualization instructions are optional, normalize newlines, and reject oversized or non-text input',()=>{
  for(const input of [undefined,null,'',' \r\n '])assert.equal(customRenderPrompt(input),'');
  assert.equal(customRenderPrompt(' White uppers\r\nNavy lowers \rKeep grain '),'White uppers\nNavy lowers \nKeep grain');
  assert.equal(customRenderPrompt('x'.repeat(MAX_CUSTOM_PROMPT)).length,1000);
  for(const input of ['x'.repeat(MAX_CUSTOM_PROMPT+1),{},[],123,'white\u0000navy','white\u007fnavy'])assert.throws(()=>customRenderPrompt(input));
});

// Execute the viewer's DOM/events without a browser, private photo download,
// rendering request, or interaction with the user's real device.
function fixture() {
  const document={createElement:tag=>new Element(tag)};
  class Element extends EventTarget {
    constructor(tag){super();this.tagName=tag;this.ownerDocument=document;this.children=[];this.attributes=new Map();this._text='';this.open=false;}
    setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key)??null;}
    removeAttribute(key){this.attributes.delete(key);if(['src','href','download'].includes(key))delete this[key];}
    append(...items){this.children.push(...items);}
    set textContent(value){this._text=String(value);}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    focus(){this.focused=true;}
    showModal(){this.open=true;this.opens=(this.opens||0)+1;}
    close(){this.open=false;this.dispatchEvent(new Event('close'));}
    set innerHTML(_){throw new Error('Use safe DOM text for preview content.');}
  }
  const dialog=new Element('dialog');dialog.id='preview';let active=true,edits=0;
  const viewer=createRenderPreview(dialog,{isActive:()=>active,onEdit:()=>{edits++;}});
  const find=text=>dialog.children.flatMap(child=>[child,...child.children]).find(child=>child.textContent===text);
  return {dialog,viewer,find,lock:()=>{active=false;},edits:()=>edits};
}

test('completed image preview opens prominently with focus, a private image and a matching download',()=>{
  const view=fixture(),url='blob:https://example.com/private-image';
  assert.equal(view.viewer.show({url,label:'Custom preview',filename:'preview.jpg'}),true);
  assert.equal(view.dialog.open,true);assert.equal(view.dialog.opens,1);
  assert.equal(view.dialog.children.find(child=>child.tagName==='img').src,url);
  assert.equal(view.find('Save image ↓').href,url);assert.equal(view.find('Save image ↓').download,'preview.jpg');
  const heading=view.find('Your visualization is ready.');assert.equal(heading.focused,true);assert.equal(view.dialog.getAttribute('aria-labelledby'),heading.id);
});

test('preview can be reopened without rendering and Back to editing closes and clears private references',()=>{
  const view=fixture(),image=view.dialog.children.find(child=>child.tagName==='img');
  view.viewer.show({url:'blob:one'});view.viewer.show({url:'blob:two'});assert.equal(view.dialog.opens,1);assert.equal(image.src,'blob:two');
  view.find('Back to editing').dispatchEvent(new Event('click'));assert.equal(view.dialog.open,false);assert.equal(view.edits(),1);
  assert.equal(image.src,undefined);assert.equal(view.find('Save image ↓').href,undefined);
  view.viewer.show({url:'blob:one'});assert.equal(view.dialog.opens,2);view.viewer.clear();assert.equal(image.src,undefined);
});

test('preview rejects arbitrary remote URLs and cannot expose images after consultation access is cleared',()=>{
  const view=fixture();for(const url of ['https://private.example/photo','javascript:alert(1)','data:image/jpeg;base64,aaa'])assert.throws(()=>view.viewer.show({url}));
  view.viewer.show({url:'blob:private'});view.lock();view.viewer.clear();assert.equal(view.viewer.show({url:'blob:old'}),false);assert.equal(view.dialog.open,false);
});

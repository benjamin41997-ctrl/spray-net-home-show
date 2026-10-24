import test from 'node:test';
import assert from 'node:assert/strict';
import {setBusy} from '../public/ui-feedback.js';

function button(){const classes=new Set(),attrs=new Map();return {textContent:'Create my visualization',dataset:{},disabled:false,classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},setAttribute:(name,value)=>attrs.set(name,value),getAttribute:name=>attrs.get(name)};}
test('busy feedback remains explicit and repeat updates preserve the original action label',()=>{
  const action=button();setBusy(action,true,'Creating your new look…');
  assert.equal(action.disabled,true);assert.equal(action.classList.contains('is-loading'),true);assert.equal(action.getAttribute('aria-busy'),'true');
  assert.equal(action.textContent,'Creating your new look…');
  setBusy(action,true,'Retrieving image…');setBusy(action,false);
  assert.equal(action.textContent,'Create my visualization');assert.equal(action.disabled,false);assert.equal(action.classList.contains('is-loading'),false);assert.equal(action.getAttribute('aria-busy'),'false');
});
test('an async failure clears its spinner and restores an action for retry',async()=>{
  const action=button();async function run(){setBusy(action,true,'Creating your new look…');try{throw new Error('Temporary failure');}finally{setBusy(action,false);}}
  await assert.rejects(run(),/Temporary failure/);assert.equal(action.disabled,false);assert.equal(action.classList.contains('is-loading'),false);assert.equal(action.dataset.label,undefined);
});

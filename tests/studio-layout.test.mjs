import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudioLayout} from '../public/studio-layout.js';

function fixture(mode='tablet',wide=true){
  class Node extends EventTarget{
    constructor(){super();this.children=[];this.hidden=false;this.moves=0;}
    append(node){if(node.parentElement)node.parentElement.children.splice(node.parentElement.children.indexOf(node),1);this.children.push(node);node.parentElement=this;node.moves++;}
  }
  const parts=Object.fromEntries(['studio','photos','results','photoHome','resultHome','sidebar','resultDock','qr','qrHome','qrDock'].map(key=>[key,new Node()]));
  parts.studio.hidden=true;parts.photoHome.append(parts.photos);parts.resultHome.append(parts.results);parts.qrHome.append(parts.qr);
  const media=new EventTarget();media.matches=wide;
  const layout=createStudioLayout({mode,...parts,media});
  return {...parts,media,layout};
}

test('full-width tablet studio preserves the single QR, result controls and photo selector nodes',()=>{
  const f=fixture();let clicks=0;f.results.addEventListener('view',()=>clicks++);
  assert.equal(f.sidebar.hidden,true);assert.equal(f.qr.parentElement,f.qrHome);
  f.studio.hidden=false;f.layout.sync();
  assert.equal(f.sidebar.hidden,false);assert.equal(f.qrDock.children[0],f.qr);assert.equal(f.resultDock.children[0],f.results);assert.equal(f.photos.parentElement,f.photoHome);
  f.results.dispatchEvent(new Event('view'));assert.equal(clicks,1);
  const moves=f.qr.moves;f.layout.sync();assert.equal(f.qr.moves,moves,'Repeated updates do not reattach or duplicate the private QR.');
  f.studio.hidden=true;f.layout.sync();assert.equal(f.sidebar.hidden,true);assert.equal(f.qr.parentElement,f.qrHome);assert.equal(f.results.parentElement,f.resultHome);
  assert.equal(f.qrDock.children.length,0);assert.equal(f.resultDock.children.length,0);
});

test('resizing restores media to the normal studio before docking it again; mobile never docks',()=>{
  const f=fixture();f.studio.hidden=false;f.layout.sync();
  f.media.matches=false;f.media.dispatchEvent(new Event('change'));assert.equal(f.qr.parentElement,f.qrHome);assert.equal(f.results.parentElement,f.resultHome);assert.equal(f.sidebar.hidden,true);
  f.media.matches=true;f.media.dispatchEvent(new Event('change'));assert.equal(f.qr.parentElement,f.qrDock);assert.equal(f.sidebar.hidden,false);
  const mobile=fixture('mobile');mobile.studio.hidden=false;mobile.layout.sync();
  assert.equal(mobile.photos.parentElement,mobile.photoHome);assert.equal(mobile.qr.parentElement,mobile.qrHome);assert.equal(mobile.results.parentElement,mobile.resultHome);assert.equal(mobile.sidebar.hidden,true);
});

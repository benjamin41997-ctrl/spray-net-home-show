import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudioLayout} from '../public/studio-layout.js';

function fixture(mode='tablet',wide=true){
  class Node extends EventTarget{
    constructor(){super();this.children=[];this.hidden=false;this.moves=0;}
    append(node){if(node.parentElement)node.parentElement.children.splice(node.parentElement.children.indexOf(node),1);this.children.push(node);node.parentElement=this;node.moves++;}
  }
  const parts=Object.fromEntries(['studio','photos','results','photoHome','resultHome','sidebar','photoDock','resultDock'].map(key=>[key,new Node()]));
  parts.studio.hidden=true;parts.photoHome.append(parts.photos);parts.resultHome.append(parts.results);
  const media=new EventTarget();media.matches=wide;
  const layout=createStudioLayout({mode,...parts,media});
  return {...parts,media,layout};
}

test('tablet studio docks the same private photo/result nodes and preserves their controls and handlers',()=>{
  const f=fixture();let clicks=0;f.photos.addEventListener('select',()=>clicks++);
  assert.equal(f.sidebar.hidden,true);assert.equal(f.photos.parentElement,f.photoHome);
  f.studio.hidden=false;f.layout.sync();
  assert.equal(f.sidebar.hidden,false);assert.equal(f.photoDock.children[0],f.photos);assert.equal(f.resultDock.children[0],f.results);
  f.photos.dispatchEvent(new Event('select'));assert.equal(clicks,1);
  const moves=f.photos.moves;f.layout.sync();assert.equal(f.photos.moves,moves,'Repeated updates do not reattach or duplicate images.');
  f.studio.hidden=true;f.layout.sync();assert.equal(f.sidebar.hidden,true);assert.equal(f.photos.parentElement,f.photoHome);assert.equal(f.results.parentElement,f.resultHome);
  assert.equal(f.photoDock.children.length,0);assert.equal(f.resultDock.children.length,0);
});

test('resizing restores media to the normal studio before docking it again; mobile never docks',()=>{
  const f=fixture();f.studio.hidden=false;f.layout.sync();
  f.media.matches=false;f.media.dispatchEvent(new Event('change'));assert.equal(f.photos.parentElement,f.photoHome);assert.equal(f.results.parentElement,f.resultHome);assert.equal(f.sidebar.hidden,true);
  f.media.matches=true;f.media.dispatchEvent(new Event('change'));assert.equal(f.photos.parentElement,f.photoDock);assert.equal(f.sidebar.hidden,false);
  const mobile=fixture('mobile');mobile.studio.hidden=false;mobile.layout.sync();
  assert.equal(mobile.photos.parentElement,mobile.photoHome);assert.equal(mobile.results.parentElement,mobile.resultHome);assert.equal(mobile.sidebar.hidden,true);
});

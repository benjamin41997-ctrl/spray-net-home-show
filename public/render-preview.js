/** Private image viewer. Opening/closing it never calls the rendering API or
 * consumes a credit. The gallery owns and eventually revokes its blob URLs. */
export function createRenderPreview(dialog,{isActive=()=>true,onEdit=()=>{}}={}) {
  const document=dialog.ownerDocument;
  const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const heading=node('h2','','Your visualization is ready.');heading.id=dialog.id+'-title';heading.tabIndex=-1;
  dialog.setAttribute('aria-labelledby',heading.id);
  const close=node('button','dialog-close','×');close.type='button';close.setAttribute('aria-label','Close visualization preview');
  const label=node('p','preview-label'),image=node('img','preview-image');
  const actions=node('div','preview-actions'),save=node('a','button','Save image ↓'),edit=node('button','button secondary','Back to editing');edit.type='button';
  const clear=()=>{image.removeAttribute('src');image.alt='';save.removeAttribute('href');save.removeAttribute('download');label.textContent='';};
  function hide(){if(dialog.open)dialog.close();clear();}
  close.addEventListener('click',hide);edit.addEventListener('click',()=>{hide();if(isActive())onEdit();});
  dialog.addEventListener('close',()=>{if(!dialog.open)clear();});
  actions.append(save,edit);dialog.append(close,heading,label,image,actions);
  return {
    show({url,label:description='AI visualization',filename='spray-net-visualization.jpg'}) {
      if(!isActive())return false;
      if(typeof url!=='string'||!url.startsWith('blob:'))throw new TypeError('Use a private image from this project.');
      label.textContent=description;image.src=url;image.alt=description;save.href=url;save.download=filename;
      if(!dialog.open)dialog.showModal();heading.focus({preventScroll:true});return true;
    },clear:hide,
  };
}

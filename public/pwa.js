/** Tablet installation is independent of lead access and never reloads an
 * active visitor. The stable worker URL is scoped to this repository only. */
export function setupTabletApp({mode,button,dialog,install,fullscreen,close,status,window:win=window,document:doc=document,navigator:nav=navigator}) {
  if(mode!=='tablet'){button.hidden=true;return;}
  let deferred=null,installed=false;
  const display=win.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)');
  const isInstalled=()=>installed||display?.matches||nav.standalone===true;
  function update(){button.hidden=Boolean(isInstalled());install.hidden=!deferred||Boolean(isInstalled());
    fullscreen.hidden=typeof doc.documentElement.requestFullscreen!=='function'||doc.fullscreenEnabled===false||Boolean(doc.fullscreenElement)||display?.matches===true;}
  win.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event;update();});
  win.addEventListener('appinstalled',()=>{installed=true;deferred=null;update();dialog.close();});
  win.addEventListener('pageshow',update);display?.addEventListener?.('change',update);doc.addEventListener('fullscreenchange',update);
  button.addEventListener('click',()=>{status.textContent='';update();dialog.showModal();});
  close.addEventListener('click',()=>dialog.close());
  install.addEventListener('click',async()=>{
    const prompt=deferred;if(!prompt)return;deferred=null;update();
    try{await prompt.prompt();const choice=await prompt.userChoice;
      if(choice.outcome==='accepted'){installed=true;update();dialog.close();}
    }catch{status.textContent='Use your browser menu to install the app with the steps above.';}
  });
  fullscreen.addEventListener('click',async()=>{
    try{await doc.documentElement.requestFullscreen({navigationUI:'hide'});dialog.close();update();}
    catch{status.textContent='Open the installed home-screen icon to use the app without browser controls.';}
  });
  update();
  if(win.isSecureContext&&nav.serviceWorker){
    void nav.serviceWorker.register(new URL('./service-worker.js',import.meta.url),{
      scope:new URL('./',import.meta.url).href,updateViaCache:'none'
    }).catch(()=>{});
  }
}

/** The tablet uses full-width controls above its preview gallery. Move the
 * existing QR/result nodes, never copies; restore them when the studio closes. */
export function createStudioLayout({mode,studio,results,resultHome,sidebar,resultDock,qr,qrHome,qrDock,media=window.matchMedia('(min-width: 760px)')}){
  function sync(){
    const docked=mode==='tablet'&&media.matches&&!studio.hidden;
    for(const [node,target] of [[qr,docked?qrDock:qrHome],[results,docked?resultDock:resultHome]])
      if(node.parentElement!==target)target.append(node);
    sidebar.hidden=!docked;
  }
  media.addEventListener?.('change',sync);sync();return {sync};
}

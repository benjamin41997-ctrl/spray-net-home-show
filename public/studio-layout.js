/** Move the existing private media nodes, never copies, into the tablet's left
 * column. Phone/narrow layouts and closed studios restore their original homes. */
export function createStudioLayout({mode,studio,photos,results,photoHome,resultHome,sidebar,photoDock,resultDock,media=window.matchMedia('(min-width: 760px)')}){
  function sync(){
    const docked=mode==='tablet'&&media.matches&&!studio.hidden;
    for(const [node,target] of [[photos,docked?photoDock:photoHome],[results,docked?resultDock:resultHome]])
      if(node.parentElement!==target)target.append(node);
    sidebar.hidden=!docked;
  }
  media.addEventListener?.('change',sync);sync();return {sync};
}

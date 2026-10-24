/** The tablet uses full-width controls above its preview gallery. Keep its
 * single private QR on the saved-project screen, available through Back. */
export function createStudioLayout({mode,studio,results,resultHome,sidebar,resultDock,media=window.matchMedia('(min-width: 760px)')}){
  function sync(){
    const docked=mode==='tablet'&&media.matches&&!studio.hidden;
    const target=docked?resultDock:resultHome;
    if(results.parentElement!==target)target.append(results);
    sidebar.hidden=!docked;
  }
  media.addEventListener?.('change',sync);sync();return {sync};
}

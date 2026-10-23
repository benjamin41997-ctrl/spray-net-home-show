/** Reset only a booth session, keeping its URL and presentation in tablet mode.
 * The caller must finish/check any in-flight request before calling this. */
export function resetTabletSession({mode,url,history,body,storage,reset}) {
  if(mode!=='tablet')return false;
  const destination=new URL(url);
  destination.searchParams.set('mode','tablet');
  destination.hash='';
  storage.clear();
  history.replaceState(null,'',destination.pathname+destination.search);
  body.dataset.mode='tablet';
  reset();
  return true;
}

/** Keep a visible spinner and accessible busy state for the whole async action.
 * Repeated busy updates preserve the original button label for recovery. */
export function setBusy(button,busy,label){
  button.disabled=busy;button.classList.toggle('is-loading',busy);button.setAttribute('aria-busy',String(busy));
  if(busy){if(!button.dataset.label)button.dataset.label=button.textContent;button.textContent=label;}
  else if(button.dataset.label){button.textContent=button.dataset.label;delete button.dataset.label;}
}

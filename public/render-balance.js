/** The offer is not a visitor's balance. Only authenticated server responses
 * may populate remaining renders; a missing/invalid response fails closed. */
export function renderBalance(response) {
  if(!response||!Number.isInteger(response.remainingRenders)||response.remainingRenders<0||response.remainingRenders>10)
    throw new TypeError('Your preview balance could not be verified. Refresh your project before creating another preview.');
  return response.remainingRenders;
}

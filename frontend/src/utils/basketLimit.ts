// Beyond this many measurements the basket (and the plots it drives) slows
// the app down, so further adds are refused.
export const MAX_BASKET_ITEMS = 50;

export const BASKET_FULL_MESSAGE = `The basket holds at most ${MAX_BASKET_ITEMS} measurements. Remove some before adding more.`;

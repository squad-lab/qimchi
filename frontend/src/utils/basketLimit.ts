// Beyond this many measurements, the basket is
// considered full and no more measurements can
// be added to it. This is to avoid performance
// issues with the basket and the viewer, as well
// as to avoid cluttering the basket and viewer
// with too many measurements.
export const MAX_BASKET_ITEMS = 50;

export const BASKET_FULL_MESSAGE = `The basket holds at most ${MAX_BASKET_ITEMS} measurements. Remove some before adding more.`;

/** Move one entry of a list to another position. */
// # TODO: Check if this needs to be here as a separate function
export const moveItem = <T>(items: T[], from: number, to: number): T[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

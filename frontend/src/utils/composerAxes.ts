import type { ComposerSelectionSnapshot } from "../components/PlotComposer";

/** What is still missing before the Composer can plot. */
export const missingAxesMessage = (snapshot: ComposerSelectionSnapshot): string =>
  snapshot.x.length > 0 && snapshot.y.length > 0 && snapshot.plotType === "HeatMap"
    ? "Add a dependent to the Z-axis to plot a HeatMap."
    : "Add fields to the X and Y axes before plotting.";

/**
 * One plot per combination of axis fields: each Y of a LinePlot, and each
 * Y and Z pair of a HeatMap.
 */
export const axisCombinations = (
  snapshot: ComposerSelectionSnapshot,
): { indeps: string[]; deps: string[] }[] => {
  if (snapshot.plotType === "HeatMap") {
    // HeatMap maps independents as [y, x].
    return snapshot.x.flatMap((x) =>
      snapshot.y.flatMap((y) => snapshot.z.map((z) => ({ indeps: [y, x], deps: [z] }))),
    );
  }
  return snapshot.x.flatMap((x) => snapshot.y.map((y) => ({ indeps: [x], deps: [y] })));
};

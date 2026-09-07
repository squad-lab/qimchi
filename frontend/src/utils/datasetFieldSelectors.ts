/**
 * This file contains utility functions for working with datasets and their fields in the context of the Composer feature. It provides functions to compute shared fields among selected datasets, check compatibility between a Composer selection and dataset attributes, and determine eligible datasets for a given Composer selection.
 *
 * The main functions are:
 * - `computeSharedFields`: Computes the shared independent and dependent fields among a list of selected datasets.
 * - `isFieldShared`: Checks if a specific field is shared among the selected datasets based on the computed shared fields.
 * - `isComposerCompatibleWithDataset`: Determines if a dataset is compatible with the current Composer selection based on its attributes.
 * - `getEligibleDatasetsForComposer`: Categorizes selected datasets into eligible, ineligible, and unknown groups based on their compatibility with the Composer selection.
 * The file also defines TypeScript interfaces for dataset-like objects, composer selections, and the results of shared field computations and eligibility checks.
 *
 */

export interface DatasetAttributesLike {
  independents?: string[];
  dependents?: string[];
}

export interface DatasetLike {
  id: string;
  name: string;
  path: string;
  attributes?: DatasetAttributesLike;
}

export interface ComposerSelectionLike {
  indeps: string[];
  deps: string[];
}

export interface SharedFieldResult {
  sharedIndeps: Set<string>;
  sharedDeps: Set<string>;
  knownDatasetCount: number;
  unknownDatasetCount: number;
}

export interface EligibilityResult<T extends DatasetLike> {
  eligible: T[];
  ineligible: T[];
  unknown: T[];
}

const toSet = (values?: string[]): Set<string> => new Set(values ?? []);

const intersect = (base: Set<string>, next: Set<string>): Set<string> => {
  const result = new Set<string>();
  base.forEach((value) => {
    if (next.has(value)) {
      result.add(value);
    }
  });
  return result;
};

const hasAllNames = (set: Set<string>, values: string[]): boolean =>
  values.every((value) => set.has(value));

export const getSelectedDatasets = <T extends DatasetLike>(
  items: T[],
  selectedDatasetIds: Set<string>,
): T[] => {
  if (selectedDatasetIds.size === 0) {
    return [];
  }

  return items.filter((item) => selectedDatasetIds.has(item.id));
};

export const computeSharedFields = <T extends DatasetLike>(
  selectedDatasets: T[],
): SharedFieldResult => {
  const datasetsWithAttrs = selectedDatasets.filter(
    (dataset) =>
      Array.isArray(dataset.attributes?.independents) ||
      Array.isArray(dataset.attributes?.dependents),
  );

  if (datasetsWithAttrs.length === 0) {
    return {
      sharedIndeps: new Set(),
      sharedDeps: new Set(),
      knownDatasetCount: 0,
      unknownDatasetCount: selectedDatasets.length,
    };
  }

  let sharedIndeps = toSet(datasetsWithAttrs[0].attributes?.independents);
  let sharedDeps = toSet(datasetsWithAttrs[0].attributes?.dependents);

  datasetsWithAttrs.slice(1).forEach((dataset) => {
    sharedIndeps = intersect(sharedIndeps, toSet(dataset.attributes?.independents));
    sharedDeps = intersect(sharedDeps, toSet(dataset.attributes?.dependents));
  });

  return {
    sharedIndeps,
    sharedDeps,
    knownDatasetCount: datasetsWithAttrs.length,
    unknownDatasetCount: selectedDatasets.length - datasetsWithAttrs.length,
  };
};

export const isFieldShared = (
  fieldName: string,
  type: "independent" | "dependent",
  sharedFields: SharedFieldResult,
): boolean => {
  if (type === "independent") {
    return sharedFields.sharedIndeps.has(fieldName);
  }
  return sharedFields.sharedDeps.has(fieldName);
};

export const isComposerCompatibleWithDataset = (
  composerSelection: ComposerSelectionLike,
  datasetAttributes?: DatasetAttributesLike,
): boolean | "unknown" => {
  if (!datasetAttributes) {
    return "unknown";
  }

  const indeps = toSet(datasetAttributes.independents);
  const deps = toSet(datasetAttributes.dependents);

  const indepsMatch = hasAllNames(indeps, composerSelection.indeps);
  const depsMatch = hasAllNames(deps, composerSelection.deps);

  return indepsMatch && depsMatch;
};

export const getEligibleDatasetsForComposer = <T extends DatasetLike>(
  selectedDatasets: T[],
  composerSelection: ComposerSelectionLike,
): EligibilityResult<T> => {
  const eligible: T[] = [];
  const ineligible: T[] = [];
  const unknown: T[] = [];

  selectedDatasets.forEach((dataset) => {
    const compatibility = isComposerCompatibleWithDataset(composerSelection, dataset.attributes);

    if (compatibility === "unknown") {
      unknown.push(dataset);
      return;
    }

    if (compatibility) {
      eligible.push(dataset);
    } else {
      ineligible.push(dataset);
    }
  });

  return { eligible, ineligible, unknown };
};

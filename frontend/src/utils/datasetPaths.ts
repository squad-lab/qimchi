/**
 * Utility functions for working with dataset paths and tags.
 *
 * This module provides functions to identify and classify dataset paths based on their extensions and tags. It supports various dataset formats such as Zarr, NetCDF, HDF5, SQLite, CSV, and more. The functions can be used to determine if a given path is a dataset path, if it has specific tags, and to detect the kind of dataset based on its path and tags.
 *
 * The supported dataset formats are determined by their file extensions and associated tags. The module also includes functionality to handle in-memory datasets (identified by the "memory://" prefix) and to normalize paths for consistent comparison.
 *
 */

const DATASET_EXTENSIONS = [
  ".zarr",
  ".nc",
  ".h5",
  ".hdf5",
  ".db",
  ".sqlite",
  ".csv",
  ".txt",
  ".dat",
] as const;
const DATASET_TAGS = ["zarr", "netcdf", "hdf5", "qcodes", "sqlite", "csv"] as const;
export type DatasetKind = "zarr" | "netcdf" | "hdf5" | "qcodes" | "sqlite" | "csv" | "unknown";

const normalizeDatasetPath = (path: string): string => path.split("#", 1)[0].toLowerCase();

export const isMemoryPath = (path: string): boolean => path.startsWith("memory://");

export const isZarrPath = (path: string): boolean => path.toLowerCase().endsWith(".zarr");

export const isDatasetPath = (path: string): boolean => {
  if (isMemoryPath(path)) return true;
  const lower = normalizeDatasetPath(path);
  return DATASET_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

export const isDatasetTag = (tag: string): boolean =>
  DATASET_TAGS.includes(tag as (typeof DATASET_TAGS)[number]);

export const hasDatasetTag = (tags?: string[]): boolean =>
  Array.isArray(tags) && tags.some(isDatasetTag);

export const isDatasetNode = (node: { type?: string; path?: string; tags?: string[] }): boolean =>
  node.type === "file" &&
  typeof node.path === "string" &&
  (isDatasetPath(node.path) || hasDatasetTag(node.tags));

export const isSqliteContainerPath = (path: string): boolean => {
  const lower = normalizeDatasetPath(path);
  return (lower.endsWith(".db") || lower.endsWith(".sqlite")) && !path.includes("#");
};

export const detectDatasetKind = (path: string, tags?: string[]): DatasetKind => {
  if (Array.isArray(tags)) {
    if (tags.includes("zarr")) return "zarr";
    if (tags.includes("netcdf")) return "netcdf";
    if (tags.includes("hdf5")) return "hdf5";
    if (tags.includes("qcodes") || tags.includes("qcodes-run")) return "qcodes";
    if (tags.includes("sqlite")) return "sqlite";
    if (tags.includes("csv")) return "csv";
  }

  if (isMemoryPath(path)) {
    return "zarr";
  }

  const lower = normalizeDatasetPath(path);
  if (lower.endsWith(".zarr")) return "zarr";
  if (lower.endsWith(".nc")) return "netcdf";
  if (lower.endsWith(".h5") || lower.endsWith(".hdf5")) return "hdf5";
  if (lower.endsWith(".db") || lower.endsWith(".sqlite")) return "sqlite";
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".dat")) {
    return "csv";
  }

  return "unknown";
};

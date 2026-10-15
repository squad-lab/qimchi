export interface MetadataMatch {
  key: string;
  value: string;
  path: string[];
}

/**
 * Find entries whose key or string/number value contains `query`, ignoring case.
 * Search all levels, including top-level attributes such as "Sample Name".
 */
export const searchMetadata = (
  obj: unknown,
  query: string,
  path: string[] = [],
): MetadataMatch[] => {
  const results: MetadataMatch[] = [];
  const lowerQuery = query.toLowerCase();
  if (typeof obj !== "object" || obj === null) return results;

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...path, key];
    const isPrimitive = typeof value === "string" || typeof value === "number";
    if (
      key.toLowerCase().includes(lowerQuery) ||
      (isPrimitive && String(value).toLowerCase().includes(lowerQuery))
    ) {
      results.push({ key, value: String(value), path: currentPath });
    }
    if (typeof value === "object" && value !== null) {
      results.push(...searchMetadata(value, query, currentPath));
    }
  }
  return results;
};

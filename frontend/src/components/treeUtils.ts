/**
 * Tree related types and utilities
 * This file contains only data structures and helper functions to ensure
 * React Fast Refresh works correctly in component files (like DirTree.tsx)
 */

// Interface for items as they come from the API
export interface ApiNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  timestamp?: string;
  tags?: string[];
  children?: ApiNode[];
  lastModified?: number;
}

// NOTE: API for items that will go on the Tree
export interface TreeNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  timestamp?: Date;
  tags?: string[];
  children?: TreeNode[];
  lastModified?: number;
}

/**
 * Utility to convert ApiNode to TreeNode (converts string timestamps to Date objects)
 */
export const convertApiNode = (apiNode: ApiNode): TreeNode => {
  return {
    id: apiNode.id,
    name: apiNode.name,
    path: apiNode.path,
    type: apiNode.type,
    size: apiNode.size,
    timestamp: apiNode.timestamp ? new Date(apiNode.timestamp) : undefined,
    tags: apiNode.tags,
    children: apiNode.children ? apiNode.children.map(convertApiNode) : undefined,
    lastModified: apiNode.lastModified,
  };
};

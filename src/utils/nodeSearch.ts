import { Node } from '../types';

export const normalizeNodeSearchQuery = (query: string): string =>
  query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export const getProjectNodeSearchResults = (
  nodesById: Record<string, Node>,
  projectId: string,
  query: string
): string[] => {
  const normalizedQuery = normalizeNodeSearchQuery(query);
  if (!normalizedQuery) return [];

  return Object.values(nodesById)
    .filter((node) => node.project_id === projectId)
    .filter((node) => node.content.toLocaleLowerCase().includes(normalizedQuery))
    .sort((a, b) => {
      const byTimestamp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (byTimestamp !== 0) return byTimestamp;
      return a.node_id.localeCompare(b.node_id);
    })
    .map((node) => node.node_id);
};

export const stepNodeSearchIndex = (
  currentIndex: number,
  total: number,
  direction: 'next' | 'prev'
): number => {
  if (total <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= total) {
    return direction === 'next' ? 0 : total - 1;
  }
  if (direction === 'next') {
    return (currentIndex + 1) % total;
  }
  return (currentIndex - 1 + total) % total;
};

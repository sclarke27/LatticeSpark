/**
 * Normalize a node ID to lowercase trimmed string.
 *
 * @param {string|null|undefined} nodeId
 * @returns {string}
 */
export function normalizeNodeId(nodeId) {
  return String(nodeId || '').trim().toLowerCase();
}

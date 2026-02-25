// Time range presets for sensor card charts
export const TIME_RANGES = [
  { id: '1m',  label: '1m',  seconds: 60,     fetchLimit: 500 },
  { id: '5m',  label: '5m',  seconds: 300,    fetchLimit: 1000 },
  { id: '30m', label: '30m', seconds: 1800,   fetchLimit: 2000 },
  { id: '1h',  label: '1h',  seconds: 3600,   fetchLimit: 2000 },
  { id: '6h',  label: '6h',  seconds: 21600,  fetchLimit: 5000 },
  { id: '24h', label: '24h', seconds: 86400,  fetchLimit: 10000 },
  { id: '3d',  label: '3d',  seconds: 259200, fetchLimit: 20000 },
  { id: '7d',  label: '7d',  seconds: 604800, fetchLimit: 50000 },
];

export const DEFAULT_RANGE_ID = '1m';
export const MAX_DISPLAY_POINTS = 500;

export function getRangeById(id) {
  return TIME_RANGES.find(r => r.id === id) || TIME_RANGES[0];
}

/**
 * Downsample an array of points to at most maxPoints using nth-point decimation.
 * Always includes the last point for continuity with live data.
 */
export function downsample(points, maxPoints = MAX_DISPLAY_POINTS) {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.floor(i * step)]);
  }
  // Ensure the last point is included
  result[result.length - 1] = points[points.length - 1];
  return result;
}

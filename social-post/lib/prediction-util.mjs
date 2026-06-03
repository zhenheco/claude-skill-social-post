export const TIER_KEYS = Object.freeze(['flop', 'pass', 'good', 'viral', 'mega']);

export function normalizeDist(dist) {
  return Object.fromEntries(TIER_KEYS.map((key) => [key, dist[key]]));
}

export function sumsToOne(dist, tolerance = 0.01) {
  const sum = TIER_KEYS.reduce((total, key) => total + Number(dist[key] ?? 0), 0);
  return Math.abs(sum - 1) <= tolerance;
}

export function brierTier(dist, realizedTier) {
  return TIER_KEYS.reduce((total, key) => {
    const target = key === realizedTier ? 1 : 0;
    return total + (dist[key] - target) ** 2;
  }, 0);
}

export function brierConvert(pConvert, realized) {
  return (pConvert - (realized ? 1 : 0)) ** 2;
}

export function realizedTier(row) {
  if (row.realized_tier) return row.realized_tier;
  const metric = row.metrics?.[row.primary_metric];
  const value = Number(metric?.value ?? 0);
  if (value < 100) return 'flop';
  if (value < 500) return 'pass';
  if (value < 2000) return 'good';
  if (value < 10000) return 'viral';
  return 'mega';
}

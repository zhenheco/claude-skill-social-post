import { appendRow } from './metrics-store.mjs';

export const SNAPSHOT_SLOTS = Object.freeze(['6h', '24h', '48h', '72h']);

function emptySnapshots() {
  return Object.fromEntries(SNAPSHOT_SLOTS.map((slot) => [slot, null]));
}

function normalizeMetric(metric, method) {
  const state = metric.state ?? (metric.value == null ? 'absent' : 'captured');
  return {
    value: state === 'absent' ? null : metric.value,
    state,
    capture_method: method,
    confidence: metric.confidence,
    plateau_age: metric.plateau_age ?? null,
    counts_toward_publish_trust: metric.counts_toward_publish_trust ?? state !== 'absent',
  };
}

function normalizeMetrics(metrics, method) {
  return Object.fromEntries(
    Object.entries(metrics).map(([name, metric]) => [name, normalizeMetric(metric, method)]),
  );
}

function enrichMetric(existing, patch) {
  if (!existing || existing.state === 'absent') return normalizeMetric(patch, 'scrape');
  if (existing.capture_method === 'manual') return structuredClone(existing);
  if (existing.capture_method === 'scrape' && patch.confidence > (existing.confidence ?? 0)) {
    return { ...structuredClone(existing), confidence: patch.confidence };
  }
  return structuredClone(existing);
}

function baseRow(input, overrides = {}) {
  return {
    post_id: input.post_id,
    platform: input.platform,
    language: input.language,
    voice_version: input.voice_version,
    posted_at: input.posted_at,
    primary_metric: input.primary_metric,
    plateau_window: input.plateau_window,
    maturity: input.maturity ?? 'provisional',
    metrics: {},
    snapshots: emptySnapshots(),
    ...overrides,
  };
}

function noDataRow(input) {
  return baseRow(input, {
    kind: 'no-data',
    counts_as_prediction_miss: false,
  });
}

function hasMetrics(metrics) {
  return metrics && typeof metrics === 'object' && Object.keys(metrics).length > 0;
}

export function isPredictionMiss(row) {
  return row?.kind !== 'no-data' && row?.counts_as_prediction_miss === true;
}

export async function capture(input, options = {}) {
  const row = hasMetrics(input.metrics)
    ? baseRow(input, { metrics: normalizeMetrics(input.metrics, input.method ?? 'manual') })
    : noDataRow(input);
  await appendRow(row, options);
  return Object.freeze(row);
}

export function enrich(row, scrapePatch) {
  const metrics = { ...(row.metrics ?? {}) };
  for (const [name, patch] of Object.entries(scrapePatch ?? {})) {
    metrics[name] = enrichMetric(metrics[name], patch);
  }
  return { ...structuredClone(row), metrics };
}

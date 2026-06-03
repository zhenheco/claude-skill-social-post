import { APEX_TOKENS } from '../core-schema.mjs';
import { parseUtm } from './utm.mjs';

export const APEX_CONVERSION_TYPE_MAP = Object.freeze({
  [APEX_TOKENS[0]]: 'line_join',
  [APEX_TOKENS[1]]: 'consult_or_paid',
});
const CONVERSION_TYPES = Object.freeze(Object.values(APEX_CONVERSION_TYPE_MAP));

function emptyCounts() {
  return { line_join: 0, consult_or_paid: 0 };
}

function extractUtm(row) {
  if (row.utm != null) return row.utm;
  if (row.query != null) return row.query;
  if (row.url == null) return '';
  try {
    return new URL(row.url).search;
  } catch {
    return '';
  }
}

export function groupKey(conversion) {
  return [conversion.channel, conversion.thread, conversion.format].map((part) => part ?? '').join('|');
}

function dedupeKey(conversion) {
  return [
    conversion.channel,
    conversion.thread,
    conversion.format,
    conversion.topic_id,
    conversion.conversion_id,
  ].map((part) => part ?? '').join('|');
}

function conversionType(value) {
  return CONVERSION_TYPES.includes(value) ? value : null;
}

function predictionId(row) {
  return row.id ?? row.prediction_id ?? null;
}

function addIndexEntry(index, key, id) {
  if (key == null || id == null) return;
  const current = index.get(key) ?? [];
  index.set(key, [...current, id]);
}

function predictionIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    if (row.type != null && row.type !== 'social-prediction') continue;
    const id = predictionId(row);
    addIndexEntry(index, `topic:${row.topic_id}`, id);
    addIndexEntry(index, `post:${row.post_id}`, id);
  }
  return index;
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null))];
}

function matchingPredictionIds(index, conversion) {
  return unique([
    ...(index.get(`topic:${conversion.topic_id}`) ?? []),
    ...(index.get(`post:${conversion.post_id}`) ?? []),
  ]);
}

export function linkPredictions(apexView, predictionRows = []) {
  const index = predictionIndex(predictionRows);
  return {
    ...apexView,
    groups: apexView.groups.map((group) => {
      const conversions = group.conversions.map((conversion) => {
        const ids = matchingPredictionIds(index, conversion);
        return {
          ...conversion,
          prediction_id: ids[0] ?? null,
        };
      });
      return {
        ...group,
        conversions,
        prediction_ids: unique(conversions.map((conversion) => conversion.prediction_id)),
      };
    }),
  };
}

export function normalizeConversion(row, sourceSystem = null) {
  const parsed = parseUtm(extractUtm(row));
  const utm = parsed.ok ? parsed.value : {};
  const normalized = {
    channel: row.channel ?? utm.channel ?? null,
    thread: row.thread ?? utm.thread ?? null,
    format: row.format ?? utm.format ?? null,
    topic_id: row.topic_id ?? utm.topic_id ?? null,
    post_id: row.post_id ?? null,
    ts: row.ts ?? null,
    converted: row.converted ?? true,
    conversion_type: conversionType(row.conversion_type),
    conversion_id: row.conversion_id ?? null,
    source_system: sourceSystem,
  };
  return Object.freeze(normalized);
}

export function joinApexView(ga4Rows = [], d1Rows = []) {
  const inputs = [
    ...ga4Rows.map((row) => normalizeConversion(row, 'ga4')),
    ...d1Rows.map((row) => normalizeConversion(row, 'lead_magnet_d1')),
  ];
  const seen = new Set();
  const groups = new Map();

  for (const conversion of inputs) {
    if (!conversion.converted || !conversion.conversion_type) continue;
    const unique = dedupeKey(conversion);
    if (seen.has(unique)) continue;
    seen.add(unique);

    const key = groupKey(conversion);
    const current = groups.get(key) ?? {
      key,
      channel: conversion.channel,
      thread: conversion.thread,
      format: conversion.format,
      counts: emptyCounts(),
      conversions: [],
    };

    groups.set(key, {
      ...current,
      counts: {
        ...current.counts,
        [conversion.conversion_type]: current.counts[conversion.conversion_type] + 1,
      },
      conversions: [...current.conversions, conversion],
    });
  }

  return {
    kind: 'apex_conversion_view',
    apex_metrics: [...APEX_TOKENS],
    groups: [...groups.values()],
  };
}

function readClientRows(client, opts) {
  if (!client || typeof client.fetchConversions !== 'function') {
    throw new Error('injected attribution client must expose fetchConversions');
  }
  return client.fetchConversions(opts);
}

export async function fetchApexView({ ga4Client, d1Client } = {}, opts = {}) {
  const [ga4Rows, d1Rows] = await Promise.all([
    readClientRows(ga4Client, opts),
    readClientRows(d1Client, opts),
  ]);
  return joinApexView(ga4Rows, d1Rows);
}

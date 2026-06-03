import { mad, median } from './stats.mjs';

const DEFAULT_CONFIG = Object.freeze({
  formula: Object.freeze({ min_n: 5, window_weeks: Object.freeze([4, 8]), min_effect_mad: 1 }),
  voice: Object.freeze({ min_n: 3 }),
  impressions_floor: 500,
});

const CANDIDATE_KEYS = Object.freeze([
  'platform', 'type', 'target', 'score_dimension', 'metric', 'n',
  'window_weeks', 'effect_size', 'verdict', 'reason', 'evidence_ids',
]);

function configWithDefaults(config = {}) {
  return {
    formula: { ...DEFAULT_CONFIG.formula, ...(config.formula ?? {}) },
    voice: { ...DEFAULT_CONFIG.voice, ...(config.voice ?? {}) },
    impressions_floor: config.impressions_floor ?? DEFAULT_CONFIG.impressions_floor,
  };
}

// UTC hour buckets keep analysis deterministic across cron hosts.
export function timeBucket(postedAt) {
  const hour = new Date(postedAt).getUTCHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 16) return 'midday';
  if (hour >= 16 && hour < 22) return 'evening';
  return 'late';
}

function missingGroupKey(row) {
  for (const key of ['platform', 'formula', 'topic_intent', 'posted_at']) {
    if (row?.[key] == null || row[key] === '') return key;
  }
  return null;
}

function groupKey(row) {
  return [row.platform, row.formula, row.topic_intent, timeBucket(row.posted_at)].join('|');
}

function scoreKey(row) {
  return [row.score_dimension ?? 'distribution', row.primary_metric].join('|');
}

function metricState(row, metric) {
  return row.metrics?.[metric]?.state;
}

function metricValue(row, metric) {
  const value = row.metrics?.[metric]?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasCapturedImpressionsBelowFloor(row, floor) {
  const impressions = row.metrics?.impressions;
  return impressions?.state === 'captured' && typeof impressions.value === 'number' && impressions.value < floor;
}

function weeksBetween(rows) {
  if (rows.length < 2) return 0;
  const times = rows.map((row) => new Date(row.posted_at).getTime()).sort((a, b) => a - b);
  const weeks = (times.at(-1) - times[0]) / (7 * 24 * 60 * 60 * 1000);
  return Math.ceil(weeks);
}

function rounded(num) {
  return Math.round(num * 100) / 100;
}

function candidate(fields) {
  const exact = Object.fromEntries(CANDIDATE_KEYS.map((key) => [key, fields[key]]));
  exact.evidence_ids = Object.freeze([...exact.evidence_ids]);
  return Object.freeze(exact);
}

function audit(fields) {
  return Object.freeze({
    ...fields,
    evidence_ids: Object.freeze([...(fields.evidence_ids ?? [])]),
  });
}

function platformValues(rows, platform, metric) {
  return rows
    .filter((row) => row.platform === platform && metricState(row, metric) !== 'absent')
    .map((row) => metricValue(row, metric))
    .filter((value) => value != null);
}

function scoreGroup(groupRows, allRows, cfg) {
  const sample = groupRows[0];
  const metric = sample.primary_metric;
  const scoredRows = groupRows.filter((row) => !hasCapturedImpressionsBelowFloor(row, cfg.impressions_floor));
  const windowWeeks = weeksBetween(scoredRows);
  const evidenceIds = scoredRows.map((row) => row.post_id);
  const type = sample.voice_facet ? 'voice_tweak' : 'formula_reweight';
  const target = type === 'voice_tweak' ? sample.voice_facet : sample.formula;
  const base = {
    platform: sample.platform,
    type,
    target,
    score_dimension: sample.score_dimension ?? 'distribution',
    metric,
    n: scoredRows.length,
    window_weeks: windowWeeks,
    effect_size: 0,
    reason: null,
    evidence_ids: evidenceIds,
  };

  if (type === 'voice_tweak') {
    const minN = cfg.voice.min_n;
    return candidate({
      ...base,
      verdict: scoredRows.length >= minN ? 'win' : 'watchlist',
      reason: scoredRows.length >= minN ? 'voice-signal-only' : `min-evidence: n=${scoredRows.length} < ${minN}`,
    });
  }

  const minN = cfg.formula.min_n;
  const [minWeeks, maxWeeks] = cfg.formula.window_weeks;
  if (scoredRows.length < minN) {
    return candidate({ ...base, verdict: 'watchlist', reason: `min-evidence: n=${scoredRows.length} < ${minN}` });
  }
  if (windowWeeks < minWeeks || windowWeeks > maxWeeks) {
    return candidate({ ...base, verdict: 'watchlist', reason: `window: ${windowWeeks}wk outside ${minWeeks}-${maxWeeks}` });
  }

  const values = scoredRows.map((row) => metricValue(row, metric)).filter((value) => value != null);
  const baseline = platformValues(allRows, sample.platform, metric);
  const platformMedian = median(baseline);
  const platformMad = mad(baseline, { scale: 'raw' });
  const winner = Math.max(...values);
  const spread = Math.max(...baseline) - Math.min(...baseline);
  if (platformMad === 0 && spread === 0) {
    return audit({ ...base, verdict: 'inconclusive', reason: 'mad-zero:no-separation' });
  }

  const effectSize = platformMad === 0 ? Infinity : (winner - platformMedian) / platformMad;
  const effectRounded = rounded(effectSize);
  if ((winner - platformMedian) >= cfg.formula.min_effect_mad * platformMad) {
    return candidate({ ...base, effect_size: effectRounded, verdict: 'win', reason: 'min-evidence-and-effect-size-met' });
  }
  return candidate({
    ...base,
    effect_size: effectRounded,
    verdict: 'watchlist',
    reason: `effect-size: ${effectRounded.toFixed(2)} MAD < ${cfg.formula.min_effect_mad.toFixed(2)}`,
  });
}

export function analyze(rows = [], config = {}) {
  const cfg = configWithDefaults(config);
  const dropped = [];
  const groups = new Map();
  const matured = rows.filter((row) => row?.maturity === 'matured');

  for (const row of matured) {
    const missing = missingGroupKey(row);
    if (missing) {
      dropped.push(audit({ post_id: row?.post_id, reason: `missing-group-key:${missing}` }));
      continue;
    }
    const metric = row.primary_metric;
    if (metricState(row, metric) === 'absent') {
      dropped.push(audit({
        platform: row.platform,
        target: row.formula,
        post_id: row.post_id,
        reason: `refuses-absent-metric:${metric}`,
      }));
      continue;
    }
    const key = groupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const candidates = [];
  const inconclusive = [];
  for (const groupedRows of groups.values()) {
    const scoreGroups = new Map();
    for (const row of groupedRows) {
      const key = scoreKey(row);
      scoreGroups.set(key, [...(scoreGroups.get(key) ?? []), row]);
    }
    for (const scoreRows of scoreGroups.values()) {
      const scored = scoreGroup(scoreRows, matured, cfg);
      if (scored.verdict === 'inconclusive') inconclusive.push(scored);
      else candidates.push(scored);
    }
  }

  return Object.freeze({
    candidates: Object.freeze(candidates),
    dropped: Object.freeze(dropped),
    inconclusive: Object.freeze(inconclusive),
  });
}

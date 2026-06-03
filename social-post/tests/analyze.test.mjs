import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, timeBucket } from '../lib/analyze.mjs';

const baseMetrics = (value, metric = 'profile_visits', state = 'captured', impressions = 800) => ({
  [metric]: {
    value,
    state,
    capture_method: 'manual',
    plateau_age: 72,
    counts_toward_publish_trust: metric !== 'impressions',
  },
  impressions: {
    value: metric === 'impressions' ? value : impressions,
    state: metric === 'impressions' ? state : 'captured',
    capture_method: 'manual',
    plateau_age: 72,
    counts_toward_publish_trust: false,
  },
});

function row(overrides = {}) {
  return {
    post_id: overrides.post_id ?? 'p1',
    platform: overrides.platform ?? 'facebook',
    language: 'zh-tw',
    voice_version: '0.1.0',
    posted_at: overrides.posted_at ?? '2026-04-01T08:00:00.000Z',
    primary_metric: overrides.primary_metric ?? 'profile_visits',
    plateau_window: '72h',
    maturity: overrides.maturity ?? 'matured',
    formula: Object.hasOwn(overrides, 'formula') ? overrides.formula : 'F1',
    topic_intent: overrides.topic_intent ?? 'teach',
    voice_facet: overrides.voice_facet,
    score_dimension: overrides.score_dimension ?? 'conversion_proxy',
    metrics: overrides.metrics ?? baseMetrics(overrides.value ?? 100, overrides.primary_metric ?? 'profile_visits', overrides.state ?? 'captured', overrides.impressions ?? 800),
  };
}

function rowsFrom(values, overrides = {}) {
  return values.map((value, index) => row({
    post_id: `${overrides.prefix ?? 'p'}${index + 1}`,
    value,
    posted_at: new Date(Date.UTC(2026, 3, 1 + index * 8, 8)).toISOString(),
    ...overrides,
  }));
}

test('filters to matured rows, derives time buckets, and drops malformed rows', () => {
  assert.equal(timeBucket('2026-04-01T08:00:00.000Z'), 'morning');
  assert.equal(timeBucket('2026-04-01T12:00:00.000Z'), 'midday');
  assert.equal(timeBucket('2026-04-01T18:00:00.000Z'), 'evening');
  assert.equal(timeBucket('2026-04-01T23:00:00.000Z'), 'late');

  const result = analyze([
    ...rowsFrom([100, 102], { prefix: 'm' }),
    ...rowsFrom([1000, 1100, 1200, 1300, 1400], { maturity: 'provisional', prefix: 'prov' }),
    row({ post_id: 'bad', formula: undefined }),
  ]);

  assert.equal(result.candidates.find((candidate) => candidate.target === 'F1')?.n, 2);
  assert.equal(result.candidates.find((candidate) => candidate.target === 'F1')?.verdict, 'watchlist');
  assert.equal(result.dropped.find((entry) => entry.post_id === 'bad')?.reason, 'missing-group-key:formula');
});

test('formula candidates require min evidence, 4-8 week window, and at least 1 MAD effect', () => {
  const belowN = analyze(rowsFrom([100, 110, 120, 1000], { prefix: 'n' })).candidates[0];
  assert.equal(belowN.verdict, 'watchlist');
  assert.equal(belowN.reason, 'min-evidence: n=4 < 5');

  const belowEffectRows = [
    ...rowsFrom([100, 100, 100, 110, 110, 110], { prefix: 'e' }),
    ...rowsFrom([0, 1000, 1000, 1000, 1000, 1000], {
      prefix: 'b',
      formula: 'F2',
      posted_at: '2026-04-01T12:00:00.000Z',
    }),
  ];
  const belowEffect = analyze(belowEffectRows).candidates.find((candidate) => candidate.target === 'F1');
  assert.equal(belowEffect.verdict, 'watchlist');
  assert.match(belowEffect.reason, /^effect-size: -?\d+\.\d{2} MAD < 1\.00$/);

  const win = analyze(rowsFrom([100, 100, 100, 100, 100, 1000], { prefix: 'w' })).candidates[0];
  assert.equal(win.verdict, 'win');
  assert.equal(win.n, 6);
  assert.equal(win.window_weeks, 6);
  assert.ok(win.effect_size >= 1);
  assert.deepEqual(win.evidence_ids, ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);

  const outsideWindow = analyze(rowsFrom([100, 100, 100, 100, 100, 1000], {
    prefix: 'ow',
    posted_at: undefined,
  }).map((item, index) => ({ ...item, posted_at: `2026-${index === 5 ? '06-10' : `04-${String(1 + index).padStart(2, '0')}`}T08:00:00.000Z` }))).candidates[0];
  assert.equal(outsideWindow.verdict, 'watchlist');
  assert.equal(outsideWindow.reason, 'window: 10wk outside 4-8');
});

test('MAD zero with no separation is inconclusive no-op', () => {
  const result = analyze(rowsFrom([100, 100, 100, 100, 100], { prefix: 'flat' }));

  assert.equal(result.candidates.length, 0);
  assert.equal(result.inconclusive[0].verdict, 'inconclusive');
});

test('voice candidates require three corroborating matured posts', () => {
  const two = analyze(rowsFrom([100, 100], { formula: 'voice:warmer', voice_facet: 'warmer', prefix: 'v2' })).candidates[0];
  const three = analyze(rowsFrom([100, 100, 100], { formula: 'voice:warmer', voice_facet: 'warmer', prefix: 'v3' })).candidates[0];

  assert.equal(two.type, 'voice_tweak');
  assert.equal(two.verdict, 'watchlist');
  assert.equal(two.reason, 'min-evidence: n=2 < 3');
  assert.equal(three.type, 'voice_tweak');
  assert.equal(three.n, 3);
});

test('refuses absent metrics and applies captured impressions floor', () => {
  const absent = analyze(rowsFrom([100, 100, 100, 100, 100, 1000], {
    primary_metric: 'link_clicks',
    state: 'absent',
    prefix: 'abs',
  }));
  assert.equal(absent.candidates.length, 0);
  assert.equal(absent.dropped[0].reason, 'refuses-absent-metric:link_clicks');

  const floored = analyze([
    ...rowsFrom([1000, 1001, 1002], { impressions: 100, prefix: 'low' }),
    ...rowsFrom([100, 100, 100, 100, 1000], { impressions: 800, prefix: 'hi' }),
  ]);
  assert.equal(floored.candidates[0].n, 5);
  assert.deepEqual(floored.candidates[0].evidence_ids, ['hi1', 'hi2', 'hi3', 'hi4', 'hi5']);
});

test('keeps score dimensions separate, freezes output, and emits exact candidate contract', () => {
  const input = [
    ...rowsFrom([100, 100, 100, 100, 100, 1000], { score_dimension: 'distribution', primary_metric: 'impressions', prefix: 'd' }),
    ...rowsFrom([50, 50, 50, 50, 50, 500], { score_dimension: 'conversion_proxy', primary_metric: 'profile_visits', prefix: 'c' }),
  ];
  const before = structuredClone(input);
  const result = analyze(input, { impressions_floor: 0 });

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result.candidates), true);
  assert.equal(Object.isFrozen(result.candidates[0]), true);
  assert.deepEqual(result.candidates.map((candidate) => candidate.score_dimension).sort(), ['conversion_proxy', 'distribution']);
  assert.deepEqual(Object.keys(result.candidates[0]).sort(), [
    'effect_size',
    'evidence_ids',
    'metric',
    'n',
    'platform',
    'reason',
    'score_dimension',
    'target',
    'type',
    'verdict',
    'window_weeks',
  ]);
});

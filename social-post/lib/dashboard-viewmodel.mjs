import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { readJson, decisionsFile } from './adapters/adapter-iface.mjs';
import * as predictionAdapter from './adapters/prediction-adapter.mjs';
import { PLATFORMS } from './metrics-schema.mjs';
import { readRows } from './metrics-store.mjs';
import { resolve } from './paths.mjs';
import { parse as parseYaml } from './yaml.mjs';

const TRUST_DIMS = Object.freeze(['distribution', 'engagement_quality', 'conversion_proxy']);
const TRUST_THRESHOLD = 0.95;

function metricValue(row, names) {
  for (const name of names) {
    const value = row.metrics?.[name]?.value;
    if (typeof value === 'number') return value;
  }
  return 0;
}

function isMatured(row) {
  return row?.maturity === 'matured' || (row?.age_hours >= 72 && row?.second_push_done === true);
}

async function loadMetrics(platform, options) {
  const file = resolve('metrics', platform, options.env, options.configPath).path;
  try {
    const rows = await readRows(file);
    return rows.filter(isMatured);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    return [];
  }
}

function toTrendPoint(row) {
  return Object.freeze({
    post_id: row.post_id,
    platform: row.platform,
    posted_at: row.posted_at,
    formula_id: row.formula_id ?? 'unknown',
    reach: metricValue(row, ['reach']),
    engagement: metricValue(row, ['engagement', 'engagement_quality']),
    conversion_proxy: metricValue(row, ['conversion_proxy', 'downstream_converts']),
    per_view: metricValue(row, ['reach_per_view', 'per_view']),
  });
}

function leaderboardFor(platform, rows) {
  const groups = new Map();
  for (const row of rows) {
    const formula = row.formula_id ?? 'unknown';
    const current = groups.get(formula) ?? { reach: 0, engagement: 0, conversion_proxy: 0, per_view: 0, n: 0 };
    const point = toTrendPoint(row);
    groups.set(formula, {
      reach: current.reach + point.reach,
      engagement: current.engagement + point.engagement,
      conversion_proxy: current.conversion_proxy + point.conversion_proxy,
      per_view: current.per_view + point.per_view,
      n: current.n + 1,
    });
  }
  return [...groups.entries()]
    .map(([formula_id, values]) => Object.freeze({
      platform,
      formula_id,
      n: values.n,
      reach: values.reach,
      engagement: values.engagement,
      conversion_proxy: values.conversion_proxy,
      per_view: values.n ? values.per_view / values.n : 0,
    }))
    .sort((a, b) => b.conversion_proxy - a.conversion_proxy || b.per_view - a.per_view);
}

async function trustFor(platform, options) {
  const root = resolve('state_root', platform, options.env, options.configPath).path;
  const file = path.join(root, platform, 'trust-posterior.json');
  const store = await readJson(file, { dimensions: {} });
  return TRUST_DIMS.map((dim) => {
    const posterior = store.dimensions?.[dim] ?? store.dimensions?.[dim.replaceAll('_', '-')] ?? {};
    const value = typeof posterior.lower_bound === 'number' ? posterior.lower_bound : null;
    return Object.freeze({
      platform,
      dimension: dim,
      value,
      distance_to_graduation: value == null ? null : Math.max(0, TRUST_THRESHOLD - value),
      display_only: true,
      label: 'graduation: OFF (propose-only) — display only, no graduation this subset',
    });
  });
}

function scoreValue(value) {
  if (value === 'absent' || value === 'none' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseScore(lines, start) {
  const score = {};
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  [a-zA-Z_ -]+:\s*$/.test(line) || /^- \[ \] proposal_id:/.test(line)) break;
    const match = line.match(/^    ([a-z_]+):\s*(.*)$/);
    if (!match) continue;
    score[match[1]] = match[1] === 'value' ? scoreValue(match[2]) : scoreValue(match[2]) ?? match[2];
  }
  return Object.freeze({
    value: score.value ?? null,
    n: typeof score.n === 'number' ? score.n : 0,
    effect_size: typeof score.effect_size === 'number' ? score.effect_size : 0,
    source_metric: score.source_metric ?? 'absent',
    status: score.status ?? 'absent',
  });
}

function parseProposalBlock(block) {
  const lines = block.split(/\r?\n/);
  const proposal = {
    id: lines[0]?.match(/proposal_id:\s*(.+)$/)?.[1]?.trim(),
    hard_no_auto_apply: false,
    scores: {},
    evidence: [],
    scores_incomplete: false,
  };

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '  distribution:') {
      proposal.scores.distribution = parseScore(lines, index);
      continue;
    }
    if (line === '  engagement_quality:') {
      proposal.scores.engagement_quality = parseScore(lines, index);
      continue;
    }
    if (line === '  conversion_proxy:') {
      proposal.scores.conversion_proxy = parseScore(lines, index);
      continue;
    }
    const simple = line.match(/^  ([a-z_]+):\s*(.*)$/);
    if (simple) {
      const [, key, value] = simple;
      if (key === 'platform' || key === 'kind' || key === 'ts' || key === 'voice_version') proposal[key] = value;
      if (key === 'reason' && proposal.hard_no_auto_apply) proposal.hard_no_auto_apply_reason = value;
      if (key === 'matched_span') proposal.matched_span = value === 'none' ? null : value;
      if (key === 'originality_score') proposal.originality_score = scoreValue(value);
      continue;
    }
    if (line.trim() === 'HARD no-auto-apply') proposal.hard_no_auto_apply = true;
    const evidence = line.match(/^    -\s+(.+)$/);
    if (evidence) proposal.evidence.push(evidence[1]);
  }

  for (const dim of TRUST_DIMS) {
    if (!proposal.scores[dim]) {
      proposal.scores[dim] = Object.freeze({ value: null, n: 0, effect_size: 0, source_metric: 'absent', status: 'absent' });
      proposal.scores_incomplete = true;
    }
  }
  return Object.freeze({
    ...proposal,
    category: `social-${proposal.kind ?? 'formula'}-${proposal.platform ?? 'unknown'}`,
    scores: Object.freeze({ ...proposal.scores }),
    evidence: Object.freeze([...proposal.evidence]),
  });
}

async function loadProposals(platform, options) {
  const root = resolve('state_root', platform, options.env, options.configPath).path;
  const inbox = path.join(root, platform, 'inbox');
  let files = [];
  try {
    files = await readdir(inbox);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const proposals = [];
  for (const file of files.filter((entry) => entry.endsWith('.md')).sort()) {
    const content = await readFile(path.join(inbox, file), 'utf8');
    const blocks = content.split(/\n(?=- \[ \] proposal_id:)/).filter((block) => block.startsWith('- [ ] proposal_id:'));
    proposals.push(...blocks.map(parseProposalBlock));
  }
  return proposals;
}

async function loadInspiration(platform, options) {
  const dir = resolve('inspiration', platform, options.env, options.configPath).path;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const items = [];
  for (const entry of entries.filter((item) => item.isFile() && /\.ya?ml$/.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const parsed = parseYaml(await readFile(path.join(dir, entry.name), 'utf8'));
    for (const item of parsed.entries ?? []) {
      items.push(Object.freeze({
        id: item.id,
        platform: item.platform ?? platform,
        abstracted_template: item.abstracted_template,
        originality_score: scoreValue(item.originality_score),
        matched_span: item.matched_span ?? null,
        entity_free: item.entity_free !== false,
      }));
    }
  }
  return items;
}

function binFor(value) {
  const lower = Math.max(0, Math.min(0.8, Math.floor(value * 5) / 5));
  return `${lower.toFixed(1)}-${(lower + 0.2).toFixed(1)}`;
}

async function calibrationFor(platform, options) {
  const rows = await predictionAdapter.readLane(`social-${platform}`, { env: options.env });
  const pairs = new Map();
  for (const row of rows) {
    if (row.type === 'social-prediction') pairs.set(row.post_id, { predicted: row.p_convert });
    if (row.type === 'social-prediction-outcome' && row.trust_eligible !== false && row.cold_start !== true) {
      const current = pairs.get(row.post_id) ?? {};
      pairs.set(row.post_id, {
        ...current,
        predicted: typeof row.p_convert === 'number' ? row.p_convert : current.predicted,
        outcome: row.realized_convert === true ? 1 : 0,
      });
    }
  }
  const groups = new Map();
  for (const item of pairs.values()) {
    if (typeof item.predicted !== 'number' || typeof item.outcome !== 'number') continue;
    const bin = binFor(item.predicted);
    const current = groups.get(bin) ?? { predicted: 0, observed: 0, n: 0 };
    groups.set(bin, {
      predicted: current.predicted + item.predicted,
      observed: current.observed + item.outcome,
      n: current.n + 1,
    });
  }
  return [...groups.entries()]
    .map(([bin, value]) => Object.freeze({
      platform,
      bin,
      predicted: value.predicted / value.n,
      observed: value.observed / value.n,
      n: value.n,
    }))
    .sort((a, b) => a.bin.localeCompare(b.bin));
}

async function evolutionLog(options) {
  const file = decisionsFile(options.env, options.configPath);
  const decisions = await readJson(file, { _meta: {} });
  return Object.entries(decisions)
    .filter(([category]) => category !== '_meta')
    .map(([category, value]) => Object.freeze({
      category,
      total_proposed: value.total_proposed ?? 0,
      accepted: value.accepted ?? 0,
      rejected: value.rejected ?? 0,
      snoozed: value.snoozed ?? 0,
      last_decision: value.last_decision ?? null,
    }))
    .sort((a, b) => String(b.last_decision?.ts ?? '').localeCompare(String(a.last_decision?.ts ?? '')));
}

export async function buildViewModel(options = {}) {
  const opts = { env: process.env, ...options };
  const platforms = [];
  const trust = [];
  const proposals = [];
  const inspiration = [];
  const calibration = [];
  const formulaLeaderboard = [];

  for (const platform of PLATFORMS) {
    const rows = await loadMetrics(platform, opts);
    const trend = rows.map(toTrendPoint).sort((a, b) => a.posted_at.localeCompare(b.posted_at));
    platforms.push(Object.freeze({ platform, trend: Object.freeze(trend) }));
    formulaLeaderboard.push(...leaderboardFor(platform, rows));
    trust.push(...await trustFor(platform, opts));
    proposals.push(...await loadProposals(platform, opts));
    inspiration.push(...await loadInspiration(platform, opts));
    calibration.push(...await calibrationFor(platform, opts));
  }

  return Object.freeze({
    generated_at: null,
    propose_only: true,
    platforms: Object.freeze(platforms),
    formulaLeaderboard: Object.freeze(formulaLeaderboard),
    trust: Object.freeze(trust),
    proposals: Object.freeze(proposals),
    calibration: Object.freeze(calibration),
    inspiration: Object.freeze(inspiration),
    evolutionLog: Object.freeze(await evolutionLog(opts)),
    warnings: Object.freeze([]),
  });
}

function addWeekly(acc, point) {
  return {
    reach: acc.reach + point.reach,
    engagement: acc.engagement + point.engagement,
    conversion_proxy: acc.conversion_proxy + point.conversion_proxy,
    per_view_total: acc.per_view_total + point.per_view,
    n: acc.n + 1,
  };
}

function finishWeekly(acc) {
  return Object.freeze({
    reach: acc.reach,
    engagement: acc.engagement,
    conversion_proxy: acc.conversion_proxy,
    per_view: acc.n ? acc.per_view_total / acc.n : 0,
  });
}

export function buildShareCards(vm) {
  const perPlatform = vm.platforms.map((platform) => {
    const weekly = platform.trend.reduce(addWeekly, { reach: 0, engagement: 0, conversion_proxy: 0, per_view_total: 0, n: 0 });
    return Object.freeze({ platform: platform.platform, weekly: finishWeekly(weekly) });
  });
  const overall = perPlatform.reduce((acc, card) => ({
    reach: acc.reach + card.weekly.reach,
    engagement: acc.engagement + card.weekly.engagement,
    conversion_proxy: acc.conversion_proxy + card.weekly.conversion_proxy,
    per_view_total: acc.per_view_total + card.weekly.per_view,
    n: acc.n + (card.weekly.reach || card.weekly.engagement || card.weekly.conversion_proxy ? 1 : 0),
  }), { reach: 0, engagement: 0, conversion_proxy: 0, per_view_total: 0, n: 0 });
  return Object.freeze({
    perPlatform: Object.freeze(perPlatform),
    overall: Object.freeze({ weekly: finishWeekly(overall) }),
  });
}

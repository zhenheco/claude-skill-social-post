import * as predictionAdapter from './adapters/prediction-adapter.mjs';
import { PLATFORMS } from './metrics-schema.mjs';
import { readRows } from './metrics-store.mjs';
import { loadConfig, resolve } from './paths.mjs';
import { maturity } from './maturity.mjs';
import {
  TIER_KEYS,
  brierConvert,
  brierTier,
  normalizeDist,
  realizedTier,
  sumsToOne,
} from './prediction-util.mjs';

function sameTierKeys(dist) {
  const keys = Object.keys(dist ?? {}).sort();
  return keys.length === TIER_KEYS.length && keys.every((key, index) => key === [...TIER_KEYS].sort()[index]);
}

function validateInput(input) {
  if (!sameTierKeys(input.tier_dist)) return 'tier_dist keys must equal flop,pass,good,viral,mega';
  if (TIER_KEYS.some((key) => input.tier_dist[key] < 0 || input.tier_dist[key] > 1)) {
    return 'tier_dist values must be in range 0..1';
  }
  if (!sumsToOne(input.tier_dist)) return 'tier_dist sum must be ~1';
  if (input.p_convert < 0 || input.p_convert > 1) return 'p_convert must be in range 0..1';
  return null;
}

function coldStartPosts(options) {
  const configPath = options.configPath ?? options.env?.SOCIAL_POST_CONFIG_PATH;
  return loadConfig(configPath).prediction?.cold_start_posts ?? 20;
}

async function coldStart(input, options) {
  const priorMatured = options.priorMaturedCount ?? await countPriorMatured(input.platform, input.post_id, options);
  return priorMatured < coldStartPosts(options);
}

async function countPriorMatured(platform, postId, options) {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? env.SOCIAL_POST_CONFIG_PATH;
  const file = resolve('metrics', platform, env, configPath).path;
  const rows = await readRows(file, { maturity: 'matured' });
  return rows.filter((row) => row.platform === platform && row.post_id !== postId && row.kind !== 'no-data').length;
}

async function predictionFor(postId, platform, env) {
  const platforms = platform ? [platform] : PLATFORMS;
  for (const candidate of platforms) {
    const rows = await predictionAdapter.readLane(`social-${candidate}`, { env });
    const prediction = rows.find((row) => row.type === 'social-prediction' && row.post_id === postId);
    if (prediction) return { prediction, platform: candidate };
  }
  return {};
}

async function metricsFor(postId, platform, options) {
  if (options.metricsRow) return options.metricsRow;
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? env.SOCIAL_POST_CONFIG_PATH;
  const file = resolve('metrics', platform, env, configPath).path;
  const rows = await readRows(file);
  return rows.find((row) => row.post_id === postId);
}

function realizedConvert(row) {
  if (typeof row.realized_convert === 'boolean') return row.realized_convert;
  const metric = row.metrics?.downstream_converts;
  return Number(metric?.value ?? 0) > 0;
}

export async function log(input, options = {}) {
  const error = validateInput(input);
  if (error) return { ok: false, error };
  const isColdStart = await coldStart(input, options);
  return {
    ok: true,
    record: await predictionAdapter.append({
      platform: input.platform,
      type: 'social-prediction',
      post_id: input.post_id,
      tier_dist: normalizeDist(input.tier_dist),
      p_convert: input.p_convert,
      primary_metric: input.primary_metric,
      plateau_window: input.plateau_window,
      voice_version: input.voice_version,
      language: input.language,
      task_id: input.task_id,
      session_id: input.session_id,
      cold_start: isColdStart,
      trust_eligible: !isColdStart,
    }, { env: options.env ?? process.env }),
  };
}

export async function score(postId, options = {}) {
  const env = options.env ?? process.env;
  const found = await predictionFor(postId, options.platform ?? options.metricsRow?.platform, env);
  const { prediction, platform } = found;
  if (!prediction) return { resolved: false, reason: 'unknown-post' };

  const row = await metricsFor(postId, platform, options);
  if (!row) return { resolved: false, reason: 'unknown-metrics' };
  if (row.kind === 'no-data' || row.counts_as_prediction_miss === false) {
    return { resolved: false, reason: 'no-data' };
  }

  if (maturity(row).verdict !== 'matured') return { resolved: false, reason: 'not-matured' };

  const outcome = await predictionAdapter.append({
    platform,
    type: 'social-prediction-outcome',
    post_id: postId,
    task_id: prediction.task_id,
    session_id: prediction.session_id,
    realized_tier: realizedTier(row),
    realized_convert: realizedConvert(row),
    brier_tier: brierTier(prediction.tier_dist, realizedTier(row)),
    brier_convert: brierConvert(prediction.p_convert, realizedConvert(row)),
    cold_start: prediction.cold_start,
    trust_eligible: prediction.trust_eligible,
  }, { env });

  return { resolved: true, outcome };
}

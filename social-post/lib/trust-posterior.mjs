import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertNoTrustFile, stateRootInit } from './paths.mjs';
import { clampDelta, decayTowardPrior, ewma, wilsonLowerBound } from './stats-beta.mjs';

const DEFAULT_PRIOR = Object.freeze({ prior_alpha: 1, prior_beta: 1 });
const DEFAULT_OPTIONS = Object.freeze({
  alpha: 0.3,
  cap: 0.05,
  cooldown_days: 14,
  min_matured_windows: 2,
});
const DEFAULT_DIMS = Object.freeze([
  'distribution',
  'engagement-quality',
  'conversion-proxy',
  'voice_trust',
  'formula_trust',
  'publish_trust',
  'reply_trust',
]);

function nowIso(options) {
  return new Date(options.now ?? Date.now()).toISOString();
}

function freezePosterior(post) {
  return Object.freeze({
    successes: post.successes,
    failures: post.failures,
    prior_alpha: post.prior_alpha,
    prior_beta: post.prior_beta,
    lower_bound: post.lower_bound,
    decay_ts: post.decay_ts,
    last_step_ts: post.last_step_ts ?? null,
    evidence_ids: Object.freeze([...(post.evidence_ids ?? [])]),
  });
}

function lowerBound(post) {
  return wilsonLowerBound(post.successes + post.prior_alpha, post.failures + post.prior_beta);
}

function seeded(ts = null) {
  const post = {
    successes: 0,
    failures: 0,
    prior_alpha: DEFAULT_PRIOR.prior_alpha,
    prior_beta: DEFAULT_PRIOR.prior_beta,
    lower_bound: 0,
    decay_ts: ts,
    last_step_ts: null,
    evidence_ids: [],
  };
  post.lower_bound = lowerBound(post);
  return post;
}

async function trustPath(platform, options = {}) {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? env.SOCIAL_POST_CONFIG_PATH;
  const root = await stateRootInit(platform, env, configPath);
  const platformRoot = path.join(root, platform);
  await mkdir(platformRoot, { recursive: true });
  assertNoTrustFile(platformRoot);
  return path.join(platformRoot, 'trust-posterior.json');
}

function seedStore(store = {}, ts = null) {
  const dimensions = { ...(store.dimensions ?? {}) };
  for (const dim of DEFAULT_DIMS) {
    dimensions[dim] = { ...seeded(ts), ...(dimensions[dim] ?? {}) };
  }
  return { version: 1, dimensions };
}

async function readStore(platform, options = {}) {
  const file = await trustPath(platform, options);
  try {
    return { file, store: seedStore(JSON.parse(await readFile(file, 'utf8')), nowIso(options)) };
  } catch (error) {
    if (error.code === 'ENOENT') return { file, store: seedStore({}, nowIso(options)) };
    throw error;
  }
}

async function writeStore(file, store) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

function cloneStore(store) {
  return structuredClone(store);
}

function bumpFromOutcome(dim, outcome) {
  if (dim === 'publish_trust') {
    if (outcome?.source !== 'proper_scoring_rule') return null;
    const score = outcome.brier_score ?? outcome.brier_convert ?? outcome.brier_tier ?? outcome.log_loss;
    const baseline = outcome.baseline_brier_score ?? outcome.baseline_brier_convert ?? outcome.baseline_brier_tier ?? outcome.baseline_log_loss;
    if (typeof score !== 'number' || typeof baseline !== 'number') return null;
    return score < baseline ? 'success' : 'failure';
  }
  if (dim === 'reply_trust') {
    if (outcome?.draft_quality === 'pass' || outcome?.draft_quality === 'good' || outcome?.draft_quality === 'win') return 'success';
    if (outcome?.draft_quality === 'fail' || outcome?.draft_quality === 'loss') return 'failure';
    return null;
  }
  if (outcome?.verdict === 'win') return 'success';
  if (outcome?.verdict === 'loss') return 'failure';
  return null;
}

function daysBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / (24 * 60 * 60 * 1000);
}

export async function loadPosterior(platform, dim, options = {}) {
  const { store } = await readStore(platform, options);
  return freezePosterior(store.dimensions[dim] ?? seeded(nowIso(options)));
}

export async function update(platform, dim, maturedOutcome, evidenceId, options = {}) {
  const { file, store } = await readStore(platform, options);
  const next = cloneStore(store);
  next.dimensions[dim] = { ...seeded(nowIso(options)), ...(next.dimensions[dim] ?? {}) };
  const post = next.dimensions[dim];
  const bump = bumpFromOutcome(dim, maturedOutcome);
  if (bump === 'success') post.successes += 1;
  if (bump === 'failure') post.failures += 1;
  if (bump) {
    post.evidence_ids = [...(post.evidence_ids ?? []), evidenceId];
    post.decay_ts = nowIso(options);
    post.last_step_ts = nowIso(options);
    post.lower_bound = lowerBound(post);
  }
  await writeStore(file, next);
  assertNoTrustFile(path.dirname(file));
  return freezePosterior(post);
}

export async function preview_delta(platform, dim, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if ((opts.maturedWindows ?? 0) < opts.min_matured_windows) {
    return Object.freeze({ eligible: false, reason: 'needs 2 consecutive matured windows' });
  }

  const post = await loadPosterior(platform, dim, options);
  const currentTs = nowIso(options);
  if (post.last_step_ts && daysBetween(post.last_step_ts, currentTs) < opts.cooldown_days) {
    return Object.freeze({ eligible: false, reason: 'rate-limited <2wk + cooldown' });
  }

  const elapsedWeeks = post.decay_ts ? Math.floor(daysBetween(post.decay_ts, currentTs) / 7) : 0;
  const decayed = decayTowardPrior(post, post, elapsedWeeks);
  const target = wilsonLowerBound(decayed.successes + post.prior_alpha, decayed.failures + post.prior_beta);
  const smoothed = ewma(post.lower_bound, target, opts.alpha);
  const wouldBe = clampDelta(post.lower_bound, smoothed, opts.cap);
  const delta = Math.round((wouldBe - post.lower_bound) * 1000000) / 1000000;

  return Object.freeze({
    eligible: true,
    current_lb: post.lower_bound,
    would_be_lb: wouldBe,
    delta,
    ewma_applied: true,
  });
}

export function wouldGraduate(_posterior, options = {}) {
  return options.enable_future_trust_graduation === true ? false : false;
}

export function graduate() {
  throw new Error('propose-only subset');
}

export function apply() {
  throw new Error('propose-only subset');
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as digestAdapter from './adapters/digest-adapter.mjs';
import { today } from './adapters/adapter-iface.mjs';
import { diversityFloor } from './gates/diversity.mjs';
import { originalityGate } from './gates/originality.mjs';
import { stateRootInit } from './paths.mjs';
import { renderProposal } from './propose-render.mjs';
import { preview_delta } from './trust-posterior.mjs';

const KIND_TO_CATEGORY = Object.freeze({
  voice: 'voice',
  voice_tweak: 'voice',
  formula: 'formula',
  formula_reweight: 'formula',
  publish: 'publish',
  publish_autonomy: 'publish',
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isoNow(now) {
  return new Date(now ?? Date.now()).toISOString();
}

function addDaysIso(ts, days) {
  const date = new Date(ts);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function shortHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 10);
}

function normalizeKind(kind) {
  const normalized = KIND_TO_CATEGORY[kind];
  if (!normalized) throw new Error(`unknown proposal kind: ${kind}`);
  return normalized;
}

function scoreRecord(score = {}) {
  return Object.freeze({
    value: score.value ?? null,
    n: score.n ?? 0,
    effect_size: score.effect_size ?? 0,
    source_metric: score.source_metric ?? null,
    status: score.status ?? 'absent',
  });
}

function scoreSet(scores = {}) {
  return Object.freeze({
    distribution: scoreRecord(scores.distribution),
    engagement_quality: scoreRecord(scores.engagement_quality),
    conversion_proxy: scoreRecord(scores.conversion_proxy),
  });
}

function proposalId(candidate, ts) {
  const date = today(new Date(ts));
  const hash = shortHash({
    platform: candidate.platform,
    candidate_id: candidate.candidate_id ?? null,
    source_candidate_ids: candidate.source_candidate_ids ?? [],
    date,
  });
  return `social-evolve-${candidate.platform}-${date}-${hash}`;
}

function shouldExpire(candidate, kind) {
  return kind === 'publish' || candidate.proposal_type === 'new-rule' || candidate.type === 'new_rule';
}

export function detectApex(scores = {}) {
  const conversion = scores.conversion_proxy;
  if (!conversion || conversion.status === 'absent' || conversion.n === 0) {
    return Object.freeze({
      hard_no_auto_apply: true,
      reason: 'no-measurable-conversion-apex',
    });
  }
  return Object.freeze({ hard_no_auto_apply: false, reason: null });
}

export function routeCategory(kind, platform) {
  return `social-${normalizeKind(kind)}-${platform}`;
}

export async function toProposal(candidate, gateResults, trustPreview, options = {}) {
  const ts = isoNow(options.now);
  const kind = normalizeKind(candidate.kind ?? candidate.type);
  const scores = scoreSet(candidate.scores);
  const apex = detectApex(scores);
  const expires = shouldExpire(candidate, kind);
  const proposal = {
    proposal_id: proposalId(candidate, ts),
    ts,
    platform: candidate.platform,
    kind,
    text: candidate.text ?? '',
    formula_id: candidate.formula_id ?? candidate.target ?? null,
    voice_version: candidate.voice_version ?? null,
    source_candidate_ids: [...(candidate.source_candidate_ids ?? (candidate.candidate_id ? [candidate.candidate_id] : []))],
    evidence_ids: [...(candidate.evidence_ids ?? [])],
    evidence: [...(candidate.evidence ?? [])],
    scores,
    trust_preview: { ...(trustPreview ?? {}) },
    originality: {
      blocked: gateResults.originality.blocked,
      matched_span: gateResults.originality.matched_span,
      score: gateResults.originality.score,
      reasons: [...(gateResults.originality.reasons ?? [])],
    },
    diversity: {
      blocked: gateResults.diversity.blocked,
      matched_span: gateResults.diversity.matched_span,
      score: gateResults.diversity.score,
      reasons: [...(gateResults.diversity.reasons ?? [])],
    },
    hard_no_auto_apply: apex.hard_no_auto_apply,
    hard_no_auto_apply_reason: apex.reason,
    expiry_policy: expires ? 'expires-if-unreviewed' : null,
    expires_at: expires ? addDaysIso(ts, candidate.expiry_days ?? 14) : null,
  };
  return deepFreeze(proposal);
}

async function inboxPath(proposal, options = {}) {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? env.SOCIAL_POST_CONFIG_PATH;
  const root = await stateRootInit(proposal.platform, env, configPath);
  const dir = path.join(root, proposal.platform, 'inbox');
  await mkdir(dir, { recursive: true });
  return path.join(dir, `social-evolve-${proposal.platform}-${today(new Date(proposal.ts))}.md`);
}

export async function writeProposal(proposal, options = {}) {
  const file = await inboxPath(proposal, options);
  let current = '';
  try {
    current = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current.includes(`proposal_id: ${proposal.proposal_id}`)) return Object.freeze({ path: file, appended: false });
  const next = `${current}${current && !current.endsWith('\n') ? '\n' : ''}${renderProposal(proposal)}`;
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(tmp, next, 'utf8');
  await rename(tmp, file);
  return Object.freeze({ path: file, appended: true });
}

function defaultDeps() {
  return Object.freeze({
    originalityGate,
    diversityFloor,
    previewDelta: preview_delta,
    digest: digestAdapter,
  });
}

export async function propose(candidate, deps = {}, options = {}) {
  const wired = { ...defaultDeps(), ...deps };
  const originality = wired.originalityGate(candidate, candidate.corpus_90d ?? [], candidate.sources ?? []);
  if (originality.blocked) {
    return Object.freeze({
      written: false,
      blocked: 'originality',
      matched_span: originality.matched_span,
      score: originality.score,
    });
  }

  const diversity = wired.diversityFloor(candidate, candidate.last_10_posts ?? []);
  if (diversity.blocked) {
    return Object.freeze({
      written: false,
      blocked: 'diversity',
      reasons: diversity.reasons,
    });
  }

  const trustPreview = await wired.previewDelta(
    candidate.platform,
    candidate.trust_dimension ?? candidate.score_dimension ?? 'formula_trust',
    options.trustOptions ?? {},
  );
  const proposal = await toProposal(candidate, { originality, diversity }, trustPreview, options);
  const written = await writeProposal(proposal, options);
  const category = routeCategory(candidate.kind ?? candidate.type, candidate.platform);
  const digest = await wired.digest.record(category, 'propose', { source_proposal_id: proposal.proposal_id });

  return Object.freeze({
    written: true,
    path: written.path,
    proposal_id: proposal.proposal_id,
    proposal,
    digest,
    applied: digest.applied === true,
  });
}

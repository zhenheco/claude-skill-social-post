import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as proposer from '../lib/propose.mjs';
import { renderProposal } from '../lib/propose-render.mjs';

async function withSandbox(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'social-propose-'));
  const configPath = path.join(root, 'config.yaml');
  const config = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/decisions-store.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
`;
  const previousHome = process.env.HOME;
  const previousSkillDir = process.env.SKILL_DIR;
  const previousConfig = process.env.SOCIAL_POST_CONFIG_PATH;
  process.env.HOME = root;
  process.env.SKILL_DIR = '.claude';
  process.env.SOCIAL_POST_CONFIG_PATH = configPath;
  await writeFile(configPath, config, 'utf8');
  try {
    return await fn(root);
  } finally {
    if (previousHome == null) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousSkillDir == null) delete process.env.SKILL_DIR;
    else process.env.SKILL_DIR = previousSkillDir;
    if (previousConfig == null) delete process.env.SOCIAL_POST_CONFIG_PATH;
    else process.env.SOCIAL_POST_CONFIG_PATH = previousConfig;
    await rm(root, { recursive: true, force: true });
  }
}

function candidate(overrides = {}) {
  return {
    candidate_id: 'cand-1',
    platform: 'facebook',
    kind: 'formula',
    text: 'fresh candidate',
    formula_id: 'F33',
    voice_version: 'facebook@1.0.0',
    source_candidate_ids: ['analyze-cand-1'],
    evidence_ids: ['post-1', 'post-2'],
    evidence: ['median beat baseline by 1.2 MAD'],
    sources: [
      { source_id: 'src-a', domain: 'a.example', text: 'different abstracted source' },
      { source_id: 'src-b', domain: 'b.example', text: 'another abstracted source' },
    ],
    corpus_90d: ['owner archive'],
    last_10_posts: [],
    scores: {
      distribution: { value: 0.61, n: 7, effect_size: 1.2, source_metric: 'reach_per_view', status: 'captured' },
      engagement_quality: { value: 0.42, n: 6, effect_size: 0.8, source_metric: 'saves_per_view', status: 'captured' },
      conversion_proxy: { value: 0.18, n: 3, effect_size: 0.4, source_metric: 'line_join_utm', status: 'captured' },
    },
    ...overrides,
  };
}

function passGate(extra = {}) {
  return { blocked: false, matched_span: null, score: null, reasons: [], ...extra };
}

function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    originalityGate: () => passGate({ matched_span: 'abstract match', score: 0.07 }),
    diversityFloor: () => passGate(),
    previewDelta: async () => ({ eligible: true, dimension: 'formula_trust', current_lb: 0.52, would_be_lb: 0.57, delta: 0.05 }),
    digest: {
      record: async (category, action, meta) => {
        calls.push({ category, action, meta });
        return { applied: false, reason: 'propose-only-M1a' };
      },
    },
    ...overrides,
  };
}

async function inboxFile(root, platform = 'facebook', date = '2026-06-03') {
  return path.join(root, '.claude/state/social-evolve', platform, 'inbox', `social-evolve-${platform}-${date}.md`);
}

test('T1 propose writes inbox markdown with three separate score records and no collapsed score', async () => {
  await withSandbox(async (root) => {
    const result = await proposer.propose(candidate(), deps(), { now: '2026-06-03T00:00:00.000Z' });
    const content = await readFile(await inboxFile(root), 'utf8');
    assert.equal(result.written, true);
    for (const name of ['distribution', 'engagement_quality', 'conversion_proxy']) {
      assert.match(content, new RegExp(`${name}:`));
      assert.match(content, /value:/);
      assert.match(content, /n:/);
      assert.match(content, /effect_size:/);
      assert.match(content, /source_metric:/);
      assert.match(content, /status:/);
    }
    assert.doesNotMatch(content, /combined_score|bernoulli|overall_score/);
  });
});

test('T2 originality blocks short-circuit before inbox write', async () => {
  await withSandbox(async (root) => {
    const blockedDeps = deps({
      originalityGate: () => ({ blocked: true, matched_span: 'copy span', score: 9, reasons: [{ kind: 'lcs' }] }),
    });
    const result = await proposer.propose(candidate(), blockedDeps, { now: '2026-06-03T00:00:00.000Z' });
    assert.deepEqual(result, { written: false, blocked: 'originality', matched_span: 'copy span', score: 9 });
    assert.equal(existsSync(path.dirname(await inboxFile(root))), false);
    assert.equal(blockedDeps.calls.length, 0);
  });
});

test('T3 diversity blocks short-circuit before inbox write', async () => {
  await withSandbox(async (root) => {
    const blockedDeps = deps({
      diversityFloor: () => ({ blocked: true, matched_span: null, score: null, reasons: [{ kind: 'formula_overuse' }] }),
    });
    const result = await proposer.propose(candidate(), blockedDeps, { now: '2026-06-03T00:00:00.000Z' });
    assert.equal(result.written, false);
    assert.equal(result.blocked, 'diversity');
    assert.equal(existsSync(path.dirname(await inboxFile(root))), false);
    assert.equal(blockedDeps.calls.length, 0);
  });
});

test('T4 passing candidates render originality and diversity gate evidence', async () => {
  await withSandbox(async (root) => {
    await proposer.propose(candidate(), deps(), { now: '2026-06-03T00:00:00.000Z' });
    const content = await readFile(await inboxFile(root), 'utf8');
    assert.match(content, /matched_span: abstract match/);
    assert.match(content, /originality_score: 0.07/);
    assert.match(content, /diversity: pass/);
  });
});

test('T5 trust delta is preview-only and proposer exports no apply or graduate path', async () => {
  await withSandbox(async (root) => {
    await proposer.propose(candidate(), deps(), { now: '2026-06-03T00:00:00.000Z' });
    const content = await readFile(await inboxFile(root), 'utf8');
    assert.match(content, /trust-delta PREVIEW \(display only\)/);
    assert.match(content, /delta: 0.05/);
    assert.equal(typeof proposer.apply, 'undefined');
    assert.equal(typeof proposer.graduate, 'undefined');
    assert.equal(typeof proposer.autoApply, 'undefined');
  });
});

test('T6 digest route receives category and propose-only result is surfaced', async () => {
  await withSandbox(async () => {
    const injected = deps();
    const result = await proposer.propose(candidate(), injected, { now: '2026-06-03T00:00:00.000Z' });
    assert.equal(injected.calls.length, 1);
    assert.equal(injected.calls[0].category, 'social-formula-facebook');
    assert.equal(injected.calls[0].action, 'propose');
    assert.deepEqual(result.digest, { applied: false, reason: 'propose-only-M1a' });
    assert.equal(result.applied, false);
  });
});

test('T7 absent conversion evidence stamps hard no-auto-apply with reason', async () => {
  await withSandbox(async (root) => {
    const result = await proposer.propose(candidate({
      scores: {
        ...candidate().scores,
        conversion_proxy: { value: null, n: 0, effect_size: 0, source_metric: 'line_join_utm', status: 'absent' },
      },
    }), deps(), { now: '2026-06-03T00:00:00.000Z' });
    const content = await readFile(await inboxFile(root), 'utf8');
    assert.equal(result.proposal.hard_no_auto_apply, true);
    assert.match(content, /HARD no-auto-apply/);
    assert.match(content, /reason: no-measurable-conversion-apex/);
    assert.equal(result.applied, false);
  });
});

test('T8 present conversion evidence does not stamp hard no-auto-apply', async () => {
  const proposal = await proposer.toProposal(
    candidate(),
    { originality: passGate(), diversity: passGate() },
    { eligible: true, delta: 0.01 },
    { now: '2026-06-03T00:00:00.000Z' },
  );
  const content = renderProposal(proposal);
  assert.equal(proposal.hard_no_auto_apply, false);
  assert.doesNotMatch(content, /HARD no-auto-apply/);
});

test('T9 routeCategory maps known kinds and rejects unknown kinds', () => {
  assert.equal(proposer.routeCategory('voice', 'facebook'), 'social-voice-facebook');
  assert.equal(proposer.routeCategory('formula', 'facebook'), 'social-formula-facebook');
  assert.equal(proposer.routeCategory('publish', 'facebook'), 'social-publish-facebook');
  assert.equal(proposer.routeCategory('voice_tweak', 'threads'), 'social-voice-threads');
  assert.equal(proposer.routeCategory('formula_reweight', 'x'), 'social-formula-x');
  assert.throws(() => proposer.routeCategory('other', 'facebook'), /unknown proposal kind/);
});

test('T10 renderProposal is pure and toProposal is immutable', async () => {
  const input = candidate();
  const before = structuredClone(input);
  const proposal = await proposer.toProposal(
    input,
    { originality: passGate(), diversity: passGate() },
    { eligible: true, delta: 0.02 },
    { now: '2026-06-03T00:00:00.000Z' },
  );
  assert.deepEqual(input, before);
  assert.notEqual(proposal, input);
  assert.equal(typeof renderProposal(proposal), 'string');
  assert.equal(Object.isFrozen(proposal), true);
});

test('T11 proposer source keeps path, digest, secret, and posting boundaries', async () => {
  const libRoot = fileURLToPath(new URL('../lib/', import.meta.url));
  const proposeSource = await readFile(path.join(libRoot, 'propose.mjs'), 'utf8');
  const renderSource = await readFile(path.join(libRoot, 'propose-render.mjs'), 'utf8');
  for (const source of [proposeSource, renderSource]) {
    assert.doesNotMatch(source, /digest-decisions\.json/);
    assert.doesNotMatch(source, /\/Users\//);
    assert.doesNotMatch(source, /\/home\//);
    assert.doesNotMatch(source, /op:\/\//);
    assert.doesNotMatch(source, /Postiz|Chrome|browser|posting|auto-send/i);
  }
});

test('same-platform same-day proposals append to one inbox file', async () => {
  await withSandbox(async (root) => {
    await proposer.propose(candidate({ candidate_id: 'cand-1' }), deps(), { now: '2026-06-03T00:00:00.000Z' });
    await proposer.propose(candidate({ candidate_id: 'cand-2', source_candidate_ids: ['analyze-cand-2'] }), deps(), {
      now: '2026-06-03T12:00:00.000Z',
    });
    const dir = path.dirname(await inboxFile(root));
    assert.deepEqual(await readdir(dir), ['social-evolve-facebook-2026-06-03.md']);
    const content = await readFile(await inboxFile(root), 'utf8');
    assert.equal(content.match(/- \[ \] proposal_id:/g).length, 2);
  });
});

test('new-rule and publish proposals expire when unreviewed', async () => {
  const publishProposal = await proposer.toProposal(
    candidate({ kind: 'publish', candidate_id: 'publish-1' }),
    { originality: passGate(), diversity: passGate() },
    { eligible: true, delta: 0.01 },
    { now: '2026-06-03T00:00:00.000Z' },
  );
  const ruleProposal = await proposer.toProposal(
    candidate({ kind: 'formula', candidate_id: 'rule-1', proposal_type: 'new-rule' }),
    { originality: passGate(), diversity: passGate() },
    { eligible: true, delta: 0.01 },
    { now: '2026-06-03T00:00:00.000Z' },
  );
  assert.equal(publishProposal.expiry_policy, 'expires-if-unreviewed');
  assert.equal(ruleProposal.expiry_policy, 'expires-if-unreviewed');
  assert.match(renderProposal(publishProposal), /expires_at:/);
});

test('T12 real digest seam is opt-in', async (t) => {
  if (process.env.RUN_INTEGRATION !== '1') {
    t.skip('set RUN_INTEGRATION=1 to exercise the real adapter seam');
    return;
  }
  await withSandbox(async () => {
    const realDigest = await import('../lib/adapters/digest-adapter.mjs');
    const result = await proposer.propose(candidate(), deps({ digest: realDigest }), { now: '2026-06-03T00:00:00.000Z' });
    assert.equal(result.applied, false);
  });
});

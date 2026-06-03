import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const dashboardConfig = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  metrics: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/metrics.jsonl
  inspiration: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/inspiration
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
maturity_windows:
  facebook:
    min_age_hours: 72
    second_push_window_hours: [24, 48]
  instagram:
    min_age_hours: 72
    second_push_window_hours: [24, 48]
  threads:
    min_age_hours: 72
    second_push_window_hours: [24, 48]
  x:
    min_age_hours: 72
    second_push_window_hours: [24, 48]
  linkedin:
    min_age_hours: 72
    second_push_window_hours: [24, 48]
prediction:
  cold_start_posts: 0
`;

function metric(value) {
  return {
    value,
    state: 'captured',
    capture_method: 'manual',
    counts_toward_publish_trust: true,
    plateau_age: 72,
  };
}

function metricsRow(overrides = {}) {
  return {
    post_id: 'post-1',
    platform: 'facebook',
    language: 'zh-TW',
    voice_version: 'facebook@1.0.0',
    posted_at: '2026-05-25T00:00:00.000Z',
    primary_metric: 'reach_per_view',
    plateau_window: '72h',
    maturity: 'matured',
    formula_id: 'F6b',
    topic_intent: 'line-growth',
    metrics: {
      reach: metric(1200),
      engagement: metric(180),
      conversion_proxy: metric(12),
      views: metric(800),
      reach_per_view: metric(1.5),
    },
    ...overrides,
  };
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonl(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

async function writePlatformState(root) {
  const stateRoot = path.join(root, '.claude/state/social-evolve');
  const facebookRoot = path.join(stateRoot, 'facebook');
  await appendJsonl(path.join(facebookRoot, 'metrics.jsonl'), [
    metricsRow(),
    metricsRow({
      post_id: 'post-provisional',
      maturity: 'provisional',
      formula_id: 'F20',
      metrics: {
        reach: metric(9999),
        engagement: metric(999),
        conversion_proxy: metric(99),
        views: metric(900),
        reach_per_view: metric(11.1),
      },
    }),
  ]);
  await appendJsonl(path.join(stateRoot, 'linkedin/metrics.jsonl'), [
    metricsRow({
      post_id: 'linkedin-post-1',
      platform: 'linkedin',
      formula_id: 'L1',
      metrics: {
        reach: metric(600),
        engagement: metric(90),
        conversion_proxy: metric(3),
        views: metric(300),
        reach_per_view: metric(2),
      },
    }),
  ]);
  await writeJson(path.join(facebookRoot, 'trust-posterior.json'), {
    version: 1,
    dimensions: {
      distribution: { lower_bound: 0.62, successes: 7, failures: 2 },
      engagement_quality: { lower_bound: 0.51, successes: 5, failures: 3 },
      conversion_proxy: { lower_bound: 0.24, successes: 2, failures: 4 },
    },
  });
  await writeJson(path.join(stateRoot, 'linkedin/trust-posterior.json'), {
    version: 1,
    dimensions: {
      distribution: { lower_bound: 0.48, successes: 4, failures: 4 },
    },
  });
}

async function writeInbox(root) {
  const inbox = path.join(root, '.claude/state/social-evolve/facebook/inbox/social-evolve-facebook-2026-06-03.md');
  await mkdir(path.dirname(inbox), { recursive: true });
  await writeFile(inbox, `# Social evolve proposals

- [ ] proposal_id: prop-1
  platform: facebook
  kind: formula
  ts: 2026-06-03T00:00:00.000Z
  voice_version: facebook@1.0.0
  source_candidate_ids: cand-1
  evidence_ids: post-1
  HARD no-auto-apply
  reason: no-measurable-conversion-apex
  matched_span: abstract match
  originality_score: 0.07
  diversity: pass
  trust-delta PREVIEW (display only) | dimension: formula_trust | delta: 0.05
  evidence:
    - median beat baseline by 1.2 MAD
  distribution:
    value: 0.61
    n: 7
    effect_size: 1.2
    source_metric: reach_per_view
    status: captured
  engagement_quality:
    value: 0.42
    n: 6
    effect_size: 0.8
    source_metric: saves_per_view
    status: captured
  conversion_proxy:
    value: absent
    n: 0
    effect_size: 0
    source_metric: line_join_utm
    status: absent
`, 'utf8');
}

async function writeInspiration(root) {
  const dir = path.join(root, '.claude/state/social-evolve/facebook/inspiration');
  await mkdir(path.join(dir, '_raw'), { recursive: true });
  await writeFile(path.join(dir, 'facebook.yaml'), `entries:
  - id: insp-1
    platform: facebook
    abstracted_template: Outcome receipt with timed constraint and proof
    originality_score: 0.08
    matched_span: no entity span
    entity_free: true
`, 'utf8');
  await writeFile(path.join(dir, '_raw/leak.txt'), 'RAW_LEAK_TOKEN competitor handle @named-source', 'utf8');
}

async function writePredictions(root) {
  const dir = path.join(root, '.claude/state/predictions');
  await appendJsonl(path.join(dir, '2026-06-03.jsonl'), [
    {
      lane: 'social-facebook',
      type: 'social-prediction-outcome',
      post_id: 'post-1',
      p_convert: 0.72,
      realized_convert: true,
      trust_eligible: true,
      cold_start: false,
    },
    {
      lane: 'social-facebook',
      type: 'social-prediction-outcome',
      post_id: 'post-2',
      p_convert: 0.25,
      realized_convert: false,
      trust_eligible: true,
      cold_start: false,
    },
    {
      lane: 'social-facebook',
      type: 'social-prediction-outcome',
      post_id: 'post-cold',
      p_convert: 0.9,
      realized_convert: true,
      trust_eligible: false,
      cold_start: true,
    },
  ]);
}

async function writeDecisions(root) {
  await writeJson(path.join(root, '.claude/state/digest-decisions.json'), {
    _meta: { propose_only: true },
    'social-formula-facebook': {
      total_proposed: 2,
      accepted: 1,
      rejected: 1,
      snoozed: 0,
      last_decision: {
        ts: '2026-06-02T00:00:00.000Z',
        decision: 'accept',
        source_proposal_id: 'prop-old',
      },
    },
  });
}

export async function withDashboardSandbox(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'social-dashboard-'));
  const configPath = path.join(root, 'config.yaml');
  const env = {
    HOME: root,
    SKILL_DIR: '.claude',
    SOCIAL_POST_CONFIG_PATH: configPath,
  };
  await writeFile(configPath, dashboardConfig, 'utf8');
  await writePlatformState(root);
  await writeInbox(root);
  await writeInspiration(root);
  await writePredictions(root);
  await writeDecisions(root);
  try {
    return await fn({ root, env, configPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function readDecisionStore(root) {
  return JSON.parse(await readFile(path.join(root, '.claude/state/digest-decisions.json'), 'utf8'));
}

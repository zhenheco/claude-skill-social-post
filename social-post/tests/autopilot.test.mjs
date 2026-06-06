import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  briefMode,
  gatherMode,
  reportMode,
} from '../scripts/autopilot.mjs';
import { readRaw } from '../lib/voice-bootstrap/raw-store.mjs';
import { parse } from '../lib/yaml.mjs';

const configText = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  inspiration: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/inspiration
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/decisions-store.json
  voice_dir: \${HOME}/brands/personal/voice
secrets:
  firecrawl_api_key: op://Dev/FIRECRAWL_API/credential
autopost:
  base_url: TBD
  api_key: TBD
`;

const coreText = `name: Nelson Chou
niche: "企業 AI 導入"
values:
  - "實戰導向"
avoid_topics: []
voice_directive:
  sharpness: high
  demonstrate_expertise: true
  proof_over_claim: true
objective_hierarchy:
  - tier: apex
    metrics: [line_utm_joins]
automation_policy:
  mode: propose_only
  auto_send: false
`;

function voiceText({ fewShot = ['news_hottake'], version = '0.3.0', seeded = true } = {}) {
  return `version: ${version}
primary_language: zh-tw
format_default: short-thread
hook_style:
  allowed:
${fewShot.map((pattern) => `    - ${pattern}`).join('\n') || '    - news_hottake'}
style_fingerprint:
  sentence_length_bucket: medium
  avg_beats: 2
  emoji_density: 0
  link_rate: 0
  register_hint: personal
few_shot:${seeded ? `
${fewShot.map((pattern) => `  - pattern: ${pattern}
    skeleton: "{工具} 出了 {新功能}。{反直覺判斷}。"
    origin: benchmark_distilled
    source_ids: public-a`).join('\n')}` : ' []'}
voice_state:
  human_sample_count: 0
automation_policy:
  mode: propose_only
  auto_send: false
cadence_ceiling:
  posts_per_day: 1
forbidden_imports: []
cta_style:
  allowed: []
changelog: []
`;
}

async function withSandbox(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-autopilot-'));
  const configPath = path.join(home, 'config.yaml');
  const corePath = path.join(home, 'core.yaml');
  const env = {
    ...process.env,
    HOME: home,
    SKILL_DIR: '.claude',
    SOCIAL_POST_CONFIG_PATH: configPath,
    SOCIAL_POST_CORE_PATH: corePath,
  };
  await writeFile(configPath, configText, 'utf8');
  await writeFile(corePath, coreText, 'utf8');
  try {
    return await fn({ home, env, configPath, corePath });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function writeSources(home, platform, sources) {
  const dir = path.join(home, `.claude/state/social-evolve/${platform}/inspiration`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'sources.yaml'), `sources:
${sources.map((source) => `  - source_id: ${source.source_id}
    access_mode: ${source.access_mode}
    url: ${source.url ?? ''}
    trust: 0.7
    influence_cap: 0.2
    drift_flag: false`).join('\n')}
`, 'utf8');
}

async function writeVoice(home, platform, content = voiceText()) {
  const voiceDir = path.join(home, 'brands/personal/voice');
  await mkdir(voiceDir, { recursive: true });
  const file = path.join(voiceDir, `${platform}.yaml`);
  await writeFile(file, content, 'utf8');
  return file;
}

test('gather ingests scraped prose once when the same text appears twice', async () => {
  await withSandbox(async ({ home, env, configPath }) => {
    await writeSources(home, 'threads', [
      { source_id: 'public-a', access_mode: 'firecrawl_web', url: 'https://example.com/post' },
    ]);
    await writeVoice(home, 'threads');
    const logs = [];
    const deps = {
      scrapeWithFirecrawl: async (_url, options) => {
        assert.equal(options.waitFor, 4000);
        assert.equal(options.onlyMainContent, false);
        return [
          '# title',
          '[Read more](https://example.com)',
          '不是工具多就會贏，是你有沒有把流程變成每天都會穩定反覆發生的事。',
          '不是工具多就會贏，是你有沒有把流程變成每天都會穩定反覆發生的事。',
          'nav',
        ].join('\n');
      },
      seedVoice: async () => ({ seeded: false, proposal_result: { written: true } }),
      log: (line) => logs.push(line),
      now: '2026-06-06T00:00:00.000Z',
    };

    await gatherMode({ platforms: ['threads'], env, configPath }, deps);
    await gatherMode({ platforms: ['threads'], env, configPath }, deps);

    const rows = await readRaw('threads', 'public-a', { env, configPath });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, '不是工具多就會贏，是你有沒有把流程變成每天都會穩定反覆發生的事。');
    assert.match(logs.at(-1), /autopilot gather platform=threads scraped=1 new_raw=0 patterns=\d+ wrote=yes/);
  });
});

test('gather skips proposal write when distilled patterns would reduce current few-shot count', async () => {
  await withSandbox(async ({ home, env, configPath }) => {
    await writeSources(home, 'linkedin', [
      { source_id: 'public-a', access_mode: 'firecrawl_web', url: 'https://example.com/post' },
    ]);
    const voicePath = await writeVoice(home, 'linkedin', voiceText({ fewShot: ['news_hottake', 'principle_contrast'] }));
    const before = await readFile(voicePath, 'utf8');
    let seeded = false;
    const logs = [];

    await gatherMode({ platforms: ['linkedin'], env, configPath }, {
      scrapeWithFirecrawl: async () => '這只是一般描述，沒有可分類的鉤子，但仍然是一段完整的句子。',
      seedVoice: async () => {
        seeded = true;
      },
      log: (line) => logs.push(line),
      now: '2026-06-06T00:00:00.000Z',
    });

    assert.equal(seeded, false);
    assert.equal(await readFile(voicePath, 'utf8'), before);
    assert.match(logs.join('\n'), /wrote=skipped-regression/);
  });
});

test('gather logs a failed source and continues with a healthy platform', async () => {
  await withSandbox(async ({ home, env, configPath }) => {
    await writeSources(home, 'linkedin', [
      { source_id: 'linkedin-public', access_mode: 'firecrawl_web', url: 'https://example.com/linkedin' },
    ]);
    await writeSources(home, 'x', [
      { source_id: 'x-public', access_mode: 'firecrawl_web', url: 'https://example.com/x' },
    ]);
    await writeVoice(home, 'linkedin');
    await writeVoice(home, 'x');
    const logs = [];

    const result = await gatherMode({ platforms: ['linkedin', 'x'], env, configPath }, {
      scrapeWithFirecrawl: async (url) => {
        if (url.includes('linkedin')) throw new Error('firecrawl timeout');
        return '不是工具多就會贏，是你有沒有把流程變成每天都會穩定反覆發生的事。';
      },
      seedVoice: async () => ({ seeded: false, proposal_result: { written: true } }),
      log: (line) => logs.push(line),
      now: '2026-06-06T00:00:00.000Z',
    });

    const xRows = await readRaw('x', 'x-public', { env, configPath });
    assert.equal(xRows.length, 1);
    assert.match(logs.join('\n'), /autopilot gather platform=linkedin source=linkedin-public error=firecrawl timeout/);
    assert.match(logs.join('\n'), /autopilot gather platform=x scraped=1 new_raw=1 patterns=\d+ wrote=yes/);
    assert.deepEqual(result.map((row) => row.platform), ['linkedin', 'x']);
  });
});

test('gather logs all failed platform sources before surfacing all-platform failure', async () => {
  await withSandbox(async ({ home, env, configPath }) => {
    await writeSources(home, 'linkedin', [
      { source_id: 'linkedin-public', access_mode: 'firecrawl_web', url: 'https://example.com/linkedin' },
    ]);
    await writeSources(home, 'x', [
      { source_id: 'x-public', access_mode: 'firecrawl_web', url: 'https://example.com/x' },
    ]);
    await writeVoice(home, 'linkedin');
    await writeVoice(home, 'x');
    const logs = [];

    await assert.rejects(
      () => gatherMode({ platforms: ['linkedin', 'x'], env, configPath }, {
        scrapeWithFirecrawl: async () => {
          throw new Error('firecrawl unavailable');
        },
        seedVoice: async () => ({ seeded: false, proposal_result: { written: true } }),
        log: (line) => logs.push(line),
        now: '2026-06-06T00:00:00.000Z',
      }),
      /autopilot gather failed for all platforms/,
    );

    assert.match(logs.join('\n'), /autopilot gather platform=linkedin source=linkedin-public error=firecrawl unavailable/);
    assert.match(logs.join('\n'), /autopilot gather platform=x source=x-public error=firecrawl unavailable/);
  });
});

test('brief skips an unseeded platform and writes seeded briefs to autopilot inbox', async () => {
  await withSandbox(async ({ home, env, configPath, corePath }) => {
    await writeVoice(home, 'threads', voiceText({ seeded: true }));
    await writeVoice(home, 'facebook', voiceText({ seeded: false }));
    const logs = [];

    await briefMode({ platforms: ['threads', 'facebook'], date: '2026-06-06', env, configPath, corePath }, {
      log: (line) => logs.push(line),
    });

    const briefPath = path.join(home, '.claude/state/autopilot/briefs/2026-06-06/threads.md');
    assert.equal(existsSync(briefPath), true);
    assert.match(await readFile(briefPath, 'utf8'), /# Generation Brief: threads/);
    assert.equal(existsSync(path.join(path.dirname(briefPath), 'facebook.md')), false);
    assert.match(logs.join('\n'), /autopilot brief platform=facebook skipped=unseeded/);
  });
});

test('brief honors an explicit per-host autopilot root override', async () => {
  await withSandbox(async ({ home, env, configPath, corePath }) => {
    await writeVoice(home, 'threads', voiceText({ seeded: true }));
    const overrideRoot = path.join(home, 'runtime/social-post/autopilot');

    await briefMode({
      platforms: ['threads'],
      date: '2026-06-06',
      env: { ...env, SOCIAL_POST_AUTOPILOT_ROOT: overrideRoot },
      configPath,
      corePath,
    });

    assert.equal(existsSync(path.join(overrideRoot, 'briefs/2026-06-06/threads.md')), true);
  });
});

test('report writes platform rows with raw counts, voice metadata, draft presence, and blockers', async () => {
  await withSandbox(async ({ home, env, configPath }) => {
    await writeSources(home, 'threads', [
      { source_id: 'public-a', access_mode: 'firecrawl_web', url: 'https://example.com/post' },
    ]);
    await writeVoice(home, 'threads', voiceText({ fewShot: ['news_hottake'] }));
    await mkdir(path.join(home, '.claude/state/autopilot/briefs/2026-06-06'), { recursive: true });
    await mkdir(path.join(home, '.claude/state/autopilot/drafts/2026-06-06'), { recursive: true });
    await writeFile(path.join(home, '.claude/state/autopilot/briefs/2026-06-06/threads.md'), 'brief', 'utf8');
    await writeFile(path.join(home, '.claude/state/autopilot/drafts/2026-06-06/threads.txt'), 'draft', 'utf8');
    const logs = [];

    const result = await reportMode({ platforms: ['threads'], date: '2026-06-06', env, configPath }, {
      log: (line) => logs.push(line),
    });

    const content = await readFile(result.path, 'utf8');
    const parsedVoice = parse(await readFile(path.join(home, 'brands/personal/voice/threads.yaml'), 'utf8'));
    assert.equal(parsedVoice.version, '0.3.0');
    assert.match(content, /\| threads \| 0 \| 0\.3\.0 \| 1 \| yes \| yes \|/);
    assert.match(content, /autopost base_url\/api_key TBD/);
    assert.match(content, /FB-native gather remains human-needed/);
    assert.match(logs[0], new RegExp(`autopilot report -> ${result.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
});

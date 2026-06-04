import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ExcludedPlatformError, UnknownPlatformError } from '../lib/registry.mjs';
import { loadVoiceContext, pickArchetypes } from '../lib/generate/voice-context.mjs';

const config = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
`;

const core = `name: Nelson Chou
niche: "企業 AI 導入、內容系統、自動化工作流"
values:
  - "實戰導向"
  - "不 hype"
avoid_topics:
  - "政治"
  - "競品點名"
voice_directive:
  sharpness: high # stronger hooks
  demonstrate_expertise: true # concrete practice
  proof_over_claim: true # evidence first
  data_tunable: true # metrics can tune it
objective_hierarchy:
  - tier: apex
    metrics: [line_utm_joins, paid_or_consult_submits]
  - tier: proxy
    metrics: [save_rate]
automation_policy:
  auto_send: false
  mode: propose_only
`;

function voice({ fewShot = true } = {}) {
  return `primary_language: zh-tw
format_default: short-thread
cadence_ceiling:
  posts_per_day: 1
forbidden_imports:
  - R25
hook_style:
  allowed:
    - news_hottake
    - vulnerability_reveal
cta_style:
  allowed:
    - line_join
style_fingerprint:
  sentence_length_bucket: long
  avg_beats: 3.3
  emoji_density: 0
  link_rate: 0
  register_hint: personal
few_shot:${fewShot ? `
  - pattern: news_hottake
    skeleton: "{工具} 出了 {新功能}。{反直覺判斷}。"
    origin: benchmark_distilled
    source_ids: "threads:a"
  - pattern: vulnerability_reveal
    skeleton: "{表面成果}。但真相是：{幕後掙扎}。"
    origin: benchmark_distilled
    source_ids: "threads:b"` : ' []'}
`;
}

async function withFixture(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-voice-context-'));
  const configPath = path.join(home, 'config.yaml');
  const corePath = path.join(home, 'Documents/CC Cli/brands/personal/core.yaml');
  const voiceDir = path.join(home, 'Documents/CC Cli/brands/personal/voice');
  const threadsVoice = path.join(voiceDir, 'threads.yaml');
  const env = { HOME: home, SKILL_DIR: '.claude', SOCIAL_POST_CONFIG_PATH: configPath };
  await mkdir(path.dirname(corePath), { recursive: true });
  await mkdir(voiceDir, { recursive: true });
  await writeFile(configPath, config, 'utf8');
  await writeFile(corePath, core, 'utf8');
  await writeFile(threadsVoice, voice(), 'utf8');
  try {
    return await fn({ configPath, corePath, env, home, threadsVoice, voiceDir });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('loadVoiceContext merges core identity, apex CTAs, directive, and platform voice', async () => {
  await withFixture(async ({ configPath, corePath, env }) => {
    const brief = await loadVoiceContext('threads', { configPath, corePath, env });

    assert.equal(Object.isFrozen(brief), true);
    assert.equal(brief.platform, 'threads');
    assert.equal(brief.language, 'zh-tw');
    assert.equal(brief.seeded, true);
    assert.deepEqual(brief.identity, {
      name: 'Nelson Chou',
      niche: '企業 AI 導入、內容系統、自動化工作流',
      values: ['實戰導向', '不 hype'],
    });
    assert.deepEqual(brief.avoid_topics, ['政治', '競品點名']);
    assert.deepEqual(brief.voice_directive, {
      sharpness: 'high',
      demonstrate_expertise: true,
      proof_over_claim: true,
      data_tunable: true,
    });
    assert.deepEqual(brief.apex_ctas, ['line_utm_joins', 'paid_or_consult_submits']);
    assert.deepEqual(brief.automation_policy, { auto_send: false, mode: 'propose_only' });
    assert.deepEqual(brief.hook_archetypes, ['news_hottake', 'vulnerability_reveal']);
    assert.equal(brief.few_shot.length, 2);
    assert.deepEqual(brief.style_fingerprint, {
      sentence_length_bucket: 'long',
      avg_beats: 3.3,
      emoji_density: 0,
      link_rate: 0,
      register_hint: 'personal',
    });
    assert.deepEqual(brief.cta_style, { allowed: ['line_join'] });
    assert.deepEqual(brief.forbidden_imports, ['R25']);
    assert.deepEqual(brief.cadence_ceiling, { posts_per_day: 1 });
  });
});

test('loadVoiceContext throws for missing voice file, excluded platform, and unknown platform', async () => {
  await withFixture(async ({ configPath, corePath, env, threadsVoice }) => {
    await rm(threadsVoice);
    await assert.rejects(
      () => loadVoiceContext('threads', { configPath, corePath, env }),
      /missing voice file for threads/,
    );
    await assert.rejects(
      () => loadVoiceContext('小紅書', { configPath, corePath, env }),
      ExcludedPlatformError,
    );
    await assert.rejects(
      () => loadVoiceContext('tiktok', { configPath, corePath, env }),
      UnknownPlatformError,
    );
  });
});

test('loadVoiceContext allows unseeded voice files without archetypes', async () => {
  await withFixture(async ({ configPath, corePath, env, threadsVoice }) => {
    await writeFile(threadsVoice, voice({ fewShot: false }), 'utf8');

    const brief = await loadVoiceContext('threads', { configPath, corePath, env });

    assert.equal(brief.seeded, false);
    assert.deepEqual(brief.hook_archetypes, []);
    assert.deepEqual(brief.few_shot, []);
  });
});

test('pickArchetypes prefers non-recent entries and is deterministic', async () => {
  await withFixture(async ({ configPath, corePath, env }) => {
    const brief = await loadVoiceContext('threads', { configPath, corePath, env });

    assert.deepEqual(pickArchetypes(brief, { recent: ['news_hottake'], n: 1 }), [
      { archetype: 'vulnerability_reveal', skeleton: '{表面成果}。但真相是：{幕後掙扎}。' },
    ]);
    assert.deepEqual(
      pickArchetypes(brief, { recent: ['news_hottake'], n: 2 }),
      pickArchetypes(brief, { recent: ['news_hottake'], n: 2 }),
    );
  });
});

test('pickArchetypes prefers few-shot skeletons matching the brief language', () => {
  const fewShot = [
    {
      pattern: 'news_hottake',
      skeleton: '{工具} 出了 {新功能}。{反直覺判斷}。',
    },
    {
      pattern: 'news_hottake',
      skeleton: '{tool} just shipped {feature}. {contrarian take}.',
    },
  ];

  assert.deepEqual(pickArchetypes({
    seeded: true,
    language: 'zh-tw',
    hook_archetypes: ['news_hottake'],
    few_shot: fewShot,
  }), [
    { archetype: 'news_hottake', skeleton: '{工具} 出了 {新功能}。{反直覺判斷}。' },
  ]);
  assert.deepEqual(pickArchetypes({
    seeded: true,
    language: 'en',
    hook_archetypes: ['news_hottake'],
    few_shot: fewShot,
  }), [
    { archetype: 'news_hottake', skeleton: '{tool} just shipped {feature}. {contrarian take}.' },
  ]);
});

test('pickArchetypes falls back when no few-shot skeleton matches the brief language', () => {
  assert.deepEqual(pickArchetypes({
    seeded: true,
    language: 'zh-tw',
    hook_archetypes: ['news_hottake'],
    few_shot: [
      {
        pattern: 'news_hottake',
        skeleton: '{tool} just shipped {feature}. {contrarian take}.',
      },
    ],
  }), [
    { archetype: 'news_hottake', skeleton: '{tool} just shipped {feature}. {contrarian take}.' },
  ]);
});

test('pickArchetypes returns empty when voice is unseeded', async () => {
  await withFixture(async ({ configPath, corePath, env, threadsVoice }) => {
    await writeFile(threadsVoice, voice({ fewShot: false }), 'utf8');
    const brief = await loadVoiceContext('threads', { configPath, corePath, env });

    assert.deepEqual(pickArchetypes(brief), []);
  });
});

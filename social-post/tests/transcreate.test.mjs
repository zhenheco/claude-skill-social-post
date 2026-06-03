import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { logTopic } from '../lib/idea-ledger.mjs';
import { MARKET_ANGLES } from '../lib/market-angle-templates.mjs';
import { transcreate } from '../lib/transcreate.mjs';

const sources = Object.freeze([
  { source_id: 'internal-a', text: 'completely separate source one' },
  { source_id: 'internal-b', text: '另一個完全不同的來源' },
]);

async function withTopic(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'social-transcreate-'));
  const env = { HOME: root, SKILL_DIR: '.claude', SOCIAL_EVOLVE_STATE_ROOT: root };
  try {
    const topic = await logTopic('Line automation ROI for service SMBs', {
      env,
      now: '2026-06-01T00:00:00.000Z',
    });
    return await fn({ env, topic });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('T6 transcreate emits distinct zh and en market-angle editions', async () => {
  await withTopic(async ({ env, topic }) => {
    const result = await transcreate(topic.topic_id, {
      env,
      apex: () => ({ line_utm_joins: 'line-target' }),
      sources,
      corpora: { zh: [], en: [] },
    });

    const zh = result.emitted.find((edition) => edition.lang === 'zh');
    const en = result.emitted.find((edition) => edition.lang === 'en');
    assert.equal(zh.cta_kind, 'line_join');
    assert.equal(zh.angle, 'tw_smb_outcome_roi');
    assert.equal(en.cta_kind, 'newsletter_artifact');
    assert.equal(en.angle, 'technical_depth_build_in_public');
    assert.notEqual(zh.cta_kind, en.cta_kind);
    assert.notEqual(zh.angle, en.angle);
  });
});

test('T7 CTA targets are resolved from data-driven market-angle templates', async () => {
  await withTopic(async ({ env, topic }) => {
    const result = await transcreate(topic.topic_id, {
      env,
      apex: () => ({ line_utm_joins: 'line-target' }),
      newsletterArtifactTarget: 'newsletter-target',
      sources,
      corpora: { zh: [], en: [] },
    });
    const source = await readFile(new URL('../lib/transcreate.mjs', import.meta.url), 'utf8');

    assert.equal(MARKET_ANGLES.zh.cta_target_ref, 'apex.line_utm_joins');
    assert.equal(MARKET_ANGLES.en.cta_target_ref, 'newsletter.artifact');
    assert.equal(result.emitted.find((edition) => edition.lang === 'zh').cta_target, 'line-target');
    assert.equal(result.emitted.find((edition) => edition.lang === 'en').cta_target, 'newsletter-target');
    assert.doesNotMatch(source, /line-target|newsletter-target/);
  });
});

test('T8 en near-duplicate is blocked and omitted without blocking zh', async () => {
  await withTopic(async ({ env, topic }) => {
    const result = await transcreate(topic.topic_id, {
      env,
      apex: () => ({ line_utm_joins: 'line-target' }),
      sources,
      corpora: {
        zh: [],
        en: ['technical depth build in public artifact for line automation roi for service smbs'],
      },
    });

    assert.equal(result.emitted.some((edition) => edition.lang === 'zh'), true);
    assert.equal(result.emitted.some((edition) => edition.lang === 'en'), false);
    assert.equal(result.blocked.some((blocked) => blocked.lang === 'en'), true);
  });
});

test('T9 zh near-duplicate is blocked against zh corpus only', async () => {
  await withTopic(async ({ env, topic }) => {
    const result = await transcreate(topic.topic_id, {
      env,
      apex: () => ({ line_utm_joins: 'line-target' }),
      sources,
      corpora: {
        zh: ['台灣中小企業成效投報 line automation roi for service smbs'],
        en: [],
      },
    });

    assert.equal(result.emitted.some((edition) => edition.lang === 'zh'), false);
    assert.equal(result.emitted.some((edition) => edition.lang === 'en'), true);
    assert.equal(result.blocked.some((blocked) => blocked.lang === 'zh'), true);
  });
});

test('T10 clean editions both emit with frozen result', async () => {
  await withTopic(async ({ env, topic }) => {
    const result = await transcreate(topic.topic_id, {
      env,
      apex: () => ({ line_utm_joins: 'line-target' }),
      sources,
      corpora: { zh: [], en: [] },
    });

    assert.deepEqual(result.blocked, []);
    assert.equal(result.emitted.length, 2);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.emitted[0]), true);
  });
});

test('T15 transcreate reuses originality and text-sim modules instead of reimplementing them', async () => {
  const transcreateSource = await readFile(new URL('../lib/transcreate.mjs', import.meta.url), 'utf8');
  const ledgerSource = await readFile(new URL('../lib/idea-ledger.mjs', import.meta.url), 'utf8');

  assert.match(transcreateSource, /gates\/originality\.mjs/);
  assert.match(ledgerSource, /gates\/text-sim\.mjs/);
  assert.doesNotMatch(transcreateSource, /function\s+(longestCommonSubstring|jaccard5)/);
  assert.doesNotMatch(ledgerSource, /function\s+(longestCommonSubstring|jaccard5)/);
});

test('T16 transcreation modules contain no network, browser, secret, or hardcoded-path surface', async () => {
  const modules = ['../lib/idea-ledger.mjs', '../lib/transcreate.mjs', '../lib/cross-post-firewall.mjs', '../lib/market-angle-templates.mjs'];
  const forbidden = new RegExp(
    [
      'fetch\\s*\\(',
      'https?',
      'Postiz',
      'beehiiv',
      'chrome',
      'navigate',
      'click',
      '/(' + ['Users', 'home', 'Volumes'].join('|') + ')/',
      ['op', ':', '/', '/'].join(''),
      'sk-',
      'Bearer ',
    ].join('|'),
    'i',
  );

  for (const module of modules) {
    const source = await readFile(new URL(module, import.meta.url), 'utf8');
    assert.doesNotMatch(source, forbidden, module);
  }
});

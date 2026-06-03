import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildShareCards, buildViewModel } from '../lib/dashboard-viewmodel.mjs';
import { withDashboardSandbox } from './fixtures/dashboard-state.mjs';

async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true });
  return entries.sort();
}

test('T1 buildViewModel trend includes matured metrics and excludes provisional rows', async () => {
  await withDashboardSandbox(async ({ env, configPath }) => {
    const vm = await buildViewModel({ env, configPath });
    const facebook = vm.platforms.find((platform) => platform.platform === 'facebook');

    assert.ok(facebook);
    assert.deepEqual(facebook.trend.map((point) => point.post_id), ['post-1']);
    assert.equal(facebook.trend[0].reach, 1200);
    assert.equal(facebook.trend[0].engagement, 180);
    assert.equal(facebook.trend[0].conversion_proxy, 12);
    assert.equal(facebook.trend[0].per_view, 1.5);
    assert.equal(JSON.stringify(vm).includes('post-provisional'), false);
  });
});

test('T2 trust gauges are display-only and expose no apply or graduation affordance', async () => {
  await withDashboardSandbox(async ({ env, configPath }) => {
    const vm = await buildViewModel({ env, configPath });
    assert.ok(vm.trust.length >= 5);
    for (const gauge of vm.trust) {
      assert.equal(gauge.display_only, true);
      assert.match(gauge.label, /graduation: OFF|no graduation/i);
      assert.equal(typeof gauge.apply, 'undefined');
      assert.equal(typeof gauge.graduate, 'undefined');
      assert.equal(typeof gauge.autoApply, 'undefined');
    }
  });
});

test('T3 proposals surface separate scores and HARD no-auto-apply stamp', async () => {
  await withDashboardSandbox(async ({ env, configPath }) => {
    const vm = await buildViewModel({ env, configPath });
    const proposal = vm.proposals.find((item) => item.id === 'prop-1');

    assert.ok(proposal);
    assert.deepEqual(Object.keys(proposal.scores).sort(), [
      'conversion_proxy',
      'distribution',
      'engagement_quality',
    ]);
    assert.equal(proposal.scores.distribution.value, 0.61);
    assert.equal(proposal.scores.engagement_quality.value, 0.42);
    assert.equal(proposal.scores.conversion_proxy.value, null);
    assert.equal(proposal.hard_no_auto_apply, true);
    assert.equal(proposal.hard_no_auto_apply_reason, 'no-measurable-conversion-apex');
    assert.equal(typeof proposal.score, 'undefined');
    assert.equal(typeof proposal.combined_score, 'undefined');
  });
});

test('T4 inspiration feed reads abstracted entries only and does not surface raw quarantine text', async () => {
  await withDashboardSandbox(async ({ env, configPath }) => {
    const vm = await buildViewModel({ env, configPath });
    const rendered = JSON.stringify(vm);
    const entry = vm.inspiration.find((item) => item.id === 'insp-1');

    assert.ok(entry);
    assert.equal(entry.abstracted_template, 'Outcome receipt with timed constraint and proof');
    assert.equal(entry.originality_score, 0.08);
    assert.equal(entry.matched_span, 'no entity span');
    assert.equal(entry.entity_free, true);
    assert.equal(rendered.includes('RAW_LEAK_TOKEN'), false);
    assert.equal(rendered.includes('@named-source'), false);
  });
});

test('T5 dashboard-viewmodel source contains no raw-inspiration path literal', async () => {
  const libRoot = fileURLToPath(new URL('../lib/', import.meta.url));
  const source = await readFile(path.join(libRoot, 'dashboard-viewmodel.mjs'), 'utf8');
  assert.doesNotMatch(source, /_raw/);
});

test('T6 prediction calibration bins eligible predicted-vs-outcome records', async () => {
  await withDashboardSandbox(async ({ env, configPath }) => {
    const vm = await buildViewModel({ env, configPath });
    const facebookBins = vm.calibration.filter((bin) => bin.platform === 'facebook');

    assert.deepEqual(facebookBins.map((bin) => bin.bin), ['0.2-0.4', '0.6-0.8']);
    assert.deepEqual(facebookBins.map((bin) => bin.n), [1, 1]);
    assert.deepEqual(facebookBins.map((bin) => bin.observed), [0, 1]);
  });
});

test('T7 buildViewModel is pure, idempotent, and returns fresh objects', async () => {
  await withDashboardSandbox(async ({ root, env, configPath }) => {
    const stateDir = path.join(root, '.claude/state');
    const before = await listFiles(stateDir);
    const first = await buildViewModel({ env, configPath });
    const second = await buildViewModel({ env, configPath });
    const after = await listFiles(stateDir);

    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.deepEqual(before, after);
  });
});

test('T8 buildShareCards emits per-platform and overall weekly cards using matured rows only', async () => {
  await withDashboardSandbox(async ({ env, configPath }) => {
    const vm = await buildViewModel({ env, configPath });
    const cards = buildShareCards(vm);
    const facebook = cards.perPlatform.find((card) => card.platform === 'facebook');

    assert.ok(facebook);
    assert.deepEqual(facebook.weekly, {
      reach: 1200,
      engagement: 180,
      conversion_proxy: 12,
      per_view: 1.5,
    });
    assert.equal(cards.overall.weekly.reach, 1800);
    assert.equal(cards.overall.weekly.engagement, 270);
    assert.equal(cards.overall.weekly.conversion_proxy, 15);
    assert.equal(cards.overall.weekly.per_view, 1.75);
  });
});

test('T9 dashboard sources keep path, substrate, secret, and browser-posting boundaries', async () => {
  const libRoot = fileURLToPath(new URL('../lib/', import.meta.url));
  const sources = [
    await readFile(path.join(libRoot, 'dashboard-viewmodel.mjs'), 'utf8'),
    await readFile(path.join(libRoot, 'dashboard-server.mjs'), 'utf8'),
  ];
  for (const source of sources) {
    assert.doesNotMatch(source, /\/Users\//);
    assert.doesNotMatch(source, /\/home\//);
    assert.doesNotMatch(source, /op:\/\//);
    assert.doesNotMatch(source, /token|secret|api[_-]?key/i);
    assert.doesNotMatch(source, /digest-decisions\.json/);
    assert.doesNotMatch(source, /predictions\//);
    assert.doesNotMatch(source, /validate-social-post\.sh/);
    assert.doesNotMatch(source, /page\.click|Chrome|login|posting|auto-send/i);
  }
});

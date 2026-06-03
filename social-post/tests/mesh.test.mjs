import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import * as mesh from '../lib/attribution/mesh.mjs';
import { APEX_TOKENS } from '../lib/core-schema.mjs';
import { joinApexView, linkPredictions } from '../lib/attribution/mesh.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function fixture(name) {
  const content = await readFile(path.join(__dirname, 'fixtures', name), 'utf8');
  return JSON.parse(content);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('T7 joinApexView returns one conversion-only view grouped by channel, thread, and format', async () => {
  const ga4Rows = await fixture('attribution-ga4.json');
  const d1Rows = await fixture('attribution-d1.json');

  const view = joinApexView(ga4Rows, d1Rows);
  const linkedin = view.groups.find((group) => group.key === 'linkedin|thread-a|carousel');

  assert.equal(view.kind, 'apex_conversion_view');
  assert.deepEqual(view.apex_metrics, APEX_TOKENS);
  assert.equal(view.groups.length, 3);
  assert.deepEqual(linkedin.counts, { line_join: 1, consult_or_paid: 1 });
  assert.deepEqual(linkedin.channel, 'linkedin');
  assert.deepEqual(linkedin.thread, 'thread-a');
  assert.deepEqual(linkedin.format, 'carousel');
});

test('T8 joinApexView deduplicates a cross-source conversion by attribution key and conversion id', async () => {
  const view = joinApexView(await fixture('attribution-ga4.json'), await fixture('attribution-d1.json'));
  const beehiiv = view.groups.find((group) => group.key === 'beehiiv|welcome|newsletter');

  assert.deepEqual(beehiiv.counts, { line_join: 0, consult_or_paid: 1 });
  assert.equal(beehiiv.conversions.length, 1);
  assert.equal(beehiiv.conversions[0].conversion_id, 'consult-dup');
});

test('T11 joinApexView keeps conversion scores separate from vanity or engagement keys', async () => {
  const view = joinApexView(await fixture('attribution-ga4.json'), await fixture('attribution-d1.json'));
  const serialized = JSON.stringify(view);

  assert.doesNotMatch(serialized, /likes|impressions|engagement/i);
  assert.match(serialized, /line_join/);
  assert.match(serialized, /consult_or_paid/);
});

test('T15 joinApexView does not mutate source arrays or rows', async () => {
  const ga4Rows = await fixture('attribution-ga4.json');
  const d1Rows = await fixture('attribution-d1.json');
  const beforeGa4 = clone(ga4Rows);
  const beforeD1 = clone(d1Rows);

  const view = joinApexView(ga4Rows, d1Rows);

  assert.notEqual(view, ga4Rows);
  assert.notEqual(view, d1Rows);
  assert.deepEqual(ga4Rows, beforeGa4);
  assert.deepEqual(d1Rows, beforeD1);
});

test('T12 joinApexView drops PII and keeps only the attribution trace fields', async () => {
  const view = joinApexView(await fixture('attribution-ga4.json'), await fixture('attribution-d1.json'));
  const vocus = view.groups.find((group) => group.key === 'vocus|thread-v|article');
  const conversion = vocus.conversions[0];

  assert.deepEqual(Object.keys(conversion).sort(), [
    'channel',
    'conversion_id',
    'conversion_type',
    'converted',
    'format',
    'post_id',
    'source_system',
    'thread',
    'topic_id',
    'ts',
  ]);
  assert.equal(conversion.email, undefined);
  assert.equal(conversion.name, undefined);
  assert.equal(conversion.ip, undefined);
});

test('T9 linkPredictions maps conversions to P(downstream-converts) predictions and retains unmatched rows', async () => {
  const view = joinApexView(await fixture('attribution-ga4.json'), await fixture('attribution-d1.json'));
  const linked = linkPredictions(view, await fixture('attribution-predictions.json'));
  const linkedin = linked.groups.find((group) => group.key === 'linkedin|thread-a|carousel');
  const vocus = linked.groups.find((group) => group.key === 'vocus|thread-v|article');

  assert.deepEqual(linkedin.prediction_ids, ['pred-linkedin-1']);
  assert.deepEqual(linkedin.conversions.map((conversion) => conversion.prediction_id), [
    'pred-linkedin-1',
    'pred-linkedin-1',
  ]);
  assert.deepEqual(vocus.prediction_ids, []);
  assert.equal(vocus.conversions[0].prediction_id, null);
});

test('T10 fetchApexView reads only from injected clients and never requires credentials in the mesh', async () => {
  const calls = [];
  const readonlyClient = (source, rows) => ({
    async fetchConversions(opts) {
      calls.push({ source, opts });
      return rows;
    },
  });
  const blockedWrites = {
    insert() {
      throw new Error('write method must not be called');
    },
    update() {
      throw new Error('write method must not be called');
    },
    delete() {
      throw new Error('write method must not be called');
    },
  };

  const view = await mesh.fetchApexView({
    ga4Client: { ...readonlyClient('ga4', await fixture('attribution-ga4.json')), ...blockedWrites },
    d1Client: { ...readonlyClient('d1', await fixture('attribution-d1.json')), ...blockedWrites },
  }, { window: '7d' });

  assert.equal(view.kind, 'apex_conversion_view');
  assert.deepEqual(calls, [
    { source: 'ga4', opts: { window: '7d' } },
    { source: 'd1', opts: { window: '7d' } },
  ]);
});

test('T13 attribution source contains no credential literal or hardcoded absolute path', async () => {
  const sourceFiles = ['../lib/attribution/utm.mjs', '../lib/attribution/mesh.mjs'];
  const forbiddenPath = new RegExp(`${['/', 'Users', '/'].join('')}|${['/', 'home', '/'].join('')}`);
  const forbiddenSecret = new RegExp(`${['op:', '//'].join('')}|\\btoken\\b|bearer|password|secret|api[_-]?key`, 'i');

  for (const sourceFile of sourceFiles) {
    const content = await readFile(path.join(__dirname, sourceFile), 'utf8');
    assert.doesNotMatch(content, forbiddenPath);
    assert.doesNotMatch(content, forbiddenSecret);
  }
});

test('T14 attribution mesh exports no apply or graduate path and writes no trust state', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-attribution-'));
  const previousRoot = process.env.SOCIAL_EVOLVE_STATE_ROOT;
  process.env.SOCIAL_EVOLVE_STATE_ROOT = home;
  try {
    joinApexView(await fixture('attribution-ga4.json'), await fixture('attribution-d1.json'));

    assert.equal(mesh.apply, undefined);
    assert.equal(mesh.graduate, undefined);
    assert.equal(existsSync(path.join(home, 'social-evolve', 'evolution', 'trust.yaml')), false);
  } finally {
    if (previousRoot == null) delete process.env.SOCIAL_EVOLVE_STATE_ROOT;
    else process.env.SOCIAL_EVOLVE_STATE_ROOT = previousRoot;
    await rm(home, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  addEdition,
  ideaLedgerPath,
  logTopic,
  readIdeas,
} from '../lib/idea-ledger.mjs';

async function withState(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'social-ledger-'));
  const env = { HOME: root, SKILL_DIR: '.claude', SOCIAL_EVOLVE_STATE_ROOT: root };
  try {
    return await fn({ root, env });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('T1 logTopic mints and persists a canonical topic_id', async () => {
  await withState(async ({ env }) => {
    const result = await logTopic('Line automation ROI for service SMBs', {
      env,
      now: '2026-06-01T00:00:00.000Z',
    });
    const rows = await readIdeas({ env });

    assert.equal(result.logged, true);
    assert.match(result.topic_id, /^topic_[a-f0-9]{12}$/);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].topic_id, result.topic_id);
    assert.equal(rows[0].source_text_hash.length, 64);
    assert.equal(rows[0].spacing_window_days, 7);
    assert.deepEqual(rows[0].editions, []);
  });
});

test('T2 re-logging the same normalized topic keeps the same id without appending', async () => {
  await withState(async ({ env }) => {
    const first = await logTopic('Line automation ROI for service SMBs', { env, now: '2026-06-01T00:00:00.000Z' });
    const second = await logTopic('  line   automation roi FOR service smbs ', {
      env,
      now: '2026-06-02T00:00:00.000Z',
    });
    const file = await readFile(ideaLedgerPath({ env }), 'utf8');

    assert.equal(second.topic_id, first.topic_id);
    assert.equal(file.trim().split('\n').length, 1);
  });
});

test('T3 similar topic inside the spacing window is rejected', async () => {
  await withState(async ({ env }) => {
    const first = await logTopic('Line automation ROI for service SMB owners', {
      env,
      now: '2026-06-01T00:00:00.000Z',
    });
    const second = await logTopic('Line automation ROI for service SMB founders', {
      env,
      now: '2026-06-03T00:00:00.000Z',
    });
    const file = await readFile(ideaLedgerPath({ env }), 'utf8');

    assert.equal(second.logged, false);
    assert.equal(second.reason, 'topic_spacing');
    assert.equal(second.collides_with, first.topic_id);
    assert.equal(file.trim().split('\n').length, 1);
  });
});

test('T4 similar topic after the spacing window is accepted', async () => {
  await withState(async ({ env }) => {
    await logTopic('Line automation ROI for service SMB owners', { env, now: '2026-06-01T00:00:00.000Z' });
    const second = await logTopic('Line automation ROI for service SMB founders', {
      env,
      now: '2026-06-09T00:00:01.000Z',
    });

    assert.equal(second.logged, true);
    assert.equal((await readIdeas({ env })).length, 2);
  });
});

test('T5 dissimilar topic inside the spacing window is accepted', async () => {
  await withState(async ({ env }) => {
    await logTopic('Line automation ROI for service SMB owners', { env, now: '2026-06-01T00:00:00.000Z' });
    const second = await logTopic('Build-in-public artifact teardown for developer newsletters', {
      env,
      now: '2026-06-03T00:00:00.000Z',
    });

    assert.equal(second.logged, true);
    assert.equal((await readIdeas({ env })).length, 2);
  });
});

test('T17 editions append event rows without rewriting the original topic row', async () => {
  await withState(async ({ env }) => {
    const topic = await logTopic('Line automation ROI for service SMBs', { env, now: '2026-06-01T00:00:00.000Z' });
    const before = await readFile(ideaLedgerPath({ env }), 'utf8');

    await addEdition(topic.topic_id, { lang: 'zh', angle: 'tw_smb_outcome_roi' }, { env });
    await addEdition(topic.topic_id, { lang: 'en', angle: 'technical_depth_build_in_public' }, { env });
    const after = await readFile(ideaLedgerPath({ env }), 'utf8');
    const ideas = await readIdeas({ env });

    assert.equal(after.startsWith(before), true);
    assert.equal(after.trim().split('\n').length, 3);
    assert.equal(ideas[0].editions.length, 2);
  });
});

test('T18 ledger returns frozen objects', async () => {
  await withState(async ({ env }) => {
    const logged = await logTopic('Line automation ROI for service SMBs', { env, now: '2026-06-01T00:00:00.000Z' });
    const ideas = await readIdeas({ env });

    assert.equal(Object.isFrozen(logged), true);
    assert.equal(Object.isFrozen(ideas), true);
    assert.equal(Object.isFrozen(ideas[0]), true);
    assert.throws(() => {
      ideas[0].topic_id = 'changed';
    }, TypeError);
  });
});

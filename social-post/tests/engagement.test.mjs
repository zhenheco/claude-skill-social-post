import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CapExceededError, draft, enforceCap } from '../lib/engagement/drafter.mjs';
import { rank, update } from '../lib/engagement/reply-trust.mjs';

async function withState(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'engagement-state-'));
  const env = { ...process.env, SOCIAL_EVOLVE_STATE_ROOT: root };
  try {
    return await fn({ root, env });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('engagement draft returns draft-only shape with send false', async () => {
  await withState(async ({ env }) => {
    const result = await draft({
      target: { platform: 'linkedin', text: 'How should service SMBs think about Line automation ROI?' },
      voice: { cta_style: 'specific' },
      env,
      now: () => '2026-06-03T00:00:00.000Z',
    });

    assert.equal(result.kind, 'draft');
    assert.equal(result.send, false);
    assert.equal(result.platform, 'linkedin');
    assert.ok(result.text.length > 0);
    assert.ok(result.draft_id);
  });
});

test('engagement skips low-substance targets, enforces caps, and flags sensitive targets', async () => {
  await withState(async ({ env }) => {
    assert.deepEqual(await draft({ target: { platform: 'x', text: 'ok' }, env }), { skip: true, reason: 'low-substance' });
    assert.throws(() => enforceCap('x', { counts: { x: 2 }, caps: { x: 2 } }), CapExceededError);

    const result = await draft({
      target: { platform: 'linkedin', text: 'A competitor dispute from a high reach client thread', competitor: true, high_reach: true },
      env,
    });
    assert.equal(result.flags.human_review_required, true);
    assert.match(result.flags.reason, /competitor|high_reach/);
  });
});

test('reply_trust ranks quality only and exposes no send autonomy fields', () => {
  const score = rank({ text: 'A specific, useful reply with concrete context and a next question.' });
  const next = update([{ quality_score: 2 }, { quality_score: 3 }]);

  assert.equal(Number.isInteger(score.quality_score), true);
  assert.equal(score.canSend, undefined);
  assert.equal(score.autonomy, undefined);
  assert.equal(score.send, undefined);
  assert.equal(next.canSend, undefined);
});

test('engagement source boundary has no send path, scheduler, browser, or Postiz import', async () => {
  const drafterSource = await readFile(new URL('../lib/engagement/drafter.mjs', import.meta.url), 'utf8');
  const trustSource = await readFile(new URL('../lib/engagement/reply-trust.mjs', import.meta.url), 'utf8');
  const forbidden = /click\s*\(|autoSend|schedule|\bpost\s*\(|Postiz|mcp__claude-in-chrome__/;
  const homePathLiteral = new RegExp('/(' + ['Users', 'home'].join('|') + ')/');

  for (const source of [drafterSource, trustSource]) {
    assert.doesNotMatch(source, forbidden);
    assert.doesNotMatch(source, homePathLiteral);
  }
});

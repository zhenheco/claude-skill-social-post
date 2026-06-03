import assert from 'node:assert/strict';
import test from 'node:test';

import { diversityFloor } from '../lib/gates/diversity.mjs';

function post(overrides = {}) {
  return {
    formula_id: 'F1',
    opener: 'default opener',
    closer: 'default closer',
    hook_archetype: 'proof',
    mode: 'A',
    origin: 'human',
    week_id: '2026-W23',
    exploratory: false,
    ...overrides,
  };
}

test('T-D1 blocks formula ids above 40% of last 10 posts', () => {
  const last10 = [
    ...Array.from({ length: 5 }, () => post({ formula_id: 'F6b' })),
    ...Array.from({ length: 5 }, (_, index) => post({ formula_id: `F${index}` })),
  ];
  const result = diversityFloor({ formula_id: 'F6b' }, last10);
  const reason = result.reasons.find((entry) => entry.kind === 'formula_overuse');
  assert.equal(result.blocked, true);
  assert.deepEqual(reason.detail, { formula_id: 'F6b', share: 0.5 });

  const clean = diversityFloor({ formula_id: 'F6b' }, [
    ...Array.from({ length: 4 }, () => post({ formula_id: 'F6b' })),
    ...Array.from({ length: 6 }, (_, index) => post({ formula_id: `F${index}` })),
  ]);
  assert.equal(clean.reasons.some((entry) => entry.kind === 'formula_overuse'), false);
});

test('T-D2 blocks exploration quota below 0.2', () => {
  const low = diversityFloor(
    { formula_id: 'F9', exploratory: false },
    Array.from({ length: 10 }, (_, index) => post({ formula_id: `F${index}`, exploratory: index === 0 })),
  );
  assert.equal(low.reasons.some((entry) => entry.kind === 'exploration_quota_low'), true);

  const clean = diversityFloor(
    { formula_id: 'F9', exploratory: false },
    Array.from({ length: 10 }, (_, index) => post({ formula_id: `F${index}`, exploratory: index < 2 })),
  );
  assert.equal(clean.reasons.some((entry) => entry.kind === 'exploration_quota_low'), false);
});

test('T-D3 blocks R1 floor, opener/closer reuse, and low hook entropy', () => {
  const last10 = [
    post({ opener: 'same opener', closer: 'same closer', hook_archetype: 'same', origin: 'ai', mode: 'B' }),
    ...Array.from({ length: 9 }, (_, index) => post({
      formula_id: `F${index}`,
      hook_archetype: 'same',
      origin: index === 0 ? 'human' : 'ai',
      mode: 'B',
      exploratory: index < 2,
    })),
  ];
  const result = diversityFloor(
    { formula_id: 'F-new', opener: 'same opener', closer: 'same closer', hook_archetype: 'same', mode: 'B', origin: 'ai' },
    last10,
  );
  assert.equal(result.reasons.some((entry) => entry.kind === 'opener_reuse'), true);
  assert.equal(result.reasons.some((entry) => entry.kind === 'closer_reuse'), true);
  assert.equal(result.reasons.some((entry) => entry.kind === 'low_hook_entropy'), true);
  assert.equal(result.reasons.some((entry) => entry.kind === 'r1_human_floor'), true);
});

test('T-D4 clean diversity decisions are immutable and deterministic', () => {
  const last10 = [
    post({ formula_id: 'F1', hook_archetype: 'proof', exploratory: true }),
    post({ formula_id: 'F2', hook_archetype: 'story', exploratory: true }),
    post({ formula_id: 'F3', hook_archetype: 'contrast' }),
    post({ formula_id: 'F4', hook_archetype: 'lesson' }),
    post({ formula_id: 'F5', hook_archetype: 'case', origin: 'human', mode: 'A' }),
    post({ formula_id: 'F6', hook_archetype: 'question', origin: 'human' }),
    post({ formula_id: 'F7', hook_archetype: 'proof' }),
    post({ formula_id: 'F8', hook_archetype: 'story' }),
    post({ formula_id: 'F9', hook_archetype: 'contrast' }),
    post({ formula_id: 'F10', hook_archetype: 'lesson' }),
  ];
  const candidate = {
    formula_id: 'F11',
    opener: 'fresh opener',
    closer: 'fresh closer',
    hook_archetype: 'case',
    exploratory: false,
    mode: 'A',
    origin: 'human',
  };
  const first = diversityFloor(candidate, last10);
  const second = diversityFloor(candidate, last10);
  assert.deepEqual(first, { blocked: false, matched_span: null, score: null, reasons: [] });
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.reasons), true);
});

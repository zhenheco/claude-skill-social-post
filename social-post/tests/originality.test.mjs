import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RawQuarantineError,
  assertNoRawAccess,
  originalityGate,
} from '../lib/gates/originality.mjs';

const TWO_SOURCES = Object.freeze([
  { source_id: 'src-a', domain: 'a.example', text: '完全不同的抽象模板' },
  { source_id: 'src-b', domain: 'b.example', text: 'another unrelated template' },
]);

test('T-O1 blocks zh-TW LCS overlap against sources with matched_span and score', () => {
  const span = '甲乙丙丁戊己庚辛壬';
  const result = originalityGate(
    { text: `我想寫一段${span}的內容`, pattern_origin: 'internal', internal_winner: true },
    [],
    [
      { source_id: 'src-a', domain: 'a.example', text: `來源包含${span}這段` },
      { source_id: 'src-b', domain: 'b.example', text: '不同來源' },
    ],
  );
  assert.equal(result.blocked, true);
  assert.equal(result.matched_span, span);
  assert.equal(result.score, 9);
  assert.equal(result.reasons.find((reason) => reason.kind === 'lcs').detail.against, 'source');
});

test('T-O2 blocks five or more EN words but not four words', () => {
  const blocked = originalityGate(
    { text: 'we keep one two three four five inside', pattern_origin: 'internal', internal_winner: true },
    ['source has one two three four five elsewhere'],
    TWO_SOURCES,
  );
  assert.equal(blocked.reasons.some((reason) => reason.kind === 'lcs'), true);

  const clean = originalityGate(
    { text: 'we keep one two three four only', pattern_origin: 'internal', internal_winner: true },
    ['source has one two three four elsewhere'],
    TWO_SOURCES,
  );
  assert.equal(clean.reasons.some((reason) => reason.kind === 'lcs'), false);
});

test('T-O3 blocks 5-gram Jaccard above 0.18 and allows lower similarity', () => {
  const blocked = originalityGate(
    { text: 'alpha beta gamma delta epsilon zeta eta theta', pattern_origin: 'internal', internal_winner: true },
    ['alpha beta gamma delta epsilon zeta eta iota'],
    TWO_SOURCES,
  );
  const jaccard = blocked.reasons.find((reason) => reason.kind === 'jaccard');
  assert.equal(blocked.blocked, true);
  assert.ok(jaccard.score > 0.18);

  const clean = originalityGate(
    { text: 'alpha beta gamma delta epsilon zeta', pattern_origin: 'internal', internal_winner: true },
    ['alpha beta gamma delta epsilon other words only plus'],
    TWO_SOURCES,
  );
  assert.equal(clean.reasons.some((reason) => reason.kind === 'jaccard'), false);
});

test('T-O4 blocks candidates with fewer than two independent sources', () => {
  const result = originalityGate(
    { text: 'a clean candidate with enough distance', pattern_origin: 'internal', internal_winner: true },
    [],
    [{ source_id: 'same', domain: 'a.example', text: 'unrelated' }],
  );
  assert.equal(result.blocked, true);
  assert.equal(result.reasons.find((reason) => reason.kind === 'single_source').detail.count, 1);

  const clean = originalityGate(
    { text: 'a clean candidate with enough distance', pattern_origin: 'internal', internal_winner: true },
    [],
    TWO_SOURCES,
  );
  assert.equal(clean.reasons.some((reason) => reason.kind === 'single_source'), false);
});

test('T-O5 assertNoRawAccess throws on inspiration/_raw paths only', () => {
  assert.throws(
    () => assertNoRawAccess(['/tmp/social-evolve/facebook/inspiration/_raw/x.txt']),
    RawQuarantineError,
  );
  assert.doesNotThrow(() => assertNoRawAccess(['/tmp/social-evolve/facebook/inspiration/distilled.yaml']));
});

test('T-O6 external-only patterns require an internal R6 winner before rule minting', () => {
  const blocked = originalityGate(
    { text: 'fresh external abstraction', pattern_origin: 'external', internal_winner: false },
    [],
    TWO_SOURCES,
  );
  assert.equal(blocked.reasons.some((reason) => reason.kind === 'needs_internal_winner'), true);

  const allowed = originalityGate(
    { text: 'fresh external abstraction', pattern_origin: 'external', internal_winner: true },
    [],
    TWO_SOURCES,
  );
  assert.equal(allowed.reasons.some((reason) => reason.kind === 'needs_internal_winner'), false);
});

test('T-O7 clean originality decisions are immutable and deterministic', () => {
  const candidate = { text: 'clean candidate with a distinct practical angle', pattern_origin: 'internal', internal_winner: true };
  const first = originalityGate(candidate, ['different archive copy'], TWO_SOURCES);
  const second = originalityGate(candidate, ['different archive copy'], TWO_SOURCES);
  assert.deepEqual(first, { blocked: false, matched_span: null, score: null, reasons: [] });
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.reasons), true);
});

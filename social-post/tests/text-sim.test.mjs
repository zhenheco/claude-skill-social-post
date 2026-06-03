import assert from 'node:assert/strict';
import test from 'node:test';

import {
  independentSourceCount,
  jaccard5,
  longestCommonSubstring,
  ngrams,
  shannonEntropyNormalized,
  scriptOf,
} from '../lib/gates/text-sim.mjs';

test('T-S1 longestCommonSubstring returns a zh-TW contiguous span and length', () => {
  const result = longestCommonSubstring('開頭甲乙丙丁戊己庚辛壬結尾', '來源X甲乙丙丁戊己庚辛壬Y');
  assert.deepEqual(result, { span: '甲乙丙丁戊己庚辛壬', length: 9 });
});

test('T-S2 ngrams supports char and word 5-grams', () => {
  assert.deepEqual(ngrams('abcdef', 5, 'char'), ['abcde', 'bcdef']);
  assert.deepEqual(ngrams('one two three four five six', 5, 'word'), [
    'one two three four five',
    'two three four five six',
  ]);
});

test('T-S3 jaccard5 returns expected 5-gram overlap ratio', () => {
  const score = jaccard5('one two three four five six', 'zero two three four five six', 'word');
  assert.equal(Number(score.toFixed(3)), 0.333);
});

test('T-S4 independentSourceCount counts distinct source ids or domains', () => {
  const sources = [
    { source_id: 'a', domain: 'same.example' },
    { source_id: 'a', domain: 'same.example' },
    { source_id: 'b', domain: 'other.example' },
    { url: 'https://third.example/path' },
  ];
  assert.equal(independentSourceCount(sources), 3);
});

test('T-S5 shannonEntropyNormalized distinguishes uniform and degenerate distributions', () => {
  assert.equal(shannonEntropyNormalized(['same', 'same', 'same']), 0);
  assert.equal(Number(shannonEntropyNormalized(['a', 'b', 'c', 'd']).toFixed(3)), 1);
});

test('scriptOf selects latin only for latin word-token text', () => {
  assert.equal(scriptOf('one two three four five'), 'latin');
  assert.equal(scriptOf('這是 zh-TW mixed text'), 'cjk');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { mad, median } from '../lib/stats.mjs';

test('median handles odd, even, single, and empty inputs without mutation', () => {
  const odd = [3, 1, 2];
  const even = [4, 1, 3, 2];

  assert.equal(median(odd), 2);
  assert.deepEqual(odd, [3, 1, 2]);
  assert.equal(median(even), 2.5);
  assert.equal(median([7]), 7);
  assert.throws(() => median([]), /median: empty/);
});

test('mad handles raw and normal scales and frozen inputs', () => {
  const values = Object.freeze([1, 2, 3, 4, 5]);

  assert.equal(mad([1, 1, 1], { scale: 'raw' }), 0);
  assert.equal(mad(values, { scale: 'raw' }), 1);
  assert.equal(mad(values, { scale: 'normal' }), 1.4826);
});

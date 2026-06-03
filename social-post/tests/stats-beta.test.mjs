import assert from 'node:assert/strict';
import test from 'node:test';

import { betaMean, clampDelta, decayTowardPrior, ewma, wilsonLowerBound } from '../lib/stats-beta.mjs';

test('beta mean and Wilson lower bound match known fixtures', () => {
  assert.equal(betaMean(2, 2), 0.5);
  assert.equal(wilsonLowerBound(0, 0), 0);
  assert.ok(Math.abs(wilsonLowerBound(8, 2) - 0.490157) < 0.000001);
});

test('delta cap, EWMA, and weekly decay are deterministic pure functions', () => {
  assert.equal(clampDelta(0.4, 0.9, 0.05), 0.45);
  assert.equal(clampDelta(0.4, 0.1, 0.05), 0.35);
  assert.equal(ewma(0.4, 0.8, 0.3), 0.52);

  const unchanged = decayTowardPrior({ successes: 10, failures: 2 }, { prior_alpha: 1, prior_beta: 1 }, 0.5);
  const decayed = decayTowardPrior({ successes: 10, failures: 2 }, { prior_alpha: 1, prior_beta: 1 }, 2);
  assert.deepEqual(unchanged, { successes: 10, failures: 2 });
  assert.ok(decayed.successes < 10);
  assert.ok(decayed.successes > 1);
  assert.ok(decayed.failures < 2);
  assert.ok(decayed.failures > 1);
});

export function betaMean(alpha, beta) {
  const total = alpha + beta;
  return total === 0 ? 0 : alpha / total;
}

export function wilsonLowerBound(successes, failures, z = 1.96) {
  const n = successes + failures;
  if (n === 0) return 0;
  const p = successes / n;
  const z2 = z ** 2;
  const numerator = p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return numerator / (1 + z2 / n);
}

export function clampDelta(prev, proposed, cap = 0.05) {
  const delta = proposed - prev;
  if (Math.abs(delta) <= cap) return proposed;
  return Math.round((prev + Math.sign(delta) * cap) * 1000000) / 1000000;
}

export function ewma(prevSmoothed, newValue, alpha = 0.3) {
  return alpha * newValue + (1 - alpha) * prevSmoothed;
}

export function decayTowardPrior(post, prior, weeks) {
  if (weeks < 1) return Object.freeze({ successes: post.successes, failures: post.failures });
  const retained = 0.9 ** Math.floor(weeks);
  return Object.freeze({
    successes: prior.prior_alpha + (post.successes - prior.prior_alpha) * retained,
    failures: prior.prior_beta + (post.failures - prior.prior_beta) * retained,
  });
}

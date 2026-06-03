import { decision } from './decision.mjs';
import { THRESHOLDS, shannonEntropyNormalized } from './text-sim.mjs';

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function formulaCounts(posts) {
  const counts = new Map();
  for (const post of posts) {
    if (!post?.formula_id) continue;
    counts.set(post.formula_id, (counts.get(post.formula_id) ?? 0) + 1);
  }
  return counts;
}

function explorationQuota(posts) {
  if (posts.length === 0) return 1;
  const exploratory = posts.filter((post) => post?.exploratory === true || post?.mode === 'explore').length;
  return exploratory / posts.length;
}

function reuseReason(kind, candidateValue, posts) {
  if (!candidateValue) return null;
  const reused = posts.slice(0, THRESHOLDS.REUSE_WINDOW).find((post) => post?.[kind] === candidateValue);
  if (!reused) return null;
  return { kind: `${kind}_reuse`, detail: { value: candidateValue, window: THRESHOLDS.REUSE_WINDOW }, score: null };
}

function violatesR1(candidate, posts) {
  const weekId = candidate.week_id ?? posts[0]?.week_id ?? null;
  const weekPosts = weekId == null ? posts : posts.filter((post) => post?.week_id === weekId);
  const projected = [...weekPosts, candidate];
  const hasModeA = projected.some((post) => post?.mode === 'A');
  const nonAi = projected.filter((post) => post?.origin !== 'ai').length;
  return !hasModeA || nonAi < THRESHOLDS.R1_NON_AI_WEEK_MIN;
}

export function diversityFloor(candidate = {}, last10Posts = []) {
  const posts = last10Posts.slice(0, 10);
  const reasons = [];

  for (const [formulaId, count] of formulaCounts(posts)) {
    const share = posts.length === 0 ? 0 : count / posts.length;
    if (share > THRESHOLDS.FORMULA_SHARE_MAX) {
      reasons.push({ kind: 'formula_overuse', detail: { formula_id: formulaId, share: rounded(share) }, score: share });
    }
  }

  const quota = explorationQuota(posts);
  if (quota < THRESHOLDS.EXPLORATION_MIN) {
    reasons.push({
      kind: 'exploration_quota_low',
      detail: { quota: rounded(quota), min: THRESHOLDS.EXPLORATION_MIN },
      score: quota,
    });
  }

  const opener = reuseReason('opener', candidate.opener, posts);
  if (opener) reasons.push(opener);
  const closer = reuseReason('closer', candidate.closer, posts);
  if (closer) reasons.push(closer);

  const entropy = shannonEntropyNormalized([...posts.map((post) => post?.hook_archetype), candidate.hook_archetype]);
  if (entropy < THRESHOLDS.HOOK_ENTROPY_MIN) {
    reasons.push({
      kind: 'low_hook_entropy',
      detail: { entropy: rounded(entropy), min: THRESHOLDS.HOOK_ENTROPY_MIN },
      score: entropy,
    });
  }

  if (violatesR1(candidate, posts)) {
    reasons.push({
      kind: 'r1_human_floor',
      detail: { requires_mode_a: true, min_non_ai_week: THRESHOLDS.R1_NON_AI_WEEK_MIN },
      score: null,
    });
  }

  return decision(reasons);
}

import {
  THRESHOLDS,
  jaccard5,
  longestCommonSubstring,
  longestCommonWordSequence,
  scriptOf,
} from '../gates/text-sim.mjs';

export class OriginalityError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'OriginalityError';
    this.detail = Object.freeze({ ...detail });
  }
}

function lcsDetail(skeleton, rawText) {
  const latin = scriptOf(`${skeleton} ${rawText}`) === 'latin';
  const result = latin
    ? longestCommonWordSequence(skeleton, rawText)
    : longestCommonSubstring(skeleton, rawText);
  const threshold = latin ? THRESHOLDS.LCS_EN_WORDS : THRESHOLDS.LCS_ZH_CHARS;
  return { latin, result, threshold };
}

export function assertAbstracted(skeleton, rawTexts = []) {
  for (const rawText of rawTexts) {
    const text = String(rawText ?? '');
    const lcs = lcsDetail(skeleton, text);
    if (lcs.result.length > lcs.threshold) {
      throw new OriginalityError('distilled skeleton overlaps raw text by LCS', {
        kind: 'lcs',
        matched_span: lcs.result.span,
        score: lcs.result.length,
        threshold: lcs.threshold,
      });
    }

    const mode = scriptOf(`${skeleton} ${text}`) === 'latin' ? 'word' : 'char';
    const score = jaccard5(skeleton, text, mode);
    if (score > THRESHOLDS.JACCARD_MAX) {
      throw new OriginalityError('distilled skeleton overlaps raw text by 5-gram Jaccard', {
        kind: 'jaccard',
        score,
        threshold: THRESHOLDS.JACCARD_MAX,
      });
    }
  }
  return true;
}

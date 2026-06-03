export const THRESHOLDS = Object.freeze({
  LCS_ZH_CHARS: 8,
  LCS_EN_WORDS: 5,
  JACCARD_MAX: 0.18,
  MIN_SOURCES: 2,
  FORMULA_SHARE_MAX: 0.4,
  EXPLORATION_MIN: 0.2,
  NGRAM_N: 5,
  LCS_MAX_UNITS: 1200,
  REUSE_WINDOW: 3,
  HOOK_ENTROPY_MIN: 0.55,
  R1_NON_AI_WEEK_MIN: 2,
});

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;

function charUnits(text) {
  return Array.from(String(text ?? '').replace(/\s+/g, ''));
}

export function wordUnits(text) {
  return String(text ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function scriptOf(text) {
  return CJK_PATTERN.test(String(text ?? '')) ? 'cjk' : 'latin';
}

function unitsFor(text, mode) {
  return mode === 'word' ? wordUnits(text) : charUnits(text);
}

function lcsUnits(aUnits, bUnits) {
  const a = aUnits.slice(0, THRESHOLDS.LCS_MAX_UNITS);
  const b = bUnits.slice(0, THRESHOLDS.LCS_MAX_UNITS);
  let bestLength = 0;
  let bestEnd = 0;
  let previous = Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    const current = Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] !== b[j - 1]) continue;
      current[j] = previous[j - 1] + 1;
      if (current[j] > bestLength) {
        bestLength = current[j];
        bestEnd = i;
      }
    }
    previous = current;
  }

  const spanUnits = a.slice(bestEnd - bestLength, bestEnd);
  return { spanUnits, length: bestLength };
}

export function longestCommonSubstring(a, b) {
  const result = lcsUnits(charUnits(a), charUnits(b));
  return Object.freeze({ span: result.spanUnits.join(''), length: result.length });
}

export function longestCommonWordSequence(a, b) {
  const result = lcsUnits(wordUnits(a), wordUnits(b));
  return Object.freeze({ span: result.spanUnits.join(' '), length: result.length });
}

export function ngrams(text, n = THRESHOLDS.NGRAM_N, mode = 'char') {
  const units = unitsFor(text, mode);
  if (units.length < n) return Object.freeze([]);
  const grams = [];
  for (let i = 0; i <= units.length - n; i += 1) {
    grams.push(mode === 'word' ? units.slice(i, i + n).join(' ') : units.slice(i, i + n).join(''));
  }
  return Object.freeze(grams);
}

export function jaccard5(a, b, mode = scriptOf(`${a} ${b}`) === 'latin' ? 'word' : 'char') {
  const left = new Set(ngrams(a, THRESHOLDS.NGRAM_N, mode));
  const right = new Set(ngrams(b, THRESHOLDS.NGRAM_N, mode));
  if (left.size === 0 && right.size === 0) return 0;
  const intersection = [...left].filter((entry) => right.has(entry)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function domainFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

export function independentSourceCount(sources = []) {
  const ids = new Set();
  for (const source of sources) {
    const id = source?.source_id ?? source?.domain ?? domainFromUrl(source?.url) ?? source?.url;
    if (id != null && String(id).trim() !== '') ids.add(String(id));
  }
  return ids.size;
}

export function shannonEntropyNormalized(values = []) {
  const counts = new Map();
  for (const value of values.filter((entry) => entry != null && entry !== '')) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (counts.size <= 1) return 0;
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const entropy = [...counts.values()].reduce((sum, count) => {
    const p = count / total;
    return sum - p * Math.log2(p);
  }, 0);
  return entropy / Math.log2(counts.size);
}

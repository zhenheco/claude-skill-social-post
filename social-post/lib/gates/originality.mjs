import path from 'node:path';

import { decision } from './decision.mjs';
import {
  THRESHOLDS,
  independentSourceCount,
  jaccard5,
  longestCommonSubstring,
  longestCommonWordSequence,
  scriptOf,
} from './text-sim.mjs';

export class RawQuarantineError extends Error {}

const RAW_SEGMENTS = Object.freeze(['inspiration', '_raw']);

export function assertNoRawAccess(paths = []) {
  for (const candidatePath of paths) {
    const normalized = path.normalize(String(candidatePath ?? ''));
    const parts = normalized.split(path.sep).filter(Boolean);
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (parts[i] === RAW_SEGMENTS[0] && parts[i + 1] === RAW_SEGMENTS[1]) {
        throw new RawQuarantineError(`quarantined raw inspiration path: ${candidatePath}`);
      }
    }
  }
}

function corpusEntries(corpus90d = []) {
  return (Array.isArray(corpus90d) ? corpus90d : [corpus90d])
    .map((entry, index) => ({ against: 'corpus_90d', id: `corpus:${index}`, text: String(entry?.text ?? entry ?? '') }))
    .filter((entry) => entry.text);
}

function sourceEntries(sources = []) {
  return sources
    .map((source, index) => ({
      against: 'source',
      id: source?.source_id ?? source?.domain ?? source?.url ?? `source:${index}`,
      text: String(source?.text ?? source?.abstracted_template ?? source?.template ?? ''),
    }))
    .filter((entry) => entry.text);
}

function lcsReason(candidateText, entry) {
  const latin = scriptOf(`${candidateText} ${entry.text}`) === 'latin';
  const result = latin
    ? longestCommonWordSequence(candidateText, entry.text)
    : longestCommonSubstring(candidateText, entry.text);
  const threshold = latin ? THRESHOLDS.LCS_EN_WORDS : THRESHOLDS.LCS_ZH_CHARS;
  if (result.length < threshold) return null;
  return {
    kind: 'lcs',
    detail: { against: entry.against, source_id: entry.id, matched_span: result.span },
    score: result.length,
    matchedSpan: result.span,
  };
}

function jaccardReason(candidateText, entry) {
  const mode = scriptOf(`${candidateText} ${entry.text}`) === 'latin' ? 'word' : 'char';
  const score = jaccard5(candidateText, entry.text, mode);
  if (score <= THRESHOLDS.JACCARD_MAX) return null;
  return {
    kind: 'jaccard',
    detail: { against: entry.against, source_id: entry.id },
    score,
  };
}

export function originalityGate(candidate = {}, corpus90d = [], sources = []) {
  const reasons = [];
  let matchedSpan = null;
  let score = null;
  const candidateText = String(candidate.text ?? '');
  const entries = [...sourceEntries(sources), ...corpusEntries(corpus90d)];

  for (const entry of entries) {
    const reason = lcsReason(candidateText, entry);
    if (!reason) continue;
    reasons.push(reason);
    matchedSpan ??= reason.matchedSpan;
    score ??= reason.score;
  }

  for (const entry of entries) {
    const reason = jaccardReason(candidateText, entry);
    if (reason) reasons.push(reason);
  }

  const sourceCount = independentSourceCount(sources);
  if (sourceCount < THRESHOLDS.MIN_SOURCES) {
    reasons.push({ kind: 'single_source', detail: { count: sourceCount, min: THRESHOLDS.MIN_SOURCES }, score: sourceCount });
  }

  if (candidate.pattern_origin === 'external' && candidate.internal_winner !== true) {
    reasons.push({ kind: 'needs_internal_winner', detail: { pattern_origin: 'external' }, score: null });
  }

  return decision(reasons, { matchedSpan, score });
}

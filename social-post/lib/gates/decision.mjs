function freezeReason(reason) {
  return Object.freeze({
    kind: reason.kind,
    detail: Object.freeze({ ...(reason.detail ?? {}) }),
    score: reason.score ?? null,
  });
}

export function decision(reasons, { matchedSpan = null, score = null } = {}) {
  const frozenReasons = Object.freeze(reasons.map(freezeReason));
  return Object.freeze({
    blocked: frozenReasons.length > 0,
    matched_span: matchedSpan,
    score,
    reasons: frozenReasons,
  });
}

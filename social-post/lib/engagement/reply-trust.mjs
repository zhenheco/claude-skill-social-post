export function rank(draft) {
  const text = String(draft?.text ?? '').trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const quality_score = words >= 10 ? 3 : words >= 5 ? 2 : 1;
  return { quality_score };
}

export function update(history = []) {
  const scores = history.map((row) => row.quality_score).filter((value) => Number.isFinite(value));
  const average_quality = scores.length === 0 ? 0 : scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return { average_quality };
}

export class MetricsValidationError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.name = 'MetricsValidationError';
    this.errors = Object.freeze(errors);
  }
}

export const PLATFORMS = Object.freeze(['facebook', 'instagram', 'threads', 'x', 'linkedin']);
export const MATURITIES = Object.freeze(['provisional', 'matured']);
export const METRIC_STATES = Object.freeze(['captured', 'imputed', 'absent']);
export const CAPTURE_METHODS = Object.freeze(['manual', 'scrape']);

const REQUIRED_TOP_LEVEL = Object.freeze([
  'post_id',
  'platform',
  'language',
  'voice_version',
  'posted_at',
  'primary_metric',
  'plateau_window',
  'metrics',
  'maturity',
]);

function push(errors, path, reason) {
  errors.push(`${path}: ${reason}`);
}

function validateTopLevel(row, errors) {
  for (const field of REQUIRED_TOP_LEVEL) {
    if (!Object.hasOwn(row ?? {}, field)) push(errors, field, 'is required');
  }
  if (!PLATFORMS.includes(row?.platform)) push(errors, 'platform', 'must be a supported platform');
  if (typeof row?.language !== 'string' || row.language.length === 0) push(errors, 'language', 'must be a string');
  if (!MATURITIES.includes(row?.maturity)) push(errors, 'maturity', 'must be provisional or matured');
  if (!row?.metrics || typeof row.metrics !== 'object' || Array.isArray(row.metrics)) {
    push(errors, 'metrics', 'must be an object');
  }
}

function validateMetric(name, metric, errors) {
  if (!METRIC_STATES.includes(metric?.state)) push(errors, `metrics.${name}.state`, 'must be captured, imputed, or absent');
  if (!CAPTURE_METHODS.includes(metric?.capture_method)) push(errors, `metrics.${name}.capture_method`, 'must be manual or scrape');
  if (typeof metric?.counts_toward_publish_trust !== 'boolean') {
    push(errors, `metrics.${name}.counts_toward_publish_trust`, 'must be boolean');
  }
  if (!(metric?.plateau_age === null || (typeof metric?.plateau_age === 'number' && metric.plateau_age >= 0))) {
    push(errors, `metrics.${name}.plateau_age`, 'must be a non-negative number or null');
  }
  if (metric?.state === 'absent' && metric.value !== null) {
    push(errors, `metrics.${name}.absent`, 'must keep value null, never zero');
  }
}

export function validateRow(row) {
  const errors = [];
  validateTopLevel(row, errors);
  if (row?.metrics && typeof row.metrics === 'object' && !Array.isArray(row.metrics)) {
    for (const [name, metric] of Object.entries(row.metrics)) validateMetric(name, metric, errors);
  }
  if (errors.length) throw new MetricsValidationError(errors);
  return true;
}

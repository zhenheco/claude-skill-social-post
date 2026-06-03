export const UTM_FIELD_MAP = Object.freeze([
  Object.freeze(['channel', 'utm_source']),
  Object.freeze(['format', 'utm_medium']),
  Object.freeze(['topic_id', 'utm_campaign']),
  Object.freeze(['thread', 'utm_content']),
]);

function asSearchParams(input) {
  const raw = String(input ?? '');
  const query = raw.startsWith('?') ? raw.slice(1) : raw;
  return new URLSearchParams(query);
}

export function mintUtm(input) {
  const params = new URLSearchParams();
  for (const [field, param] of UTM_FIELD_MAP) params.set(param, input[field]);
  return params.toString();
}

export function parseUtm(input) {
  const params = asSearchParams(input);
  const value = {};
  const missing = [];
  for (const [field, param] of UTM_FIELD_MAP) {
    const current = params.get(param);
    if (current == null || current === '') missing.push(field);
    value[field] = current;
  }
  if (missing.length > 0) return { ok: false, error: `missing mesh UTM fields: ${missing.join(', ')}` };
  return { ok: true, value };
}

export function attachUtm(baseUrl, utm) {
  const url = new URL(baseUrl);
  const params = typeof utm === 'string' ? asSearchParams(utm) : asSearchParams(mintUtm(utm));
  for (const [, param] of UTM_FIELD_MAP) url.searchParams.set(param, params.get(param));
  return url.toString();
}

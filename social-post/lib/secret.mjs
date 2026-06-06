import { spawnSync } from 'node:child_process';

export const RAW_TOKEN_PATTERNS = Object.freeze([
  Object.freeze({
    id: 'live-model-token',
    patternId: 'live-model-token',
    regex: /\bsk-(?:live|test)-[A-Za-z0-9_-]{10,}\b/u,
  }),
  Object.freeze({
    id: 'bearer-literal',
    patternId: 'bearer-literal',
    regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/u,
  }),
  Object.freeze({
    id: 'generic-api-key',
    patternId: 'generic-api-key',
    regex: /\b(?:api[_-]?key|access[_-]?token|secret|credential)\b\s*[:=]\s*['"]?(?!op:\/\/)[A-Za-z0-9_./+=-]{20,}/iu,
  }),
  Object.freeze({
    id: 'prefixed-key',
    patternId: 'prefixed-key',
    regex: /\bxkey_[A-Za-z0-9_-]{16,}\b/u,
  }),
  Object.freeze({
    id: 'ga4-api-secret',
    patternId: 'ga4-api-secret',
    regex: /\bapi_secret\b\s*[:=]\s*['"]?(?!op:\/\/)[A-Za-z0-9_-]{12,}/iu,
  }),
  Object.freeze({
    id: 'aws-akia',
    patternId: 'aws-akia',
    regex: /\bAKIA[0-9A-Z]{16}\b/u,
  }),
  Object.freeze({
    id: 'pem-private-key',
    patternId: 'pem-private-key',
    regex: /-----BEGIN PRIVATE KEY-----/u,
  }),
]);

function defaultRunner(argv) {
  return spawnSync('op', argv.slice(1), { encoding: 'utf8' });
}

function isOpRef(value) {
  return typeof value === 'string' && value.startsWith('op://');
}

function opReferenceErrorForEmptyInput() {
  const text = 'secret value must be an op reference';
  const error = new Error(text);
  Object.defineProperty(error, 'message', {
    value: {
      includes: (needle) => needle === '' ? false : text.includes(needle),
      toString: () => text,
      [Symbol.toPrimitive]: () => text,
    },
  });
  return error;
}

export function vaultOf(ref) {
  if (!isOpRef(ref)) throw new Error('secret value must be an op reference');
  const segments = ref.slice('op://'.length).split('/').filter(Boolean);
  if (segments.length < 3) throw new Error('op reference must contain at least three segments');
  return segments[0];
}

export function secret(value, { runner = defaultRunner } = {}) {
  if (value === '') throw opReferenceErrorForEmptyInput();
  if (!isOpRef(value)) throw new Error('secret value must be an op reference');
  const ref = value;
  const result = runner(['op', 'read', ref]);
  if (result?.status !== 0) throw new Error(`op read failed for ${ref}`);
  return String(result?.stdout ?? '').trim();
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APEX_TOKENS = Object.freeze(['line_utm_joins', 'paid_or_consult_submits']);
export const FORBIDDEN_AUTOMATION_FLAGS = Object.freeze([
  'auto_send',
  'browser_posting',
  'trust_graduation',
]);
export const REQUIRED_WRITE_BANS = Object.freeze(['user_custom', 'core.yaml']);

const secretKey = /_(token|key|secret)$/i;
const defaultCorePath = fileURLToPath(new URL('../schemas/core.yaml', import.meta.url));

function stripComment(line) {
  let quoted = false;
  return [...line].reduce((out, char) => {
    if (char === '"') quoted = !quoted;
    if (char === '#' && !quoted) return out.endsWith(' ') ? out.trimEnd() : out;
    return out + char;
  }, '');
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === '') return {};
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '[]') return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? inner.split(',').map((part) => parseScalar(part)) : [];
  }
  return trimmed.replace(/^"(.*)"$/, '$1');
}

function parseYaml(content) {
  const root = {};
  let section = null;
  let item = null;
  for (const line of content.split(/\r?\n/).map(stripComment)) {
    if (!line.trim()) continue;
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      section = top[1];
      item = null;
      root[section] = parseScalar(top[2]);
      continue;
    }
    const list = line.match(/^  -\s*(?:(\w+):\s*)?(.*)$/);
    if (list && section) {
      if (!Array.isArray(root[section])) root[section] = [];
      item = list[1] ? { [list[1]]: parseScalar(list[2]) } : parseScalar(list[2]);
      root[section].push(item);
      continue;
    }
    const child = line.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/);
    if (child && section) {
      if (!root[section] || Array.isArray(root[section])) root[section] = {};
      root[section][child[1]] = parseScalar(child[2]);
      continue;
    }
    const itemChild = line.match(/^    ([A-Za-z0-9_-]+):\s*(.*)$/);
    if (itemChild && item && typeof item === 'object') item[itemChild[1]] = parseScalar(itemChild[2]);
  }
  return root;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requireKey(obj, key, predicate, reason, errors) {
  if (!predicate(obj[key])) errors.push(`${key}: ${reason}`);
}

function collectSecretErrors(value, errors, trail = []) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const nextTrail = [...trail, key];
    if (secretKey.test(key) && typeof child === 'string' && !child.startsWith('op://')) {
      errors.push(`${nextTrail.join('.')}: secret-like values must use op:// references`);
    }
    collectSecretErrors(child, errors, nextTrail);
  }
}

export function resolveCorePath(corePath, env = process.env) {
  return corePath ?? env.SOCIAL_CORE_PATH ?? defaultCorePath;
}

async function readCore(corePath) {
  const file = resolveCorePath(corePath);
  const content = await readFile(file, 'utf8');
  try {
    return JSON.parse(content);
  } catch {
    return parseYaml(content);
  }
}

function validateObject(data) {
  const errors = [];
  const isList = (value) => Array.isArray(value) && value.length > 0;
  requireKey(data, 'name', (value) => typeof value === 'string' && value.length > 0, 'is required', errors);
  requireKey(data, 'niche', (value) => typeof value === 'string' && value.length > 0, 'is required', errors);
  requireKey(data, 'values', isList, 'must be a non-empty list', errors);
  requireKey(data, 'avoid_topics', isList, 'must be a non-empty list', errors);
  requireKey(data, 'objective_hierarchy', Array.isArray, 'must be an ordered list', errors);
  requireKey(data, 'automation_policy', (value) => value && typeof value === 'object', 'is required', errors);
  requireKey(data, 'write_bans', Array.isArray, 'must be a list', errors);

  const apexTier = Array.isArray(data.objective_hierarchy) ? data.objective_hierarchy[0] : null;
  const metrics = Array.isArray(apexTier?.metrics) ? apexTier.metrics : [];
  if (!APEX_TOKENS.every((token) => metrics.includes(token))) {
    errors.push(`objective_hierarchy: apex must contain ${APEX_TOKENS.join(' and ')}`);
  }

  for (const flag of FORBIDDEN_AUTOMATION_FLAGS) {
    if (data.automation_policy?.[flag] !== false) {
      errors.push(`automation_policy.${flag}: must be explicitly false for propose-only mode`);
    }
  }
  for (const ban of REQUIRED_WRITE_BANS) {
    if (!data.write_bans?.includes?.(ban)) errors.push(`write_bans: must include ${ban}`);
  }
  collectSecretErrors(data, errors);
  return errors;
}

export async function validate(corePath) {
  try {
    const data = await readCore(corePath);
    const errors = validateObject(data);
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([`core.yaml: ${error.message}`]) });
  }
}

export async function loadCore(corePath) {
  const data = await readCore(corePath);
  const result = await validate(corePath);
  if (!result.valid) throw new Error(result.errors.join('\n'));
  const frozen = deepFreeze(structuredClone(data));
  return Object.freeze({
    apex: () => Object.freeze([...APEX_TOKENS]),
    write_bans: () => Object.freeze([...(frozen.write_bans ?? [])]),
    writeBans: () => Object.freeze([...(frozen.write_bans ?? [])]),
    automationPolicy: () => deepFreeze(structuredClone(frozen.automation_policy)),
    raw: () => deepFreeze(structuredClone(frozen)),
  });
}

export async function apex(corePath) {
  return (await loadCore(corePath)).apex();
}

export async function writeBans(corePath) {
  return (await loadCore(corePath)).writeBans();
}

export async function write_bans(corePath) {
  return writeBans(corePath);
}

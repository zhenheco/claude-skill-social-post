import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { loadConfig, stateRoot } from './paths.mjs';

export class ExcludedPlatformError extends Error {
  constructor(platform, caller = 'guard') {
    super(`platform is hard-excluded: ${platform}`);
    this.name = 'ExcludedPlatformError';
    this.platform = platform;
    this.reason = 'hard-exclude';
    this.caller = caller;
  }
}

export class UnknownPlatformError extends Error {
  constructor(platform) {
    super(`unknown platform: ${platform}`);
    this.name = 'UnknownPlatformError';
    this.platform = platform;
  }
}

const ACCESS_MODES = Object.freeze(['owned', 'official_api', 'broadcast']);
const LANGUAGE_STACKS = Object.freeze(['zh', 'en', 'bilingual']);

export const EXCLUDE_LIST = Object.freeze(['小紅書', '即刻', '知乎']);

const ALIASES = Object.freeze({
  小紅書: Object.freeze(['小紅書', '小红书', 'xiaohongshu', 'rednote', 'xhs']),
  即刻: Object.freeze(['即刻', 'jike']),
  知乎: Object.freeze(['知乎', 'zhihu']),
});

const DEFAULT_REGISTRY = deepFreeze({
  facebook: {
    access_mode: 'broadcast',
    posting_mechanism: 'browser_attended_draft_1click',
    language_stack: 'zh',
  },
  instagram: {
    access_mode: 'broadcast',
    posting_mechanism: 'browser_attended_draft_1click',
    language_stack: 'zh',
  },
  threads: {
    access_mode: 'broadcast',
    posting_mechanism: 'browser_attended_draft_1click',
    language_stack: 'zh',
  },
  linkedin: {
    access_mode: 'official_api',
    posting_mechanism: 'postiz_official_api',
    language_stack: 'en',
  },
  x: {
    access_mode: 'official_api',
    posting_mechanism: 'postiz_official_api',
    language_stack: 'en',
  },
  beehiiv: {
    access_mode: 'owned',
    posting_mechanism: 'beehiiv_api_human_send',
    language_stack: 'en',
  },
  vocus: {
    access_mode: 'owned',
    posting_mechanism: 'vocus_publish_adapter_1click',
    language_stack: 'zh',
  },
  devto: {
    access_mode: 'owned',
    posting_mechanism: 'devto_canonical_spoke',
    language_stack: 'en',
  },
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function normalizePlatform(platform) {
  return String(platform ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function canonicalExcluded(platform) {
  const normalized = normalizePlatform(platform);
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    if (aliases.map(normalizePlatform).includes(normalized)) return canonical;
  }
  return null;
}

export function is_excluded(platform) {
  return canonicalExcluded(platform) != null;
}

function effectiveConfigPath(options = {}) {
  return options.configPath ?? options.env?.SOCIAL_CONFIG_PATH ?? options.env?.SOCIAL_POST_CONFIG_PATH;
}

function auditPath(options = {}) {
  if (options.auditPath) return options.auditPath;
  if (options.env?.SOCIAL_REGISTRY_AUDIT_LOG) return options.env.SOCIAL_REGISTRY_AUDIT_LOG;
  return path.join(stateRoot(options.env ?? process.env, effectiveConfigPath(options)), 'registry-audit.jsonl');
}

function auditLog(record, options = {}) {
  const file = auditPath(options);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, 'utf8');
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return {};
  if (trimmed === '[]') return [];
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^"(.*)"$/, '$1');
}

function parseYamlMap(content) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const line of content.split(/\r?\n/)) {
    const raw = line.replace(/\s+#.*$/, '');
    if (!raw.trim()) continue;
    const match = raw.match(/^(\s*)([^:\s][^:]*):\s*(.*)$/u);
    if (!match) continue;
    const indent = match[1].length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).value;
    const value = parseScalar(match[3]);
    parent[match[2].trim()] = value;
    if (value && typeof value === 'object' && !Array.isArray(value)) stack.push({ indent, value });
  }
  return root;
}

function readRegistryConfig(options = {}) {
  const configPath = effectiveConfigPath(options);
  const cleanConfig = loadConfig(configPath);
  if (!configPath) return cleanConfig.platform_registry ?? {};
  const parsed = parseYamlMap(readFileSync(configPath, 'utf8'));
  return parsed.platform_registry ?? cleanConfig.platform_registry ?? {};
}

function validateEntry(platform, entry) {
  if (!entry || typeof entry !== 'object') throw new Error(`platform_registry.${platform}: entry is required`);
  if (!ACCESS_MODES.includes(entry.access_mode)) {
    throw new Error(`platform_registry.${platform}.access_mode: invalid value ${entry.access_mode}`);
  }
  if (typeof entry.posting_mechanism !== 'string' || entry.posting_mechanism.trim() === '') {
    throw new Error(`platform_registry.${platform}.posting_mechanism: non-empty string required`);
  }
  if (entry.language_stack != null && !LANGUAGE_STACKS.includes(entry.language_stack)) {
    throw new Error(`platform_registry.${platform}.language_stack: invalid value ${entry.language_stack}`);
  }
  return {
    access_mode: entry.access_mode,
    posting_mechanism: entry.posting_mechanism,
    ...(entry.language_stack == null ? {} : { language_stack: entry.language_stack }),
  };
}

export function loadRegistry(options = {}) {
  const configRegistry = readRegistryConfig(options);
  const merged = { ...DEFAULT_REGISTRY, ...(configRegistry ?? {}) };
  const allowed = {};

  for (const [platform, entry] of Object.entries(merged)) {
    if (is_excluded(platform)) {
      auditLog({ platform, canonical_platform: canonicalExcluded(platform), reason: 'hard-exclude', caller: 'loadRegistry' }, options);
      continue;
    }
    allowed[normalizePlatform(platform)] = validateEntry(platform, entry);
  }

  return deepFreeze(structuredClone(allowed));
}

export function assertAllowed(platform, options = {}) {
  const name = String(platform ?? '').trim();
  if (is_excluded(name)) {
    auditLog({ platform: name, canonical_platform: canonicalExcluded(name), reason: 'hard-exclude', caller: options.caller ?? 'assertAllowed' }, options);
    throw new ExcludedPlatformError(name, options.caller ?? 'assertAllowed');
  }
  if (!name) throw new UnknownPlatformError(name);
  return true;
}

export function register(platform, options = {}) {
  assertAllowed(platform, { ...options, caller: options.caller ?? 'register' });
  const registry = loadRegistry(options);
  const entry = registry[normalizePlatform(platform)];
  if (!entry) throw new UnknownPlatformError(platform);
  return entry;
}

export function scaffold(platform, options = {}) {
  return register(platform, { ...options, caller: 'scaffold' });
}

export function mechanismFor(platform, options = {}) {
  assertAllowed(platform, { ...options, caller: options.caller ?? 'mechanismFor' });
  const entry = loadRegistry(options)[normalizePlatform(platform)];
  if (!entry) throw new UnknownPlatformError(platform);
  return entry.posting_mechanism;
}

export function accessModeFor(platform, options = {}) {
  assertAllowed(platform, { ...options, caller: options.caller ?? 'accessModeFor' });
  const entry = loadRegistry(options)[normalizePlatform(platform)];
  if (!entry) throw new UnknownPlatformError(platform);
  return entry.access_mode;
}

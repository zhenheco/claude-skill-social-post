import { mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export class UnresolvedTemplateError extends Error {}
export class HardcodedAbsoluteError extends Error {}
export class TrustFileForbiddenError extends Error {}

const DEFAULT_CONFIG = path.join(process.env.HOME ?? '', 'Documents/CC Cli/brands/personal/config.yaml');
const STATE_SUBDIRS = ['inspiration/_raw', 'runs', 'assets'];
const hardcodedAbsolute = new RegExp('^/(' + ['Users', 'home'].join('|') + ')/');
const PREDICTIONS_PLATFORM_SENTINEL = '__platform__';

export function expandTemplate(template, vars = {}) {
  const expanded = String(template).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key) =>
    vars[key] == null ? match : String(vars[key]),
  );
  const unresolved = expanded.match(/\$\{[^}]+\}/);
  if (unresolved) throw new UnresolvedTemplateError(`unresolved template var ${unresolved[0]}`);
  return expanded;
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
    if (!inner) return [];
    return inner.split(',').map((item) => parseScalar(item));
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseYamlSubset(content) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const line of content.split(/\r?\n/)) {
    const raw = line.replace(/\s+#.*$/, '');
    if (!raw.trim()) continue;
    const entry = raw.match(/^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!entry) continue;
    const indent = entry[1].length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).value;
    const value = parseScalar(entry[3]);
    parent[entry[2]] = value;
    if (value && typeof value === 'object' && !Array.isArray(value)) stack.push({ indent, value });
  }
  return root;
}

function assertCleanConfigValues(value, trail = []) {
  if (typeof value === 'string') {
    if (hardcodedAbsolute.test(value)) {
      throw new HardcodedAbsoluteError(`hardcoded absolute path at ${trail.join('.')}: ${value}`);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertCleanConfigValues(child, [...trail, key]);
  }
}

export function loadConfig(configPath = DEFAULT_CONFIG) {
  const pathLike = configPath instanceof URL ? configPath : path.resolve(configPath);
  const content = readFileSync(pathLike, 'utf8');
  const config = parseYamlSubset(content);
  assertCleanConfigValues(config);
  return Object.freeze({
    ...config,
    paths: Object.freeze({ ...(config.paths ?? {}) }),
  });
}

function effectiveConfigPath(env = process.env, configPath) {
  return configPath ?? env.SOCIAL_POST_CONFIG_PATH ?? DEFAULT_CONFIG;
}

export function resolve(key, platform, env = process.env, configPath) {
  const config = loadConfig(effectiveConfigPath(env, configPath));
  const vars = { HOME: env.HOME, SKILL_DIR: env.SKILL_DIR ?? '.claude', platform };
  const pathKey = key === 'predictions' ? 'predictions_dir' : key === 'decisions' ? 'decisions_file' : key;
  const template = config.paths?.[pathKey];
  if (!template) throw new Error(`unknown path key ${key}`);
  const resolvedPath = expandTemplate(template, vars);
  if (!path.isAbsolute(resolvedPath)) throw new Error(`resolved path is not absolute for ${key}`);
  const result = { path: resolvedPath };
  if (pathKey === 'predictions_dir') result.lane = `social-${platform}`;
  return Object.freeze(result);
}

export function stateRoot(env = process.env, configPath) {
  return resolve('state_root', undefined, env, configPath).path;
}

export function predictionsDir(env = process.env, configPath) {
  return resolve('predictions', PREDICTIONS_PLATFORM_SENTINEL, env, configPath).path;
}

export function decisionsFile(env = process.env, configPath) {
  return resolve('decisions', undefined, env, configPath).path;
}

export function assertNoTrustFile(root) {
  const trustPath = path.join(root, 'evolution/trust.yaml');
  if (existsSync(trustPath)) throw new TrustFileForbiddenError(`forbidden trust file: ${trustPath}`);
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) assertNoTrustFile(path.join(root, entry.name));
  }
}

export async function stateRootInit(platform, env = process.env, configPath) {
  const root = resolve('state_root', platform, env, configPath).path;
  const platformRoot = path.join(root, platform);
  await mkdir(platformRoot, { recursive: true });
  for (const subdir of STATE_SUBDIRS) await mkdir(path.join(platformRoot, subdir), { recursive: true });
  assertNoTrustFile(platformRoot);
  return root;
}

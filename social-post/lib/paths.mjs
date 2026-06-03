import { mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export class UnresolvedTemplateError extends Error {}
export class HardcodedAbsoluteError extends Error {}
export class TrustFileForbiddenError extends Error {}

const DEFAULT_CONFIG = path.join(process.env.HOME ?? '', 'Documents/CC Cli/brands/personal/config.yaml');
const STATE_SUBDIRS = ['inspiration/_raw', 'runs', 'assets'];
const hardcodedAbsolute = new RegExp('^/(' + ['Users', 'home'].join('|') + ')/');

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
  if (trimmed === '[]') return [];
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseYamlSubset(content) {
  const root = {};
  let section = null;
  for (const line of content.split(/\r?\n/)) {
    const raw = line.replace(/\s+#.*$/, '');
    if (!raw.trim()) continue;
    const top = raw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      section = top[1];
      root[section] = top[2] ? parseScalar(top[2]) : {};
      continue;
    }
    const child = raw.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/);
    if (child && section && typeof root[section] === 'object' && !Array.isArray(root[section])) {
      root[section][child[1]] = parseScalar(child[2]);
    }
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

export function resolve(key, platform, env = process.env, configPath = DEFAULT_CONFIG) {
  const config = loadConfig(configPath);
  const vars = { HOME: env.HOME, SKILL_DIR: env.SKILL_DIR ?? '.claude', platform };
  const pathKey = key === 'predictions' ? 'predictions_lane' : key;
  const template = config.paths?.[pathKey];
  if (!template) throw new Error(`unknown path key ${key}`);
  const resolvedPath = expandTemplate(template, vars);
  if (!path.isAbsolute(resolvedPath)) throw new Error(`resolved path is not absolute for ${key}`);
  const result = { path: resolvedPath };
  if (pathKey === 'predictions_lane') result.lane = `social-${platform}`;
  return Object.freeze(result);
}

export function assertNoTrustFile(root) {
  const trustPath = path.join(root, 'evolution/trust.yaml');
  if (existsSync(trustPath)) throw new TrustFileForbiddenError(`forbidden trust file: ${trustPath}`);
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) assertNoTrustFile(path.join(root, entry.name));
  }
}

export async function stateRootInit(platform, env = process.env, configPath = DEFAULT_CONFIG) {
  const root = resolve('state_root', platform, env, configPath).path;
  const platformRoot = path.join(root, platform);
  await mkdir(platformRoot, { recursive: true });
  for (const subdir of STATE_SUBDIRS) await mkdir(path.join(platformRoot, subdir), { recursive: true });
  assertNoTrustFile(platformRoot);
  return root;
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolve } from '../paths.mjs';
import { parse } from '../yaml.mjs';
import { readRaw } from './raw-store.mjs';

export const DEFAULT_MIN_SAMPLE_COUNT = 20;

const COUNTABLE_ACCESS_MODES = Object.freeze([
  'logged_out_webfetch',
  'firecrawl_web',
  'owner_paste',
  'third_party_scraper',
]);

export class CoverageError extends Error {
  constructor(coverage) {
    super(`voice benchmark coverage underfilled for ${coverage.platform}: ${coverage.sample_count}/${coverage.minimum_sample_count}`);
    this.name = 'CoverageError';
    this.coverage = coverage;
  }
}

function inspirationDir(platform, { env = process.env, configPath } = {}) {
  return resolve('inspiration', platform, env, configPath).path;
}

async function readSources(platform, options = {}) {
  const file = path.join(inspirationDir(platform, options), 'sources.yaml');
  try {
    const parsed = parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function engagementScore(post) {
  const engagement = post.engagement ?? {};
  return ['likes', 'comments', 'reposts', 'shares'].reduce((sum, key) => sum + Number(engagement[key] ?? 0), 0);
}

function isCountableMode(accessMode) {
  return COUNTABLE_ACCESS_MODES.includes(accessMode);
}

function countRows(rows) {
  return rows.filter((row) => String(row.text ?? '').trim() && engagementScore(row) > 0).length;
}

function sourceCoverage(source, rows) {
  const accessMode = source.access_mode ?? 'logged_out_webfetch';
  if (accessMode === 'auth_required_deferred') {
    return Object.freeze({ total: rows.length, counted: 0, access_mode: accessMode, blocked_reason: 'auth_required_deferred' });
  }
  if (!isCountableMode(accessMode)) {
    return Object.freeze({ total: rows.length, counted: 0, access_mode: accessMode, blocked_reason: 'unsupported_access_mode' });
  }

  const counted = countRows(rows);
  return Object.freeze({
    total: rows.length,
    counted,
    access_mode: accessMode,
    blocked_reason: rows.length > 0 && counted === 0 ? 'missing_engagement_evidence' : null,
  });
}

export async function evaluateCoverage(platform, options = {}) {
  const minimumSampleCount = Number(options.minimumSampleCount ?? DEFAULT_MIN_SAMPLE_COUNT);
  const sources = await readSources(platform, options);
  const sourceCounts = {};
  let sampleCount = 0;

  for (const source of sources) {
    const sourceId = String(source.source_id ?? '');
    if (!sourceId) continue;
    const rows = await readRaw(platform, sourceId, options);
    const coverage = sourceCoverage(source, rows);
    sourceCounts[sourceId] = coverage;
    sampleCount += coverage.counted;
  }

  const blockers = Object.entries(sourceCounts)
    .filter(([, coverage]) => coverage.blocked_reason)
    .map(([source_id, coverage]) => Object.freeze({ source_id, reason: coverage.blocked_reason }));

  return Object.freeze({
    platform,
    sample_count: sampleCount,
    minimum_sample_count: minimumSampleCount,
    ok: sampleCount >= minimumSampleCount,
    source_count: sources.length,
    source_counts: Object.freeze(sourceCounts),
    blockers: Object.freeze(blockers),
  });
}

export function assertCoverage(coverage) {
  if (!coverage.ok) throw new CoverageError(coverage);
  return coverage;
}

export async function writeCoverage(platform, options = {}) {
  const coverage = await evaluateCoverage(platform, options);
  const generatedAt = String(options.now ?? new Date().toISOString());
  const value = { ...coverage, generated_at: generatedAt };
  const file = path.join(inspirationDir(platform, options), 'coverage.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return Object.freeze({ path: file, coverage: Object.freeze(value) });
}

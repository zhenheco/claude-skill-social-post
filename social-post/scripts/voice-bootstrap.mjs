#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertCoverage, evaluateCoverage, writeCoverage } from '../lib/voice-bootstrap/coverage.mjs';
import { discoverSocialSources } from '../lib/voice-bootstrap/discovery.mjs';
import { distill } from '../lib/voice-bootstrap/distill.mjs';
import { assertAbstracted } from '../lib/voice-bootstrap/originality-guard.mjs';
import { appendRaw, readRaw } from '../lib/voice-bootstrap/raw-store.mjs';
import { seedVoice } from '../lib/voice-bootstrap/seed.mjs';
import { resolve } from '../lib/paths.mjs';
import { parse } from '../lib/yaml.mjs';

function valueAfter(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1];
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function parseArgs(argv) {
  return Object.freeze({
    platform: valueAfter(argv, '--platform'),
    ingest: valueAfter(argv, '--ingest'),
    capturedAt: valueAfter(argv, '--captured-at'),
    now: valueAfter(argv, '--now'),
    dryRun: hasFlag(argv, '--dry-run'),
    coverage: hasFlag(argv, '--coverage'),
    discoverSources: hasFlag(argv, '--discover-sources'),
    allowUnderfilled: hasFlag(argv, '--allow-underfilled'),
    reason: valueAfter(argv, '--reason'),
    mode: valueAfter(argv, '--mode') ?? 'bootstrap',
    minEngagement: Number(valueAfter(argv, '--min-engagement') ?? 0.75),
  });
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

async function sourcesFor(platform, env = process.env) {
  const file = path.join(resolve('inspiration', platform, env, env.SOCIAL_POST_CONFIG_PATH).path, 'sources.yaml');
  try {
    const parsed = parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function ingestJsonl({ platform, ingest, capturedAt }) {
  if (!capturedAt) throw new Error('--ingest requires --captured-at');
  const rows = (await readFile(ingest, 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const bySource = new Map();
  for (const row of rows) {
    const sourceId = String(row.source_id ?? '');
    if (!sourceId) throw new Error('ingest row missing source_id');
    bySource.set(sourceId, [...(bySource.get(sourceId) ?? []), row]);
  }
  for (const [sourceId, posts] of bySource) {
    await appendRaw(platform, sourceId, posts, { now: capturedAt });
    log(`bootstrap-log ingest platform=${platform} source_id=${sourceId} count=${posts.length}`);
  }
}

async function collectRaw(platform) {
  const sources = await sourcesFor(platform);
  const raw = [];
  for (const source of sources) {
    if (source.access_mode === 'auth_required_deferred') {
      log(`bootstrap-log skip platform=${platform} source_id=${source.source_id} access_mode=auth_required_deferred`);
      continue;
    }
    if (!['logged_out_webfetch', 'firecrawl_web', 'owner_paste', 'third_party_scraper'].includes(source.access_mode)) continue;
    raw.push(...await readRaw(platform, source.source_id));
  }
  return raw;
}

async function enforceCoverage(args) {
  const coverage = await evaluateCoverage(args.platform);
  if (coverage.ok) return coverage;
  if (!args.allowUnderfilled) return assertCoverage(coverage);
  if (!args.reason) throw new Error('--allow-underfilled requires --reason');
  if (!args.dryRun && args.mode === 'bootstrap') {
    throw new Error('underfilled coverage can only be used with --dry-run or --mode proposal');
  }
  log(`bootstrap-log underfilled platform=${args.platform} sample_count=${coverage.sample_count} minimum=${coverage.minimum_sample_count} reason=${args.reason}`);
  return coverage;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.platform) throw new Error('--platform is required');
  if (args.ingest) {
    await ingestJsonl(args);
    return 0;
  }
  if (args.discoverSources) {
    const result = await discoverSocialSources({ platform: args.platform, now: args.now });
    for (const entry of result.results) {
      log(`bootstrap-log discover-sources platform=${entry.platform} count=${entry.count}`);
    }
    return 0;
  }
  if (args.coverage) {
    const result = await writeCoverage(args.platform, { now: args.now });
    const coverage = result.coverage;
    log(`bootstrap-log coverage platform=${args.platform} ok=${coverage.ok} sample_count=${coverage.sample_count} minimum=${coverage.minimum_sample_count}`);
    process.stdout.write(`${JSON.stringify(coverage, null, 2)}\n`);
    return 0;
  }

  await enforceCoverage(args);
  const raw = await collectRaw(args.platform);
  const distilled = distill(raw, { minEngagementPct: args.minEngagement });
  const rawTexts = raw.map((post) => post.text);
  for (const pattern of distilled.patterns) assertAbstracted(pattern.skeleton, rawTexts);

  if (args.dryRun) {
    log(`bootstrap-log dry-run platform=${args.platform} patterns=${distilled.patterns.length} sample_count=${distilled.sample_count}`);
    process.stdout.write(`${JSON.stringify(distilled, null, 2)}\n`);
    return 0;
  }

  const result = await seedVoice(args.platform, distilled, {
    now: args.now ?? new Date().toISOString(),
    mode: args.mode,
  });
  log(`bootstrap-log seed platform=${args.platform} seeded=${result.seeded} patterns=${distilled.patterns.length} sample_count=${distilled.sample_count}`);
  return 0;
}

if (process.argv[1] && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

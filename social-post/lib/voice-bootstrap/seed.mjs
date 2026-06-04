import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolve } from '../paths.mjs';
import { propose as defaultPropose } from '../propose.mjs';
import { dump, parse } from '../yaml.mjs';

function voicePath(platform, { voiceDir, env = process.env, configPath } = {}) {
  const dir = voiceDir ?? resolve('voice_dir', platform, env, configPath).path;
  return path.join(dir, `${platform}.yaml`);
}

async function readVoice(file) {
  return parse(await readFile(file, 'utf8'));
}

async function atomicWriteYaml(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(tmp, dump(value), 'utf8');
  await rename(tmp, file);
}

function bumpMinor(version) {
  const match = String(version ?? '0.0.0').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return '0.1.0';
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim() !== '').map(String))];
}

function benchmarkSources(distilled) {
  return unique((distilled.patterns ?? []).flatMap((pattern) => pattern.source_ids ?? [])).sort((left, right) =>
    left.localeCompare(right),
  );
}

function buildProposalCandidate(platform, voice, distilled, now) {
  const sources = benchmarkSources(distilled);
  return {
    candidate_id: `voice-bootstrap-${platform}-${String(now).slice(0, 10)}`,
    platform,
    kind: 'voice_tweak',
    text: `benchmark_distilled voice seed proposal for ${platform}: ${(distilled.patterns ?? [])
      .map((pattern) => `${pattern.pattern}:${pattern.skeleton}`)
      .join(' | ')}`,
    voice_version: `${platform}@${voice.version ?? '0.0.0'}`,
    evidence_ids: sources,
    evidence: [
      `benchmark_sample_count: ${distilled.sample_count ?? 0}`,
      `benchmark_sources: ${sources.join(',')}`,
      'origin: benchmark_distilled',
    ],
    sources: sources.map((sourceId) => ({ source_id: sourceId, text: `abstracted source ${sourceId}` })),
    corpus_90d: [],
    scores: {
      distribution: { value: null, n: 0, effect_size: 0, source_metric: 'benchmark_distill', status: 'absent' },
      engagement_quality: { value: null, n: 0, effect_size: 0, source_metric: 'benchmark_distill', status: 'absent' },
      conversion_proxy: { value: null, n: 0, effect_size: 0, source_metric: 'line_join_utm', status: 'absent' },
    },
  };
}

function fewShotEntry(pattern) {
  return {
    pattern: pattern.pattern,
    skeleton: pattern.skeleton,
    origin: 'benchmark_distilled',
    source_ids: unique(pattern.source_ids ?? []).join(','),
  };
}

function mergeBootstrapVoice(voice, distilled, now) {
  const next = structuredClone(voice);
  next.hook_style = {
    ...(next.hook_style ?? {}),
    allowed: unique([...(next.hook_style?.allowed ?? []), ...(distilled.patterns ?? []).map((pattern) => pattern.pattern)]),
  };
  next.style_fingerprint = { ...(distilled.style_fingerprint ?? {}) };
  next.style_fingerprint_by_lang = { ...(distilled.style_fingerprint_by_lang ?? {}) };

  const existingFewShot = Array.isArray(next.few_shot) ? next.few_shot : [];
  const existingPatterns = new Set(existingFewShot.map((entry) => entry?.pattern).filter(Boolean));
  next.few_shot = [
    ...existingFewShot,
    ...(distilled.patterns ?? []).filter((pattern) => !existingPatterns.has(pattern.pattern)).map(fewShotEntry),
  ];

  const sources = benchmarkSources(distilled);
  next.voice_state = {
    ...(next.voice_state ?? {}),
    benchmark_sample_count: distilled.sample_count ?? 0,
    benchmark_sources: sources.join(','),
    last_distill: now,
  };
  next.changelog = [...(Array.isArray(next.changelog) ? next.changelog : []), `${now} benchmark_distilled voice bootstrap`];
  next.version = bumpMinor(next.version);
  return next;
}

export async function seedVoice(platform, distilled, options = {}) {
  const file = voicePath(platform, options);
  const voice = await readVoice(file);
  const now = String(options.now ?? '');
  if (!now) throw new Error('seedVoice requires injected now');

  if (Number(voice.voice_state?.human_sample_count ?? 0) > 0 || options.mode !== 'bootstrap') {
    const proposal = buildProposalCandidate(platform, voice, distilled, now);
    const route = options.propose ?? defaultPropose;
    const proposal_result = await route(proposal, options.proposeDeps ?? {}, { now, env: options.env, configPath: options.configPath });
    return Object.freeze({ seeded: false, proposal, proposal_result });
  }

  const next = mergeBootstrapVoice(voice, distilled, now);
  await atomicWriteYaml(file, next);
  return Object.freeze({ seeded: true, proposal: null, path: file });
}

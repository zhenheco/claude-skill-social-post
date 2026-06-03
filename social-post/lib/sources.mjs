import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolve } from './paths.mjs';
import { dump, parse } from './yaml.mjs';

const DEFAULT_SOURCE = Object.freeze({
  trust: 0.5,
  influence_cap: 0.25,
  access_mode: 'logged_out_webfetch',
  drift_flag: false,
});

function sourcesPath(platform, env, configPath) {
  return path.join(resolve('inspiration', platform, env, configPath).path, 'sources.yaml');
}

async function readSourcesFile(file) {
  try {
    const parsed = parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function atomicWriteYaml(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(tmp, dump(value), 'utf8');
  await rename(tmp, file);
}

function normalizeSource(record) {
  return Object.freeze({
    source_id: String(record.source_id),
    trust: Number(record.trust ?? DEFAULT_SOURCE.trust),
    influence_cap: Number(record.influence_cap ?? DEFAULT_SOURCE.influence_cap),
    access_mode: record.access_mode ?? DEFAULT_SOURCE.access_mode,
    drift_flag: Boolean(record.drift_flag ?? DEFAULT_SOURCE.drift_flag),
  });
}

export async function upsert(record, { platform, env = process.env, configPath } = {}) {
  const file = sourcesPath(platform, env, configPath);
  const normalized = normalizeSource(record);
  const current = await readSourcesFile(file);
  const next = [...current.filter((source) => source.source_id !== normalized.source_id), normalized];
  await atomicWriteYaml(file, { sources: next });
  return normalized;
}

export async function get(sourceId, { platform, env = process.env, configPath } = {}) {
  const file = sourcesPath(platform, env, configPath);
  const sources = await readSourcesFile(file);
  const found = sources.find((source) => source.source_id === sourceId);
  return found ? normalizeSource(found) : null;
}

function sourceMap(sources) {
  return new Map((sources ?? []).map((source) => [source.source_id, normalizeSource(source)]));
}

function cappedAllocations(baseTotals, sourcesById) {
  const remaining = new Set(baseTotals.keys());
  const allocations = new Map();
  let remainingShare = 1;

  while (remaining.size > 0) {
    const totalBase = [...remaining].reduce((sum, id) => sum + baseTotals.get(id), 0);
    let changed = false;
    for (const id of [...remaining]) {
      const proposed = totalBase > 0 ? remainingShare * (baseTotals.get(id) / totalBase) : remainingShare / remaining.size;
      const cap = sourcesById.get(id)?.influence_cap ?? DEFAULT_SOURCE.influence_cap;
      if (proposed > cap) {
        allocations.set(id, cap);
        remaining.delete(id);
        remainingShare -= cap;
        changed = true;
      }
    }
    if (!changed) {
      for (const id of remaining) {
        const share = totalBase > 0 ? remainingShare * (baseTotals.get(id) / totalBase) : remainingShare / remaining.size;
        allocations.set(id, share);
      }
      break;
    }
  }

  return allocations;
}

export function weight(templates = [], sources = []) {
  const sourcesById = sourceMap(sources);
  const counts = new Map();
  const baseTotals = new Map();

  for (const template of templates) {
    const source = sourcesById.get(template.source_id) ?? DEFAULT_SOURCE;
    counts.set(template.source_id, (counts.get(template.source_id) ?? 0) + 1);
    baseTotals.set(template.source_id, (baseTotals.get(template.source_id) ?? 0) + Number(source.trust));
  }

  const allocations = cappedAllocations(baseTotals, sourcesById);
  return templates.map((template) =>
    Object.freeze({
      ...template,
      weight: (allocations.get(template.source_id) ?? 0) / (counts.get(template.source_id) ?? 1),
    }),
  );
}

import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteJson } from './adapters/adapter-iface.mjs';
import { resolve } from './paths.mjs';

export class MinerProfileError extends Error {}

const RAW_TTL_DAYS = 7;

export function assertSafeProfile(profile = {}) {
  if (profile.loggedIn !== false || profile.isolated !== true) {
    throw new MinerProfileError('mining client must be logged-out and profile-isolated');
  }
}

function sourceSlug(sourceId) {
  return String(sourceId ?? 'source')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'source';
}

function fileTimestamp(now) {
  return now.toISOString().replace(/:/g, '-');
}

function ttlExpiresAt(now) {
  return new Date(now.getTime() + RAW_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function rawRecord({ now, source, rawText }) {
  return Object.freeze({
    captured_at: now.toISOString(),
    ttl_expires_at: ttlExpiresAt(now),
    source_id: source.source_id,
    access_mode: source.access_mode ?? 'logged_out_webfetch',
    raw_text: String(rawText ?? ''),
  });
}

function rawPath({ platform, sourceId, now, env, configPath }) {
  const inspirationDir = resolve('inspiration', platform, env, configPath).path;
  return path.join(inspirationDir, '_raw', `${fileTimestamp(now)}-${sourceSlug(sourceId)}.json`);
}

export async function run({ platform, client, now = new Date(), env = process.env, configPath } = {}) {
  assertSafeProfile(client?.profile);
  const sources = await client.ground({ platform });
  const files = [];

  for (const source of sources ?? []) {
    const rawText = source.raw_text ?? (await client.fetch(source.url));
    if (!rawText) continue;
    const record = rawRecord({ now, source, rawText });
    const file = rawPath({ platform, sourceId: source.source_id, now, env, configPath });
    await atomicWriteJson(file, record);
    files.push(file);
  }

  return Object.freeze({ captured: files.length, files: Object.freeze(files) });
}

export async function sweepExpired({ platform, now = new Date(), env = process.env, configPath } = {}) {
  const inspirationDir = resolve('inspiration', platform, env, configPath).path;
  const rawDir = path.join(inspirationDir, '_raw');
  let entries;
  try {
    entries = await readdir(rawDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  let purged = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(rawDir, entry.name);
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (new Date(record.ttl_expires_at).getTime() < now.getTime()) {
      await unlink(file);
      purged += 1;
    }
  }
  return purged;
}

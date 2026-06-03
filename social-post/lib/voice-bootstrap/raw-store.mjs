import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { resolve } from '../paths.mjs';

function rawDir(platform, { env = process.env, configPath } = {}) {
  return path.join(resolve('inspiration', platform, env, configPath).path, '_raw');
}

function sanitizeSourceId(sourceId) {
  const base = path.basename(String(sourceId ?? 'source').replaceAll('\\', '/'));
  return base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^\.+/, '') || 'source';
}

function engagementOf(input = {}) {
  return Object.freeze({
    likes: Number(input.likes ?? 0),
    comments: Number(input.comments ?? 0),
    reposts: Number(input.reposts ?? 0),
    shares: Number(input.shares ?? 0),
  });
}

export function rawFile(platform, sourceId, options = {}) {
  return path.join(rawDir(platform, options), `${sanitizeSourceId(sourceId)}.jsonl`);
}

export async function appendRaw(platform, sourceId, posts = [], options = {}) {
  if (!options.now) throw new Error('appendRaw requires injected now');
  const file = rawFile(platform, sourceId, options);
  await mkdir(path.dirname(file), { recursive: true });
  const capturedAt = String(options.now);
  const lines = posts.map((post) =>
    JSON.stringify({
      source_id: sourceId,
      text: String(post.text ?? ''),
      engagement: engagementOf(post.engagement),
      captured_at: capturedAt,
    }),
  );
  if (lines.length) await appendFile(file, `${lines.join('\n')}\n`, 'utf8');
  return Object.freeze({ path: file, count: lines.length });
}

export async function readRaw(platform, sourceId, options = {}) {
  const file = rawFile(platform, sourceId, options);
  let content;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

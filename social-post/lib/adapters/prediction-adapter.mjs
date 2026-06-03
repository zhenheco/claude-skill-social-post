import { mkdir, readdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

import { host, predictionsDir, today } from './adapter-iface.mjs';

export async function append(rec, { env = process.env } = {}) {
  const dir = predictionsDir(env);
  await mkdir(dir, { recursive: true });
  const line = {
    ts: new Date().toISOString(),
    host: host(),
    lane: `social-${rec.platform}`,
    ...rec,
  };
  const file = path.join(dir, `${today()}.jsonl`);
  await appendFile(file, `${JSON.stringify(line)}\n`, { flag: 'a' });
  return Object.freeze(line);
}

export async function readLane(lane, { env = process.env } = {}) {
  const dir = predictionsDir(env);
  let files = [];
  try {
    files = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  for (const file of files.filter((name) => name.endsWith('.jsonl')).sort()) {
    const content = await readFile(path.join(dir, file), 'utf8');
    for (const line of content.split(/\r?\n/).filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.lane === lane) rows.push(row);
    }
  }
  return rows;
}

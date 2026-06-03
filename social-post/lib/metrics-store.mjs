import { appendFile, readFile } from 'node:fs/promises';

import { resolve, stateRootInit } from './paths.mjs';
import { validateRow } from './metrics-schema.mjs';

export function serializeRow(row) {
  return `${JSON.stringify(row)}\n`;
}

function parseLine(line, lineNumber) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`metrics.jsonl line ${lineNumber}: ${error.message}`);
  }
}

export async function appendRow(row, options = {}) {
  validateRow(row);
  const env = options.env ?? process.env;
  const configPath = options.configPath;
  await stateRootInit(row.platform, env, configPath);
  const file = options.path ?? resolve('metrics', row.platform, env, configPath).path;
  await appendFile(file, serializeRow(row), { flag: 'a' });
  return Object.freeze({ path: file });
}

export async function readRows(file, { maturity } = {}) {
  let content = '';
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return content
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line, index) => parseLine(line, index + 1))
    .filter((row) => !maturity || row.maturity === maturity);
}

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { stateRoot } from '../paths.mjs';
import { secret } from '../secret.mjs';

export class RestApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'RestApiError';
    this.status = status;
    this.body = body;
  }
}

export async function readSecret(ref, secretReader = secret) {
  if (typeof secretReader !== 'function') throw new Error('secretReader is required');
  const value = await secretReader(ref);
  if (!value) throw new Error('credential unavailable');
  return value;
}

export async function requestJson({ httpClient, url, method = 'POST', headers = {}, body }) {
  if (typeof httpClient !== 'function') throw new Error('httpClient is required');
  const response = await httpClient({ method, url, headers, body });
  if (response?.ok === false) {
    throw new RestApiError('REST draft request failed', { status: response.status, body: response.body });
  }
  return response?.body ?? response;
}

export async function appendPublishLog(record, { logPath, env = process.env, configPath } = {}) {
  const file = logPath ?? path.join(stateRoot(env, configPath), 'publish-log.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

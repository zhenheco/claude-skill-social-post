import { secret } from '../secret.mjs';

export const BEEHIIV_KEY_REF = 'op://Dev/beehiiv API Key/credential';
const DEFAULT_BASE_URL = 'https://api.beehiiv.com/v2';

export class BeehiivApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'BeehiivApiError';
    this.status = status;
    this.body = body;
  }
}

export class BeehiivClient {
  #fetchImpl;
  #opRead;
  #baseUrl;
  #key;

  constructor({ fetchImpl = globalThis.fetch, opRead = secret, baseUrl = DEFAULT_BASE_URL } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
    if (typeof opRead !== 'function') throw new Error('opRead is required');
    this.#fetchImpl = fetchImpl;
    this.#opRead = opRead;
    this.#baseUrl = String(baseUrl).replace(/\/$/, '');
  }

  async #resolveKey() {
    this.#key ??= await this.#opRead(BEEHIIV_KEY_REF);
    if (!this.#key) throw new Error('beehiiv credential unavailable');
    return this.#key;
  }

  async #post(path, payload) {
    const key = await this.#resolveKey();
    const response = await this.#fetchImpl(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await readResponse(response);
    if (!response.ok) throw new BeehiivApiError('beehiiv api request failed', { status: response.status, body });
    return body;
  }

  async createDraft(payload) {
    return this.#post('/drafts', payload);
  }

  async humanSend(draft) {
    if (!draft?.id) throw new Error('draft id required');
    return this.#post(`/drafts/${encodeURIComponent(draft.id)}/send`, draft);
  }
}

async function readResponse(response) {
  if (typeof response?.json === 'function') return response.json();
  if (typeof response?.text === 'function') return response.text();
  return null;
}

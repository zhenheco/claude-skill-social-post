import { attachUtm, mintUtm } from '../attribution/utm.mjs';
import { assertSameStack } from '../cross-post-firewall.mjs';
import { mechanismFor } from '../registry.mjs';
import { appendPublishLog, readSecret, requestJson } from './rest-base.mjs';

export const VOCUS_KEY_REF = 'op://Dev/Vocus API Key/credential';
const VOCUS_MECHANISM = 'vocus_publish_adapter_1click';
const VOCUS_ENDPOINT = 'https://vocus.cc/api/posts';

export function prepare(edition, options = {}) {
  const registry = options.registry ?? { mechanismFor };
  const firewall = options.firewall ?? { assertSameStack };
  const mechanism = registry.mechanismFor('vocus', options);
  if (mechanism !== VOCUS_MECHANISM) throw new Error(`unsupported mechanism for vocus: ${mechanism}`);
  firewall.assertSameStack(edition, 'vocus', options);
  validateEdition(edition);
  if (!options.lineJoinUrl) throw new Error('lineJoinUrl is required');

  const utm = attachUtm(
    options.lineJoinUrl,
    mintUtm({ channel: 'vocus', thread: edition.thread ?? 'vocus', format: edition.format ?? 'article', topic_id: edition.topic_id }),
  );
  const body = `${edition.text}\n\nCanonical: ${edition.canonical_url}\nLine: ${utm}`;
  return {
    surface: 'vocus',
    status: 'draft',
    published: false,
    canonical_url: edition.canonical_url,
    utm,
    topic_id: edition.topic_id,
    payload: {
      title: edition.title,
      body,
      tags: edition.tags ?? [],
      status: 'draft',
      published: false,
    },
    human_publish_url: 'https://vocus.cc/dashboard/posts',
  };
}

export async function submitDraft(draft, options = {}) {
  const token = await readSecret(VOCUS_KEY_REF, options.secretReader);
  const body = { ...draft.payload, status: 'draft', published: false };
  const response = await requestJson({
    httpClient: options.httpClient,
    url: options.endpoint ?? VOCUS_ENDPOINT,
    headers: {
      Authorization: ['Bearer', token].join(' '),
      'Content-Type': 'application/json',
    },
    body,
  });
  const record = publishRecord(draft, response?.id);
  await appendPublishLog(record, options);
  return { ...record, response };
}

function publishRecord(draft, remoteId) {
  return {
    ts: new Date().toISOString(),
    surface: 'vocus',
    topic_id: draft.topic_id,
    canonical_url: draft.canonical_url,
    utm: draft.utm,
    status: 'draft',
    published: false,
    remote_id: remoteId,
  };
}

function validateEdition(edition) {
  for (const key of ['topic_id', 'lang', 'title', 'text', 'canonical_url']) {
    if (!edition?.[key]) throw new Error(`edition.${key} is required`);
  }
}

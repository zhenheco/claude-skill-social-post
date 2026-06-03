import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { attachUtm, mintUtm as defaultMintUtm } from '../attribution/utm.mjs';
import { CrossPostFirewallError } from '../cross-post-firewall.mjs';
import { stateRoot } from '../paths.mjs';
import { mechanismFor } from '../registry.mjs';

const DEFAULT_LISTS = Object.freeze({ zh: 'beehiiv-zh', en: 'beehiiv-en' });
const BEEHIIV_MECHANISM = 'beehiiv_api_human_send';

export function routeToList(lang, edition, { lists = DEFAULT_LISTS } = {}) {
  if (edition?.lang !== lang) {
    throw new CrossPostFirewallError({ edition_lang: edition?.lang, surface_lang: lang, surface: 'beehiiv' });
  }
  const listId = lists[lang];
  if (!listId) throw new Error(`unknown beehiiv list for ${lang}`);
  return listId;
}

export function buildEditions(transcreation, options = {}) {
  const emitted = Array.isArray(transcreation?.emitted) ? transcreation.emitted : [];
  return emitted.map((edition) => {
    const listId = routeToList(edition.lang, edition, options);
    const utm = makeUtm(edition, listId, options);
    return toBeehiivDraft(edition, listId, utm, options);
  });
}

export function toBeehiivDraft(edition, listId, utm, { now = () => new Date().toISOString() } = {}) {
  validateEdition(edition);
  return {
    topic_id: edition.topic_id,
    lang: edition.lang,
    list_id: listId,
    market_angle: edition.market_angle,
    utm,
    source_edition_id: edition.source_edition_id ?? `${edition.topic_id}:${edition.lang}`,
    ts: now(),
    subject: edition.subject ?? `${edition.lang} ${edition.topic_id}`,
    body: `${edition.text}\n\nCTA:${edition.cta_kind}\n${edition.cta_target ?? ''}\n${utm}`,
    cta_kind: edition.cta_kind,
  };
}

export function buildWelcomeSequence(list, topic_id, { apexUrl, mintUtm = defaultMintUtm } = {}) {
  if (!list) throw new Error('list is required');
  if (!topic_id) throw new Error('topic_id is required');
  if (!apexUrl) throw new Error('apexUrl is required');
  const utm = mintUtm({ channel: 'beehiiv', thread: list, format: 'welcome', topic_id });
  return {
    subject: 'Welcome',
    body: `Welcome\n\n${attachUtm(apexUrl, utm)}`,
    cta_url: attachUtm(apexUrl, utm),
    utm,
  };
}

export async function prepareEditions(transcreation, { client, writeLedger = false, ...options } = {}) {
  if (!client || typeof client.createDraft !== 'function') throw new Error('beehiiv client required');
  assertBeehiivMechanism(options);
  const drafts = buildEditions(transcreation, options);
  const results = [];
  for (const draft of drafts) {
    const response = await client.createDraft(draft);
    const record = { ...draft, remote_id: response?.id };
    if (writeLedger) await appendDraftLedger(record, options);
    results.push(record);
  }
  return results;
}

function assertBeehiivMechanism(options = {}) {
  const registry = options.registry ?? { mechanismFor };
  const mechanism = registry.mechanismFor('beehiiv', options);
  if (mechanism !== BEEHIIV_MECHANISM) throw new Error(`unsupported mechanism for beehiiv: ${mechanism}`);
}

export async function relayWelcomeEmail({ email, sequence }, { cfEmail } = {}) {
  if (!email) throw new Error('email is required');
  if (!sequence) throw new Error('sequence is required');
  if (!cfEmail || typeof cfEmail.send !== 'function') throw new Error('cf-email client required');
  return cfEmail['send']({
    to: email,
    subject: sequence.subject,
    body: `${sequence.body}\n\n${sequence.cta_url}`,
  });
}

async function appendDraftLedger(record, { env = process.env, configPath } = {}) {
  const file = path.join(stateRoot(env, configPath), 'newsletter', 'drafts.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

function makeUtm(edition, listId, { mintUtm = defaultMintUtm } = {}) {
  return mintUtm({ channel: 'beehiiv', thread: listId, format: 'draft', topic_id: edition.topic_id });
}

function validateEdition(edition) {
  for (const key of ['topic_id', 'lang', 'market_angle', 'text', 'cta_kind']) {
    if (!edition?.[key]) throw new Error(`edition.${key} is required`);
  }
}

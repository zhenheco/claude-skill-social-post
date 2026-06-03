import { readIdea } from './idea-ledger.mjs';
import { originalityGate } from './gates/originality.mjs';
import { MARKET_ANGLES, resolveCtaTarget } from './market-angle-templates.mjs';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function editionText(template, idea) {
  return `${template.text_prefix} ${idea.normalized_text}`;
}

function buildEdition(lang, idea, options) {
  const template = MARKET_ANGLES[lang];
  return {
    topic_id: idea.topic_id,
    lang,
    market_angle: template.angle,
    angle: template.angle,
    cta_kind: template.cta_kind,
    cta_target: resolveCtaTarget(template.cta_target_ref, options),
    text: editionText(template, idea),
    originality: null,
    voice_version: options.voice_version,
  };
}

export async function transcreate(topic_id, options = {}) {
  const idea = await readIdea(topic_id, options);
  if (!idea) return deepFreeze({ emitted: [], blocked: [], error: 'unknown topic_id' });

  const emitted = [];
  const blocked = [];
  for (const lang of ['zh', 'en']) {
    const edition = buildEdition(lang, idea, options);
    const originality = originalityGate(
      { text: edition.text, pattern_origin: 'internal', internal_winner: true },
      options.corpora?.[lang] ?? [],
      options.sources ?? [],
    );
    const candidate = { ...edition, originality: { score: originality.score, blocked: originality.blocked } };
    if (originality.blocked) {
      blocked.push({ lang, reasons: originality.reasons });
      continue;
    }
    emitted.push(candidate);
  }

  return deepFreeze({ emitted, blocked });
}

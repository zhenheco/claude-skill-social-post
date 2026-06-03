export const MARKET_ANGLES = Object.freeze({
  zh: Object.freeze({
    angle: 'tw_smb_outcome_roi',
    cta_kind: 'line_join',
    cta_target_ref: 'apex.line_utm_joins',
    text_prefix: '台灣中小企業成效投報',
  }),
  en: Object.freeze({
    angle: 'technical_depth_build_in_public',
    cta_kind: 'newsletter_artifact',
    cta_target_ref: 'newsletter.artifact',
    text_prefix: 'technical depth build in public artifact',
  }),
});

export function resolveCtaTarget(ref, options = {}) {
  if (ref === 'apex.line_utm_joins') {
    const apexValue = typeof options.apex === 'function' ? options.apex() : options.apex;
    if (apexValue && typeof apexValue === 'object' && !Array.isArray(apexValue)) {
      return apexValue.line_utm_joins;
    }
    if (Array.isArray(apexValue) && apexValue.includes('line_utm_joins')) return 'line_utm_joins';
  }
  if (ref === 'newsletter.artifact') return options.newsletterArtifactTarget ?? 'newsletter_artifact';
  throw new Error(`unknown CTA target ref: ${ref}`);
}

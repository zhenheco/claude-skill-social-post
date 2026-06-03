import { ExcludedPlatformError, UnknownPlatformError, is_excluded, loadRegistry, normalizePlatform } from './registry.mjs';

export class CrossPostFirewallError extends Error {
  constructor({ edition_lang, surface_lang, surface }) {
    super(`edition language ${edition_lang} cannot route to ${surface_lang} surface ${surface}`);
    this.name = 'CrossPostFirewallError';
    this.edition_lang = edition_lang;
    this.surface_lang = surface_lang;
    this.surface = surface;
  }
}

function resolveSurface(surface, options = {}) {
  if (typeof surface === 'object' && surface) return surface;
  if (is_excluded(surface)) throw new ExcludedPlatformError(surface, 'crossPostFirewall');
  const entry = loadRegistry(options)[normalizePlatform(surface)];
  if (!entry) throw new UnknownPlatformError(surface);
  return entry;
}

export function assertSameStack(edition, surface, options = {}) {
  const target = resolveSurface(surface, options);
  const editionLang = edition?.lang;
  const surfaceLang = target.language_stack;
  if (!editionLang || !surfaceLang) throw new UnknownPlatformError(surface);
  if (editionLang !== surfaceLang && surfaceLang !== 'bilingual') {
    throw new CrossPostFirewallError({ edition_lang: editionLang, surface_lang: surfaceLang, surface });
  }
  return true;
}

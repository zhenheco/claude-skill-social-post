import { loadConfig } from './paths.mjs';

const ROW_VERDICTS = Object.freeze(['provisional', 'matured']);

function windowsFrom(config) {
  return config?.maturity_windows ?? config;
}

export function windowFor(platform, config) {
  const windows = windowsFrom(config);
  const window = windows?.[platform];
  if (!window) throw new Error(`unknown maturity window for platform ${platform}`);
  return Object.freeze({
    min_age_hours: window.min_age_hours,
    second_push_window_hours: Object.freeze([...(window.second_push_window_hours ?? [])]),
  });
}

export function maturity(args, windowsConfig, configPath) {
  if (ROW_VERDICTS.includes(args?.maturity) && args.age_hours == null) {
    return Object.freeze({ verdict: args.maturity, reason: `row-${args.maturity}` });
  }

  const config = windowsConfig ?? loadConfig(configPath);
  const window = windowFor(args.platform, config);
  const oldEnough = args.age_hours >= window.min_age_hours;
  const secondPushDone = args.second_push_done === true;
  const verdict = oldEnough && secondPushDone ? 'matured' : 'provisional';
  const reason = verdict === 'matured'
    ? 'platform-window-and-second-push-complete'
    : 'waiting-for-platform-window-or-second-push';

  return Object.freeze({
    verdict,
    reason,
    platform: args.platform,
    min_age_hours: window.min_age_hours,
    second_push_window_hours: window.second_push_window_hours,
  });
}

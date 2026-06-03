import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function gateBin(env = process.env) {
  return env.VALIDATE_SOCIAL_POST_BIN ?? path.join(
    os.homedir(),
    '.claude/skills/content-flywheel/scripts/validate-social-post.sh',
  );
}

function verdictFrom(parsed) {
  if (parsed.status === 'pass' || parsed.pass === true) {
    return { pass: true, reasons: [], raw: parsed };
  }
  const reasons = parsed.reasons ?? [parsed.error ?? 'format gate rejected'];
  return { pass: false, reasons, raw: parsed };
}

export async function check(platform, postPath, { env = process.env } = {}) {
  const result = spawnSync(gateBin(env), [platform, postPath], { encoding: 'utf8' });
  if (result.error) {
    return { pass: false, reasons: [`format-gate-error: ${result.error.message}`], raw: null };
  }
  try {
    return verdictFrom(JSON.parse(result.stdout));
  } catch (error) {
    const detail = result.stderr?.trim() || error.message;
    return { pass: false, reasons: [`format-gate-error: ${detail}`], raw: result.stdout };
  }
}

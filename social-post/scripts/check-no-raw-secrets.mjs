import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RAW_TOKEN_PATTERNS } from '../lib/secret.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(scriptDir, '..');

function patternId(pattern) {
  return pattern.patternId ?? pattern.id;
}

function scanRawTokens(file) {
  const findings = [];
  const content = String(file.content ?? '');
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of RAW_TOKEN_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        findings.push({ path: file.path, line: index + 1, patternId: patternId(pattern) });
        break;
      }
    }
  }
  return findings;
}

function opInvocationPatterns() {
  const command = ['o', 'p'].join('');
  return [
    new RegExp(`\\bspawn(?:Sync)?\\s*\\(\\s*['"]${command}['"]`, 'u'),
    new RegExp(`\\bexec(?:File|FileSync|Sync)?\\s*\\(\\s*['"]${command}['"]`, 'u'),
    new RegExp(`\\[\\s*['"]${command}['"]\\s*,\\s*['"]read['"]`, 'u'),
  ];
}

function credentialEnvPattern() {
  const env = ['e', 'n', 'v'].join('');
  const names = [
    'API[_-]?KEY',
    'TOKEN',
    'SECRET',
    'CREDENTIAL',
    'PRIVATE[_-]?KEY',
  ].join('|');
  return new RegExp(`\\bprocess\\s*\\.\\s*${env}\\s*(?:\\.\\s*|\\[\\s*['"])[A-Z0-9_]*(?:${names})[A-Z0-9_]*`, 'iu');
}

function boundaryFindings(file) {
  if (file.path === 'lib/secret.mjs') return [];
  const findings = [];
  const lines = String(file.content ?? '').split(/\r?\n/);
  const patterns = [
    ...opInvocationPatterns().map((regex) => ({ patternId: 'direct-op-invocation', regex })),
    { patternId: 'credential-env-reference', regex: credentialEnvPattern() },
  ];
  for (let index = 0; index < lines.length; index += 1) {
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(lines[index])) {
        findings.push({ path: file.path, line: index + 1, patternId: pattern.patternId });
        break;
      }
    }
  }
  return findings;
}

function contentFor(file, readFile) {
  if (!readFile) return readFileSync(join(skillRoot, file), 'utf8');
  const content = readFile(file);
  if (typeof content === 'string') return content;
  return readFileSync(join(skillRoot, file), 'utf8');
}

function materializeFiles({ files, listFiles, readFile }) {
  if (files) return files.map((file) => ({ path: file.path, content: file.content }));
  if (!listFiles) return [];
  return listFiles().map((file) => ({ path: file, content: contentFor(file, readFile) }));
}

export function checkNoRawSecrets({ files, listFiles, readFile, boundaryOnly = false } = {}) {
  const inputs = materializeFiles({ files, listFiles, readFile });
  const findings = inputs.flatMap((file) => (boundaryOnly ? boundaryFindings(file) : scanRawTokens(file)));
  return { ok: findings.length === 0, findings };
}

export function main(argv = process.argv.slice(2)) {
  const files = argv.map((file) => ({ path: file, content: readFileSync(file, 'utf8') }));
  const result = checkNoRawSecrets({ files });
  if (!result.ok) process.stderr.write(`${JSON.stringify(result.findings)}\n`);
  return result.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main();

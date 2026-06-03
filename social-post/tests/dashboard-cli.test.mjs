import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function waitForStdoutLine(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for dashboard URL; stdout=${output}`));
    }, 5000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline !== -1) {
        clearTimeout(timeout);
        resolve(output.slice(0, newline));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`dashboard exited before URL; code=${code} signal=${signal}`));
    });
  });
}

async function waitForFile(pathname) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      return await readFile(pathname, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`timed out waiting for ${pathname}`);
}

async function withFakeOpen(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'social-dashboard-cli-'));
  const bin = path.join(root, 'bin');
  const logPath = path.join(root, 'open.log');
  const openPath = path.join(bin, 'open');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
  await writeFile(openPath, `#!/bin/sh\nprintf '%s\\n' "$1" >> "$OPEN_LOG"\n`, 'utf8');
  await chmod(openPath, 0o755);
  try {
    return await fn({
      env: {
        ...process.env,
        OPEN_LOG: logPath,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      },
      logPath,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function spawnDashboard(args, env) {
  return spawn('node', ['scripts/dashboard.mjs', '--port=0', ...args], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function stopDashboard(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
}

test('T1 --open launches the printed dashboard URL on macOS', { skip: process.platform !== 'darwin' }, async () => {
  await withFakeOpen(async ({ env, logPath }) => {
    const child = spawnDashboard(['--open'], env);
    try {
      const line = await waitForStdoutLine(child);
      assert.match(line, /^social dashboard: http:\/\/127\.0\.0\.1:\d+$/);

      const url = line.slice('social dashboard: '.length);
      assert.equal((await waitForFile(logPath)).trim(), url);
      assert.equal(child.exitCode, null);
    } finally {
      await stopDashboard(child);
    }
  });
});

test('T2 launcher without --open only prints the dashboard URL', async () => {
  await withFakeOpen(async ({ env, logPath }) => {
    const child = spawnDashboard([], env);
    try {
      const line = await waitForStdoutLine(child);
      assert.match(line, /^social dashboard: http:\/\/127\.0\.0\.1:\d+$/);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await assert.rejects(readFile(logPath, 'utf8'), { code: 'ENOENT' });
      assert.equal(child.exitCode, null);
    } finally {
      await stopDashboard(child);
    }
  });
});

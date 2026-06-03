#!/usr/bin/env node
import { spawn } from 'node:child_process';

import { startDashboardServer } from '../lib/dashboard-server.mjs';

const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = portArg ? Number(portArg.slice('--port='.length)) : undefined;
const { url } = await startDashboardServer({ port });

process.stdout.write(`social dashboard: ${url}\n`);

if (process.argv.includes('--open') && process.platform === 'darwin') {
  try {
    const opener = spawn('open', [url], { stdio: 'ignore', detached: true });
    opener.on('error', () => {});
    opener.unref();
  } catch {}
}

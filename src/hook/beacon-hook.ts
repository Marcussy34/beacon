#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '../domain/types';
import { buildRawEvent } from './build-event';
import { parseTty, parsePsRows, findAncestorByComm } from './proc';

// Socket path the Electron main process (M3) will host the collector on.
const SOCKET_PATH = join(homedir(), 'Library', 'Application Support', 'Beacon', 'beacon.sock');

function readStdin(): unknown {
  try {
    const text = readFileSync(0, 'utf8'); // fd 0 = stdin (hook pipes JSON, then EOF)
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function main(): void {
  // argv: [node, beacon-hook, (--beacon-marker <id>)?, <tool>, <event>]
  const args = process.argv.slice(2).filter((a, i, arr) => {
    if (a === '--beacon-marker') return false;
    if (arr[i - 1] === '--beacon-marker') return false;
    return true;
  });
  const tool = args[0] as Tool;
  const event = args[1];
  if (!tool || !event) process.exit(0);

  const cwd = process.cwd();
  const gitRoot = safe(
    () => execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined,
    undefined,
  );
  const tty = safe(
    () => parseTty(execFileSync('ps', ['-o', 'tty=', '-p', String(process.ppid)], { encoding: 'utf8' })),
    undefined,
  );

  let codexAncestorPid: number | undefined;
  let codexAncestorStartTime: string | undefined;
  if (tool === 'codex') {
    const rows = safe(
      () => parsePsRows(execFileSync('ps', ['-Ao', 'pid=,ppid=,lstart=,comm='], { encoding: 'utf8' })),
      [],
    );
    const anc = findAncestorByComm(rows, process.ppid, 'codex');
    if (anc) { codexAncestorPid = anc.pid; codexAncestorStartTime = anc.lstart; }
  }

  const raw = buildRawEvent({
    tool, event, env: process.env, stdin: readStdin(),
    cwd, gitRoot, tty, codexAncestorPid, codexAncestorStartTime, ts: Date.now(),
  });

  // Fire-and-forget: never block the CLI. Always exit 0.
  const sock = connect(SOCKET_PATH);
  let exited = false;
  const done = () => {
    if (exited) return;
    exited = true;
    process.exit(0);
  };
  sock.on('error', done);
  sock.setTimeout(300, () => { sock.destroy(); done(); });
  sock.on('connect', () => { sock.write(JSON.stringify(raw) + '\n', () => { sock.end(); }); });
  sock.on('close', done);
}

main();

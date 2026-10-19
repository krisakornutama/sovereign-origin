import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForHttp(url, timeoutMs, label = 'service') {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(700);
  }
  throw new Error(`${label} did not become healthy within ${Math.round(timeoutMs / 1000)}s: ${lastError?.message || 'timeout'}`);
}

export function startDetached(exe, args, env, cwd, logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(exe, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd]
  });
  child.unref();
  try {
    fs.closeSync(fd);
  } catch {
    // Best effort; the child has its own descriptor.
  }
  return child.pid;
}

export function writePid(pidFile, pid) {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${pid}\n`, 'utf8');
}

export function readPid(pidFile) {
  try {
    const value = Number(fs.readFileSync(pidFile, 'utf8').trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function isPidRunning(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    });
    return result.status === 0 && new RegExp(`\\b${pid}\\b`).test(String(result.stdout || ''));
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopPid(pid, label = 'process') {
  if (!pid || !isPidRunning(pid)) return false;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15000 });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return false;
    }
    for (let i = 0; i < 30; i += 1) {
      if (!isPidRunning(pid)) return true;
      await sleep(200);
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  for (let i = 0; i < 20; i += 1) {
    if (!isPidRunning(pid)) return true;
    await sleep(200);
  }
  throw new Error(`Could not stop ${label} (pid ${pid})`);
}

export function tail(file, lines = 20) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

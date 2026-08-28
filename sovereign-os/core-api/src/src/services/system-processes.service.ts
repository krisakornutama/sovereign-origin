// src/services/system-processes.service.ts
//
// Lists running processes for the System Health page so a user can pick a
// pid to kill. The kill itself is NOT executed here — it goes through
// agentActions (guards + autonomy level), the same as the AI agent.
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ProcessInfo {
  pid: number;
  name: string;
  mem?: string;
}

// tasklist /FO CSV /NH → "chrome.exe","1234","Console","1","345,678 K"
export function parseTasklistOutput(raw: string): ProcessInfo[] {
  const result: ProcessInfo[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fields = trimmed.slice(1, -1).split('","'); // strip outer quotes, split on quote-comma
    if (fields.length < 2) continue;
    const pid = Number(fields[1]);
    const name = fields[0];
    if (!Number.isInteger(pid) || pid <= 0 || !name) continue;
    result.push({ pid, name, mem: fields[4] });
  }
  return result;
}

// ps -eo pid=,comm= → "  1234 chrome"
export function parsePsOutput(raw: string): ProcessInfo[] {
  const result: ProcessInfo[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[0]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    result.push({ pid, name: parts.slice(1).join(' ') });
  }
  return result;
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 15000 });
    return parseTasklistOutput(stdout).sort((a, b) => a.pid - b.pid);
  }
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,comm='], { timeout: 15000 });
  return parsePsOutput(stdout).sort((a, b) => a.pid - b.pid);
}

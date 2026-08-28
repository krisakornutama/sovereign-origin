// src/services/agent-workspace.service.ts
//
// Coding Agent Workspace — ตำแหน่งโปรเจ็ก + สิทธิ์จัดการไฟล์ + เทอร์มินัล
// กัน path traversal, กัน .env, กันคำสั่งอันตราย
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_PROJECT_PATH = process.env.CODING_PROJECT_PATH || 'E:/My work/Project Sovereign Origin';
const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'agent-workspace-settings.json');

export interface WorkspaceSettings {
  projectPath: string;
}

function loadSettings(): WorkspaceSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (raw && typeof raw.projectPath === 'string' && raw.projectPath.trim()) {
        return { projectPath: raw.projectPath.trim() };
      }
    }
  } catch {
    /* ignore corrupted settings */
  }
  return { projectPath: DEFAULT_PROJECT_PATH };
}

export function getProjectPath(): string {
  return loadSettings().projectPath;
}

export function saveSettings(settings: WorkspaceSettings): WorkspaceSettings {
  const projectPath = String(settings?.projectPath || '').trim();
  if (!projectPath) throw new Error('projectPath is required');
  if (!fs.existsSync(projectPath)) throw new Error(`❌ path ไม่มีอยู่บนเครื่อง: ${projectPath}`);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ projectPath }, null, 2), 'utf8');
  return { projectPath };
}

/** resolve path ให้อยู่ใต้ project root เสมอ — กัน path traversal + กัน .env */
export function safeResolve(relOrAbs: string): string {
  const root = path.resolve(getProjectPath());
  const target = path.resolve(root, String(relOrAbs || '.'));
  const normRoot = root.toLowerCase();
  const normTarget = target.toLowerCase();
  if (normTarget !== normRoot && !normTarget.startsWith(normRoot + path.sep)) {
    throw new Error(`❌ path อยู่นอกโปรเจ็กที่อนุญาต: ${target}`);
  }
  if (/\.env$/i.test(target)) throw new Error('❌ ห้ามอ่าน/แก้ไฟล์ .env');
  return target;
}

export interface FileEntry {
  name: string;
  path: string; // relative กับ project root
  type: 'file' | 'dir';
  size: number;
  mtime: string;
}

/** เปิดดูรายการไฟล์/โฟลเดอร์ในโปรเจ็ก (ไม่รวม node_modules/.git/dist) */
export function listFiles(relPath = ''): FileEntry[] {
  const dir = safeResolve(relPath);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`❌ ไม่ใช่โฟลเดอร์: ${dir}`);
  const root = path.resolve(getProjectPath());
  const entries: FileEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', '.next', '.venv'].includes(name)) continue;
    const abs = path.join(dir, name);
    const stat = fs.statSync(abs);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    entries.push({
      name,
      path: rel,
      type: stat.isDirectory() ? 'dir' : 'file',
      size: stat.isDirectory() ? 0 : stat.size,
      mtime: stat.mtime.toISOString(),
    });
  }
  return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

/** อ่านเนื้อหาไฟล์ (กันไฟล์ใหญ่เกิน + กัน binary) */
export function readProjectFile(relPath: string): { content: string; truncated: boolean } {
  const target = safeResolve(relPath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`❌ ไม่ใช่ไฟล์: ${relPath}`);
  const stat = fs.statSync(target);
  const MAX_BYTES = 300000;
  if (stat.size > MAX_BYTES) {
    const buf = fs.readFileSync(target);
    return { content: buf.subarray(0, MAX_BYTES).toString('utf8') + '\n… (ไฟล์ใหญ่ ตัดที่ 300KB)', truncated: true };
  }
  const buf = fs.readFileSync(target);
  if (buf.includes(0)) return { content: '(ไฟล์ binary — preview ไม่ได้)', truncated: true };
  return { content: buf.toString('utf8'), truncated: false };
}

const DANGEROUS_PATTERNS = [
  /\.env/i,
  /rm\s+-rf\s+\//,
  /format\s+[a-z]:/i,
  /shutdown/i,
  /del\s+\/s/i,
  /rd\s+\/s/i,
  /net\s+user/i,
  /reg\s+(add|delete|update)/i,
  /taskkill\s+\/f\s*\/im\s+(explorer|winlogon|csrss|lsass|svchost)/i,
  /:\(\)\s*\{/,
];

export interface TerminalResult {
  ok: boolean;
  output: string;
  cwd: string;
  timedOut?: boolean;
}

/** รันคำสั่งในเครื่อง (cwd = โปรเจ็ก) — กันคำสั่งอันตราย, timeout 60s */
export async function runTerminal(command: string): Promise<TerminalResult> {
  const cmd = String(command || '').trim();
  if (!cmd) throw new Error('command is required');
  if (DANGEROUS_PATTERNS.some((p) => p.test(cmd))) {
    throw new Error('❌ คำสั่งนี้ถูกบล็อกโดยระบบ (กันคำสั่งอันตราย)');
  }
  const cwd = path.resolve(getProjectPath());
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
  const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', cmd] : ['-c', cmd];
  try {
    const { stdout, stderr } = await execFileAsync(shell, args, { cwd, timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return { ok: true, output: output || '(ไม่มี output)', cwd };
  } catch (err: any) {
    if (err?.killed && err?.signal === 'SIGTERM') {
      return { ok: false, output: '⏱️ timeout 60 วินาที — คำสั่งถูกตัด', cwd, timedOut: true };
    }
    const stderr = String(err?.stderr || '').trim();
    const stdout = String(err?.stdout || '').trim();
    return { ok: false, output: [stdout, stderr].filter(Boolean).join('\n').trim() || String(err?.message || 'คำสั่งล้มเหลว'), cwd };
  }
}
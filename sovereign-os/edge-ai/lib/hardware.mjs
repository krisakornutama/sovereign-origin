import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function run(command, args, options = {}) {
  try {
    const out = execFileSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
      ...options
    });
    return String(out || '').trim();
  } catch {
    return '';
  }
}

function numberFrom(value, fallback = 0) {
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export function physicalCores(platform = process.platform) {
  if (platform === 'win32') {
    const out = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum | Select-Object -ExpandProperty Sum'
    ]);
    const n = Math.round(numberFrom(out, 0));
    if (n > 0) return n;
  } else if (platform === 'darwin') {
    const n = Math.round(numberFrom(run('sysctl', ['-n', 'hw.physicalcpu']), 0));
    if (n > 0) return n;
  } else if (platform === 'linux') {
    const out = run('sh', ['-c', "lscpu -p=Core,Socket 2>/dev/null | grep -v '^#' | sort -u | wc -l"]);
    const n = Math.round(numberFrom(out, 0));
    if (n > 0) return n;
  }
  const logical = os.cpus().length || 1;
  return Math.max(1, Math.floor(logical / 2));
}

function classifyGpu(name, adapterRamBytes) {
  const text = String(name || '').trim();
  const lower = text.toLowerCase();
  const explicitDiscrete = /(nvidia|geforce|rtx|gtx|quadro|tesla|radeon\s+rx|radeon\s+pro|pro\s+w|firepro|intel\s+arc|arc\s+[ab]\d)/i.test(text);
  const integrated = /(radeon.*graphics|radeon\s*\(tm\)|vega.*graphics|intel.*(uhd|hd|iris)|apple\s+m\d|qualcomm|adreno|microsoft basic)/i.test(lower) && !explicitDiscrete;
  const vramRaw = Number(adapterRamBytes) || 0;
  const vramGB = vramRaw > 0 ? Math.round((vramRaw / 1024 ** 3) * 10) / 10 : null;
  return {
    name: text || 'unknown',
    vramGB,
    discrete: explicitDiscrete && !integrated,
    integrated,
    sharedMemory: integrated
  };
}

export function detectGpus(platform = process.platform) {
  const gpus = [];
  if (platform === 'win32') {
    const out = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'
    ]);
    if (out) {
      try {
        const parsed = JSON.parse(out);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        for (const row of rows) {
          if (!row?.Name) continue;
          gpus.push(classifyGpu(row.Name, row.AdapterRAM));
        }
      } catch {
        // Ignore malformed GPU output; CPU inference remains available.
      }
    }
  } else if (platform === 'darwin') {
    const out = run('system_profiler', ['SPDisplaysDataType', '-detailLevel', 'mini']);
    const name = out.match(/Chipset Model:\s*(.+)/)?.[1] || 'Apple GPU';
    gpus.push({
      name,
      vramGB: null,
      discrete: false,
      integrated: true,
      sharedMemory: true
    });
  } else if (platform === 'linux') {
    const nvidia = run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
    if (nvidia) {
      for (const line of nvidia.split(/\r?\n/)) {
        const [name, memory] = line.split(',').map((s) => s.trim());
        if (!name) continue;
        const gb = numberFrom(memory, 0) / 1024;
        gpus.push({
          name,
          vramGB: gb > 0 ? Math.round(gb * 10) / 10 : null,
          discrete: true,
          integrated: false,
          sharedMemory: false
        });
      }
    }
    if (!gpus.length) {
      const pci = run('sh', ['-c', "lspci 2>/dev/null | grep -Ei 'vga|3d|display' | head -n 4"]);
      for (const line of pci.split(/\r?\n/).filter(Boolean)) {
        const name = line.replace(/^[0-9a-f:.]+\s+/i, '').trim();
        gpus.push(classifyGpu(name, 0));
      }
    }
  }
  return gpus;
}

export function diskFreeGB(root = process.cwd()) {
  try {
    const s = fs.statfsSync(root);
    return Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 ** 3 * 10) / 10;
  } catch {
    return null;
  }
}

export function recommendProfile(hardware) {
  const bestDiscrete = Math.max(0, ...(hardware.gpu || []).filter((g) => g.discrete).map((g) => Number(g.vramGB) || 0));
  const ram = Number(hardware.ramGB) || 0;
  // os.totalmem() reports usable RAM, not the sticker size. A 16 GB laptop often
  // reports 13.5-15.5 GB because the iGPU reserves shared memory. Treat >= 12 GB
  // as the 16 GB class, and >= 28 GB as the 32 GB class.
  if (bestDiscrete >= 7 && ram >= 12) return 'gpu';
  if (ram >= 28) return 'standard';
  if (ram >= 12) return 'mini';
  return 'nano';
}

export function detectHardware({ root = process.cwd(), platform = process.platform } = {}) {
  const cpus = os.cpus();
  const logicalCores = cpus.length || 1;
  const physical = physicalCores(platform);
  const totalRam = os.totalmem() / 1024 ** 3;
  const freeRam = os.freemem() / 1024 ** 3;
  const gpu = detectGpus(platform);
  const hardware = {
    platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model?.trim() || 'unknown',
    physicalCores: physical,
    logicalCores,
    ramGB: Math.round(totalRam * 10) / 10,
    freeRamGB: Math.round(freeRam * 10) / 10,
    freeDiskGB: diskFreeGB(root),
    gpu,
    detectedAt: new Date().toISOString()
  };
  hardware.recommendedProfile = recommendProfile(hardware);
  hardware.notes = [];
  if (gpu.some((g) => g.integrated)) {
    hardware.notes.push('Integrated GPU shares system RAM; this pack defaults to CPU inference for stable multi-user latency.');
  }
  if (hardware.freeDiskGB !== null && hardware.freeDiskGB < 12) {
    hardware.notes.push('Less than 12 GB free on the project drive; models may not fit.');
  }
  if (hardware.ramGB < 8) {
    hardware.notes.push('Less than 8 GB RAM; expect only the smallest models and one request at a time.');
  }
  return hardware;
}

export function hardwareSummary(hardware) {
  const lines = [
    `CPU: ${hardware.cpuModel}`,
    `Cores: ${hardware.physicalCores} physical / ${hardware.logicalCores} logical`,
    `RAM: ${hardware.ramGB} GB (${hardware.freeRamGB} GB free)`,
    `Disk free (project drive): ${hardware.freeDiskGB === null ? 'unknown' : `${hardware.freeDiskGB} GB`}`,
    `GPU: ${(hardware.gpu || []).length ? hardware.gpu.map((g) => `${g.name}${g.vramGB ? ` (${g.vramGB} GB${g.integrated ? ' shared' : ''})` : ''}`).join('; ') : 'none detected'}`,
    `Recommended profile: ${hardware.recommendedProfile}`
  ];
  for (const note of hardware.notes || []) lines.push(`Note: ${note}`);
  return lines.join('\n');
}

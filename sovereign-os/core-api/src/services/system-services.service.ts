// Real service probes for the /system page.
//
// The page used to render a hard-coded list with "● Running" for every service,
// which hid outages. These probes answer with evidence: DB query, MQTT TCP
// connect, Ollama HTTP reachability — each bounded by a short timeout so the
// polling UI stays responsive.
import net from 'node:net';
import { prisma } from '../lib/prisma';
import { config } from '../config';

export type ServiceStatus = 'up' | 'down' | 'unknown';

export interface ServiceProbe {
  id: string;
  label: string;
  status: ServiceStatus;
  detail?: string;
  latencyMs?: number;
}

export interface ProbeDeps {
  checkDatabase: () => Promise<void>;
  checkTcp: (host: string, port: number) => Promise<void>;
  checkHttp: (url: string) => Promise<number>;
  timeoutMs: number;
}

function tcpProbe(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(1500, () => finish(new Error('timeout')));
    socket.once('connect', () => finish());
    socket.once('error', (err) => finish(err));
  });
}

async function httpProbe(url: string): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

export function defaultProbeDeps(): ProbeDeps {
  return {
    checkDatabase: async () => {
      await prisma.$queryRawUnsafe('SELECT 1');
    },
    checkTcp: tcpProbe,
    checkHttp: httpProbe,
    timeoutMs: 2500,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function errorDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err || 'unknown');
  return message.split('\n')[0].slice(0, 120);
}

/**
 * Probe the three infrastructure services the owner expects to see.
 * Each check is independent: one failure never hides the others.
 */
export async function probeSystemServices(
  overrides: Partial<ProbeDeps> = {}
): Promise<{ checkedAt: string; services: ServiceProbe[] }> {
  const deps: ProbeDeps = { ...defaultProbeDeps(), ...overrides };

  const checks: Array<{ id: string; label: string; run: () => Promise<void> }> = [
    {
      id: 'database',
      label: 'PostgreSQL / TimeScaleDB',
      run: async () => {
        await deps.checkDatabase();
      },
    },
    {
      id: 'mqtt',
      label: 'EMQX (MQTT)',
      run: async () => {
        await deps.checkTcp(config.mqtt.host, config.mqtt.port);
      },
    },
    {
      id: 'ai',
      label: 'Ollama (AI)',
      run: async () => {
        const code = await deps.checkHttp(`${config.ollama.url}/api/tags`);
        if (code >= 500) throw new Error(`HTTP ${code}`);
      },
    },
  ];

  const services = await Promise.all(
    checks.map(async (check): Promise<ServiceProbe> => {
      const started = Date.now();
      try {
        await withTimeout(check.run(), deps.timeoutMs, check.id);
        return { id: check.id, label: check.label, status: 'up', latencyMs: Date.now() - started };
      } catch (err) {
        return {
          id: check.id,
          label: check.label,
          status: 'down',
          detail: errorDetail(err),
          latencyMs: Date.now() - started,
        };
      }
    })
  );

  return { checkedAt: new Date().toISOString(), services };
}

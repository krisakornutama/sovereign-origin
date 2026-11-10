// Outbound URL guard for user-supplied URLs the server fetches itself.
//
// Used by POST /api/vision/analyze-url (camera snapshots). A self-hosted home OS
// legitimately reaches LAN cameras, so RFC1918 (IPv4) and IPv6 ULA stay allowed.
// Blocked: loopback, unspecified, link-local (169.254/16 + fe80::/10, which
// includes cloud metadata), CGNAT/metadata ranges, credential-bearing URLs,
// non-http(s) schemes, and hostnames that *resolve* to a blocked address
// (DNS-rebinding guard used as the socket `lookup`).
import dns from 'node:dns';
import net from 'node:net';

export class OutboundUrlBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundUrlBlocked';
  }
}

// Hostnames that never point at a camera, only at infrastructure/metadata.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'metadata.azure.internal',
]);

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT incl. 100.100.100.200 metadata
  return false;
}

/** True when an IP literal must never be fetched by the server. */
export function isBlockedOutboundAddress(raw: string): boolean {
  const addr = String(raw || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!addr) return true;
  if (addr === '::' || addr === '::1') return true;
  // IPv4-mapped IPv6 — check the embedded IPv4 (::ffff:127.0.0.1)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (net.isIPv4(addr)) return isBlockedIpv4(addr);
  if (net.isIPv6(addr)) {
    if (/^fe[89ab][0-9a-f]:/.test(addr)) return true; // link-local fe80::/10
    return false; // ULA (fc00::/7) = LAN camera, allowed by intent
  }
  return true; // not an IP literal — callers must not pass hostnames here
}

/**
 * Validate a user-supplied URL before the server fetches it.
 * Throws OutboundUrlBlocked with a user-safe reason.
 */
export function assertSafeOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new OutboundUrlBlocked('invalid url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OutboundUrlBlocked('url must be http(s)');
  }
  if (url.username || url.password) {
    throw new OutboundUrlBlocked('url must not contain credentials');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) throw new OutboundUrlBlocked('url must include a host');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    throw new OutboundUrlBlocked('url host is not allowed');
  }
  if (net.isIP(host) && isBlockedOutboundAddress(host)) {
    throw new OutboundUrlBlocked('url points to a blocked address');
  }
  return url;
}

/**
 * Node `lookup` wrapper for http(s).request: rejects hostnames that resolve to a
 * blocked address, so a public-looking name cannot bounce back to loopback.
 */
export function createGuardedLookup(lookupFn: any = dns.lookup): any {
  return (hostname: string, options: any, callback: any) => {
    lookupFn(hostname, options, (err: any, address: any, family?: number) => {
      if (err) return callback(err);
      const list: Array<{ address: string }> = Array.isArray(address)
        ? address
        : [{ address: String(address) }];
      const blocked = list.find((entry) => isBlockedOutboundAddress(entry.address));
      if (blocked) {
        const blockedErr: any = new OutboundUrlBlocked(
          `outbound target resolved to a blocked address (${blocked.address})`
        );
        blockedErr.code = 'EBLOCKEDADDRESS';
        return callback(blockedErr);
      }
      return callback(null, address, family);
    });
  };
}

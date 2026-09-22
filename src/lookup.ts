import { TLD_TO_RDAP, TLD_TO_WHOIS } from "./servers";

// KV key prefix for IANA bootstrap override entries
const BOOTSTRAP_PREFIX = "bootstrap:";

// lookupWhoisServer returns the WHOIS server for a TLD, checking KV bootstrap
// override first, then falling back to compiled-in map.
export async function lookupWhoisServer(
  tld: string,
  kv: KVNamespace
): Promise<string | null> {
  const override = await kv.get(`${BOOTSTRAP_PREFIX}whois:${tld}`, "text");
  if (override) return override;
  return TLD_TO_WHOIS[tld] ?? null;
}

// lookupRdapServer returns the RDAP base URL for a TLD/key, checking KV
// bootstrap override first, then the compiled-in map.
export async function lookupRdapServer(
  key: string,
  kv: KVNamespace
): Promise<string | null> {
  const override = await kv.get(`${BOOTSTRAP_PREFIX}rdap:${key}`, "text");
  if (override) return override;
  return TLD_TO_RDAP[key] ?? null;
}

// lookupRdapServerSync does a synchronous lookup in the compiled map only (used
// in bootstrap.ts before KV is updated).
export function lookupRdapServerSync(key: string): string | null {
  return TLD_TO_RDAP[key] ?? null;
}

// lookupIPRdapServer finds the RDAP server for an IP address by scanning the
// compiled CIDR table. For production traffic the KV bootstrap override (keyed
// by CIDR) is authoritative; this compiled fallback is used when KV is empty.
export async function lookupIPRdapServer(
  ip: string,
  kv: KVNamespace
): Promise<string | null> {
  // Try KV bootstrap first: keys stored as "bootstrap:rdap:<cidr>"
  // For simplicity, scan compiled map for best-matching prefix
  return findCIDRServer(ip, kv);
}

// lookupASNRdapServer finds the RDAP server for an ASN number.
export async function lookupASNRdapServer(
  asn: number,
  kv: KVNamespace
): Promise<string | null> {
  return findASNServer(asn, kv);
}

// findCIDRServer iterates the compiled TLD_TO_RDAP map for CIDR keys and
// returns the server for the longest-prefix match.
async function findCIDRServer(
  ip: string,
  kv: KVNamespace
): Promise<string | null> {
  // Check KV bootstrap list first
  const kvKey = `${BOOTSTRAP_PREFIX}ip:${ip}`;
  const kvResult = await kv.get(kvKey, "text");
  if (kvResult) return kvResult;

  const isV4 = ip.includes(".") && !ip.includes(":");
  const ipBytes = isV4 ? parseIPv4(ip) : parseIPv6(ip);
  if (!ipBytes) return null;

  let best: string | null = null;
  let bestLen = -1;

  for (const [key, url] of Object.entries(TLD_TO_RDAP)) {
    if (!key.includes("/")) continue;
    const slash = key.lastIndexOf("/");
    const cidrHost = key.slice(0, slash);
    const cidrLen = parseInt(key.slice(slash + 1), 10);

    const cidrIsV4 = cidrHost.includes(".") && !cidrHost.includes(":");
    if (cidrIsV4 !== isV4) continue;

    const netBytes = isV4 ? parseIPv4(cidrHost) : parseIPv6(cidrHost);
    if (!netBytes) continue;
    if (netBytes.length !== ipBytes.length) continue;

    if (ipInCIDR(ipBytes, netBytes, cidrLen) && cidrLen > bestLen) {
      best = url;
      bestLen = cidrLen;
    }
  }
  return best;
}

async function findASNServer(
  asn: number,
  kv: KVNamespace
): Promise<string | null> {
  // Check KV bootstrap
  const kvKey = `${BOOTSTRAP_PREFIX}asn:${asn}`;
  const kvResult = await kv.get(kvKey, "text");
  if (kvResult) return kvResult;

  for (const [key, url] of Object.entries(TLD_TO_RDAP)) {
    if (!key.includes("-")) continue;
    const dash = key.indexOf("-");
    const lo = parseInt(key.slice(0, dash), 10);
    const hi = parseInt(key.slice(dash + 1), 10);
    if (!isNaN(lo) && !isNaN(hi) && asn >= lo && asn <= hi) {
      return url;
    }
  }
  return null;
}

function parseIPv4(s: string): Uint8Array | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const arr = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = parseInt(parts[i], 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    arr[i] = n;
  }
  return arr;
}

function parseIPv6(s: string): Uint8Array | null {
  // Expand :: shorthand then parse 8 groups of 16-bit hex
  const parts = expandIPv6(s);
  if (!parts || parts.length !== 8) return null;
  const arr = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const n = parseInt(parts[i], 16);
    if (isNaN(n)) return null;
    arr[i * 2] = (n >> 8) & 0xff;
    arr[i * 2 + 1] = n & 0xff;
  }
  return arr;
}

function expandIPv6(s: string): string[] | null {
  const halves = s.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const parts = s.split(":");
    return parts.length === 8 ? parts : null;
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  return [...left, ...Array(fill).fill("0"), ...right];
}

function ipInCIDR(ip: Uint8Array, net: Uint8Array, prefixLen: number): boolean {
  const fullBytes = Math.floor(prefixLen / 8);
  const remBits = prefixLen % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (ip[i] !== net[i]) return false;
  }
  if (remBits > 0) {
    const mask = 0xff & (0xff << (8 - remBits));
    if ((ip[fullBytes] & mask) !== (net[fullBytes] & mask)) return false;
  }
  return true;
}

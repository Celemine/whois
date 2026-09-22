import { TLD_TO_RDAP, TLD_TO_WHOIS } from "./servers";
import { RDAP_IP, RDAP_ASN } from "./rdap-bootstrap";

// lookupWhoisServer returns the WHOIS server for a TLD.
export function lookupWhoisServer(tld: string): string | null {
  return TLD_TO_WHOIS[tld] ?? null;
}

// lookupRdapServer returns the RDAP base URL for a TLD.
export function lookupRdapServer(tld: string): string | null {
  return TLD_TO_RDAP[tld] ?? null;
}

interface CIDREntry {
  net: Uint8Array;
  prefixLen: number;
  url: string;
}

// Parsed once per isolate, longest prefix first so the first match wins.
const CIDR_TABLE: CIDREntry[] = RDAP_IP.flatMap(([cidr, url]) => {
  const slash = cidr.lastIndexOf("/");
  const host = cidr.slice(0, slash);
  const net = host.includes(":") ? parseIPv6(host) : parseIPv4(host);
  const prefixLen = parseInt(cidr.slice(slash + 1), 10);
  return net && !isNaN(prefixLen) ? [{ net, prefixLen, url }] : [];
}).sort((a, b) => b.prefixLen - a.prefixLen);

// lookupIPRdapServer returns the RDAP server for the longest-prefix CIDR
// block containing ip.
export function lookupIPRdapServer(ip: string): string | null {
  const ipBytes = ip.includes(":") ? parseIPv6(ip) : parseIPv4(ip);
  if (!ipBytes) return null;
  for (const { net, prefixLen, url } of CIDR_TABLE) {
    if (net.length === ipBytes.length && ipInCIDR(ipBytes, net, prefixLen)) return url;
  }
  return null;
}

// lookupASNRdapServer returns the RDAP server for the range containing asn.
export function lookupASNRdapServer(asn: number): string | null {
  for (const [lo, hi, url] of RDAP_ASN) {
    if (asn >= lo && asn <= hi) return url;
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

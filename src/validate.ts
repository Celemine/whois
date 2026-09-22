const asnRegex = /^(?:as|asn)?(\d+)$/i;
const domainRegex =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:[a-zA-Z]{2,}|xn--[a-zA-Z0-9-]+)$/;

export function isASN(resource: string): boolean {
  return asnRegex.test(resource);
}

export function asnNumber(resource: string): number {
  const m = resource.match(asnRegex);
  return m ? parseInt(m[1], 10) : NaN;
}

export function isIP(resource: string): boolean {
  return isIPv4(resource) || isIPv6(resource);
}

export function isCIDR(resource: string): boolean {
  const slash = resource.indexOf("/");
  if (slash < 0) return false;
  const host = resource.slice(0, slash);
  const prefix = parseInt(resource.slice(slash + 1), 10);
  if (isNaN(prefix)) return false;
  if (isIPv4(host)) return prefix >= 0 && prefix <= 32;
  if (isIPv6(host)) return prefix >= 0 && prefix <= 128;
  return false;
}

export function isDomain(resource: string): boolean {
  const ascii = toASCII(resource);
  if (!ascii) return false;
  return domainRegex.test(ascii);
}

export function toASCII(domain: string): string {
  try {
    // Use the URL constructor for punycode conversion
    const url = new URL(`http://${domain}`);
    return url.hostname;
  } catch {
    return "";
  }
}

// Returns the TLD(s) to try for a domain, longest first (e.g. "com.cn" then "cn")
export function extractTLDs(domain: string): string[] {
  const labels = domain.split(".");
  const tlds: string[] = [];
  // compound TLD: join all labels after the first
  if (labels.length >= 3) {
    tlds.push(labels.slice(1).join("."));
  }
  tlds.push(labels[labels.length - 1]);
  return tlds;
}

function isIPv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return /^\d+$/.test(p) && n >= 0 && n <= 255;
  });
}

function isIPv6(s: string): boolean {
  // Quick structural check; full validation via URL constructor
  if (!s.includes(":")) return false;
  try {
    new URL(`http://[${s}]`);
    return true;
  } catch {
    return false;
  }
}

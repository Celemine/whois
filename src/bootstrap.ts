import { Env } from "./types";

const IANA_URLS: Record<string, string> = {
  dns: "https://data.iana.org/rdap/dns.json",
  ipv4: "https://data.iana.org/rdap/ipv4.json",
  ipv6: "https://data.iana.org/rdap/ipv6.json",
  asn: "https://data.iana.org/rdap/asn.json",
};

const MAX_SIZE = 2 * 1024 * 1024;
const KV_PREFIX = "bootstrap:";

interface BootstrapResponse {
  services: [[string[], string[]]];
}

async function fetchBootstrap(url: string): Promise<Map<string, string>> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);

  const body = await resp.text();
  if (body.length > MAX_SIZE) throw new Error(`bootstrap response from ${url} exceeds 2 MiB`);

  const data = JSON.parse(body) as BootstrapResponse;
  const result = new Map<string, string>();

  for (const service of data.services) {
    const [identifiers, urls] = service;
    if (!identifiers?.length || !urls?.length) continue;
    // Prefer HTTPS
    const serverURL = urls.find((u) => u.startsWith("https")) ?? urls[0];
    for (const id of identifiers) {
      result.set(id, serverURL);
    }
  }
  return result;
}

export async function handleScheduled(env: Env): Promise<void> {
  const merged = new Map<string, string>();
  const categories = Object.entries(IANA_URLS);

  await Promise.allSettled(
    categories.map(async ([category, url]) => {
      try {
        const data = await fetchBootstrap(url);
        let prefix = "";
        if (category === "dns") prefix = "rdap:";
        else if (category === "ipv4" || category === "ipv6") prefix = "ip:";
        else if (category === "asn") prefix = "asn:";

        for (const [id, serverURL] of data) {
          merged.set(`${KV_PREFIX}${prefix}${id}`, serverURL);
        }
      } catch (err) {
        console.error(`bootstrap fetch failed for ${category}:`, err);
      }
    })
  );

  // Write all entries to KV in parallel batches
  const puts = Array.from(merged.entries()).map(([key, value]) =>
    env.WHOIS_CACHE.put(key, value, { expirationTtl: 90000 }) // ~25 hours
  );
  await Promise.allSettled(puts);
  console.log(`bootstrap: wrote ${merged.size} entries to KV`);
}

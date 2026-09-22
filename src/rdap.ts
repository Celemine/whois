import { QueryDeniedError, ResourceNotFoundError, ResponseTooLargeError } from "./errors";

const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2 MiB

async function doRDAPRequest(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { Accept: "application/rdap+json" },
  });

  if (resp.status === 404) throw new ResourceNotFoundError();
  if (resp.status === 403) throw new QueryDeniedError();
  if (resp.status !== 200) throw new Error(`unexpected RDAP status ${resp.status} from ${url}`);

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("no response body");

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_RESPONSE_SIZE) throw new ResponseTooLargeError(url);
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(merged);
}

export async function rdapQueryDomain(domain: string, serverBase: string): Promise<string> {
  const url = serverBase + "domain/" + encodeURIComponent(domain);
  return doRDAPRequest(url);
}

export async function rdapQueryIP(ip: string, serverBase: string): Promise<string> {
  // CIDR slashes must remain as path separators
  const encoded = ip.split("/").map(encodeURIComponent).join("/");
  return doRDAPRequest(serverBase + "ip/" + encoded);
}

export async function rdapQueryASN(asn: string, serverBase: string): Promise<string> {
  return doRDAPRequest(serverBase + "autnum/" + encodeURIComponent(asn));
}

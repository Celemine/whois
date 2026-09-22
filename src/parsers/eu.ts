import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { matchFirst, nowRFC3339 } from "./utils";

export function parseWhoisEU(response: string, domain: string): DomainInfo {
  const status = matchFirst(/Status:\s*(.*)/, response);
  if (status.toLowerCase() === "available") throw new DomainNotFoundError();

  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  info.registrar = matchFirst(/Registrar:\s*\n\s*Name:\s*(.*)/, response);

  // Name servers block: lines like "ns1.eurid.eu (185.36.4.252)"
  const nsBlock = response.match(/Name servers:\s*\n(.*?)\n\s*\n/s);
  if (nsBlock) {
    const seen = new Set<string>();
    for (const line of nsBlock[1].split("\n")) {
      let host = line.trim();
      const paren = host.indexOf(" (");
      if (paren >= 0) host = host.slice(0, paren);
      host = host.toLowerCase().trim();
      if (!host || seen.has(host)) continue;
      seen.add(host);
      info.nameservers.push(host);
    }
  }

  // DNSSEC: signed when response has a "Keys:" block
  info.secureDNS = { delegationSigned: /\nKeys:\s*\n/.test(response) };

  info.lastUpdateOfRdapDb = nowRFC3339();

  if (!info.registrar) throw new DomainNotFoundError();
  return info;
}

import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, secureDNSFromString, lowerAll, matchFirst, matchAll, nowRFC3339 } from "./utils";

const CST_OFFSET = 8;

export function parseWhoisTW(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  info.registrar = matchFirst(/Registration Service Provider: (.*)/, response);

  info.status = cleanStatus(
    matchAll(/Domain Status: (.*)/g, response).map((s) => s.trim())
  );

  const creation = matchFirst(/Record created on (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/, response);
  if (creation) info.registrationDate = normalizeDate(creation, CST_OFFSET);

  const expiry = matchFirst(/Record expires on (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, CST_OFFSET);

  const nsBlock = response.match(/Domain servers in listed order:\n\s+(.*?)\n\n/s);
  if (nsBlock) {
    info.nameservers = lowerAll(nsBlock[1].split("\n").filter(Boolean));
  }

  const dnssec = matchFirst(/DNSSEC: (.*)/, response);
  if (dnssec) info.secureDNS = secureDNSFromString(dnssec);

  info.lastUpdateOfRdapDb = nowRFC3339();

  if (!info.registrar || !info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

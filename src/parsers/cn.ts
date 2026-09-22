import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, secureDNSFromString, lowerAll, matchFirst, matchAll, nowRFC3339 } from "./utils";

const CST_OFFSET = 8; // UTC+8

export function parseWhoisCN(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  const creation = matchFirst(/Registration Time: (.*)/, response);
  if (creation) info.registrationDate = normalizeDate(creation, CST_OFFSET);

  const expiry = matchFirst(/Expiration Time: (.*)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, CST_OFFSET);

  info.nameservers = lowerAll(matchAll(/Name Server: (.*)/g, response));

  const dnssec = matchFirst(/DNSSEC: (.*)/, response);
  if (dnssec) info.secureDNS = secureDNSFromString(dnssec);

  info.registrar = matchFirst(/Sponsoring Registrar: (.*)/, response);

  info.status = cleanStatus(matchAll(/Domain Status: (.*)/g, response));

  info.lastUpdateOfRdapDb = nowRFC3339();

  if (!info.registrar || !info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

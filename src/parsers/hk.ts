import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, secureDNSFromString, lowerAll, matchFirst, nowRFC3339 } from "./utils";

export function parseWhoisHK(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  const creation = matchFirst(/Domain Name Commencement Date: (.*)/, response);
  if (creation) info.registrationDate = normalizeDate(creation, 0);

  const expiry = matchFirst(/Expiry Date: (.*)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, 0);

  // Name servers block
  const nsBlock = response.match(/Name Servers Information:\s*\n\n((?:.+\n)+)/);
  if (nsBlock) {
    info.nameservers = lowerAll(nsBlock[1].split("\n").filter(Boolean));
  }

  const dnssec = matchFirst(/DNSSEC: (.*)/, response);
  if (dnssec) info.secureDNS = secureDNSFromString(dnssec);

  info.registrar = matchFirst(/Registrar Name: (.*)/, response);

  const status = matchFirst(/Domain Status: (.*)/, response);
  if (status) info.status = cleanStatus([status]);

  info.lastUpdateOfRdapDb = nowRFC3339();

  if (!info.registrar || !info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

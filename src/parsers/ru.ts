import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, lowerAll, matchFirst, matchAll } from "./utils";

export function parseWhoisRU(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  info.registrar = matchFirst(/registrar: (.*)/, response).trim();

  const creation = matchFirst(/created:\s+(.*)/, response);
  if (creation) info.registrationDate = normalizeDate(creation, 0);

  const expiry = matchFirst(/paid-till:\s+(.*)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, 0);

  info.nameservers = lowerAll(matchAll(/nserver:\s+(.*)/g, response));

  info.status = cleanStatus(matchAll(/state:\s+(.*)/g, response));

  const lastUpdate = matchFirst(/Last updated on (.*)/, response);
  if (lastUpdate) info.lastUpdateOfRdapDb = normalizeDate(lastUpdate, 0);

  if (!info.registrar || !info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

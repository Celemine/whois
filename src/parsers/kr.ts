import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, secureDNSFromString, lowerAll, matchFirst, matchAll, nowRFC3339 } from "./utils";

export function parseWhoisKR(response: string, domain: string): DomainInfo {
  if (response.includes("The requested domain was not found in the Registry or Registrar")) {
    throw new DomainNotFoundError();
  }

  // Parse only the English section
  const engIdx = response.indexOf("# ENGLISH");
  if (engIdx >= 0) response = response.slice(engIdx);

  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  const creation = matchFirst(/Registered Date\s*:\s*(.*)/, response);
  if (creation) info.registrationDate = normalizeDate(creation, 0);

  const updated = matchFirst(/Last Updated Date\s*:\s*(.*)/, response);
  if (updated) info.lastChangedDate = normalizeDate(updated, 0);

  const expiry = matchFirst(/Expiration Date\s*:\s*(.*)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, 0);

  // Strip trailing URL "(http...)" from registrar
  let registrar = matchFirst(/Authorized Agency\s*:\s*(.*)/, response);
  const httpIdx = registrar.indexOf("(http");
  if (httpIdx >= 0) registrar = registrar.slice(0, httpIdx).trim();
  info.registrar = registrar;

  info.nameservers = lowerAll(matchAll(/Host Name\s*:\s*(.*)/g, response));

  const dnssec = matchFirst(/DNSSEC\s*:\s*(.*)/, response);
  if (dnssec) info.secureDNS = secureDNSFromString(dnssec);

  info.lastUpdateOfRdapDb = nowRFC3339();

  if (!info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

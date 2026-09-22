import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, secureDNSFromString, attachDSData, lowerAll, matchFirst, matchAll } from "./utils";

export function parseWhoisSO(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  info.registrar = matchFirst(/Registrar: (.*)/, response);

  info.status = cleanStatus(matchAll(/Domain Status: (.*)/g, response));

  info.registrarIanaId = matchFirst(/Registrar IANA ID: (.*)/, response);

  const creation = matchFirst(/Creation Date: (.*)/, response);
  if (creation) info.registrationDate = normalizeDate(creation, 0);

  const expiry = matchFirst(/Registry Expiry Date: (.*)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, 0);

  const updated = matchFirst(/Updated Date: (.*)/, response);
  if (updated) info.lastChangedDate = normalizeDate(updated, 0);

  info.nameservers = lowerAll(matchAll(/Name Server: (.*)/g, response));

  const dnssec = matchFirst(/DNSSEC: (.*)/, response);
  if (dnssec) info.secureDNS = secureDNSFromString(dnssec);

  const dsData = matchFirst(/DNSSEC DS Data: (.*)/, response);
  if (dsData) attachDSData(info, dsData);

  const lastUpdate = matchFirst(/Last update of WHOIS database: (.*)/, response);
  if (lastUpdate) {
    info.lastUpdateOfRdapDb = normalizeDate(lastUpdate.replace(/ <<<$/, "").trim(), 0);
  }

  if (!info.registrar || !info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, secureDNSFromString, lowerAll, matchFirst, matchAll } from "./utils";

export function parseWhoisLA(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  info.registrar = matchFirst(/Registrar:\s+(.+)/, response).trim();

  const ianaId = matchFirst(/Registrar IANA ID:\s*(.*)$/, response).trim();
  if (ianaId) info.registrarIanaId = ianaId;

  info.status = cleanStatus(
    matchAll(/Domain Status:\s+(.+)/g, response).map((s) => s.trim())
  );

  const creation = matchFirst(/Creation Date:\s+(.+)/, response);
  if (creation) info.registrationDate = normalizeDate(creation, 0);

  const expiry = matchFirst(/Registry Expiry Date:\s+(.+)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, 0);

  const updated = matchFirst(/Updated Date:\s+(.+)/, response);
  if (updated) info.lastChangedDate = normalizeDate(updated, 0);

  info.nameservers = lowerAll(
    matchAll(/Name Server:\s+(.+)/g, response).map((s) => s.trim())
  );

  const dnssec = matchFirst(/DNSSEC:\s+(.+)/, response);
  if (dnssec) info.secureDNS = secureDNSFromString(dnssec);

  const lastUpdate = matchFirst(/>>> Last update of WHOIS database:\s+(.+)/, response);
  if (lastUpdate) {
    info.lastUpdateOfRdapDb = normalizeDate(lastUpdate.replace(/ <<<$/, "").trim(), 0);
  }

  if (!info.registrar || !info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

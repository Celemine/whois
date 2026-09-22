import { DomainInfo, ObjectClassDomain } from "../types";
import { normalizeDate, cleanStatus, secureDNSFromString, attachDSData, lowerAll, matchFirst, matchAll, nowRFC3339 } from "./utils";

// Generic WHOIS parser for standard IANA EPP-style responses.
// Used as a fallback for TLDs without a dedicated parser.
export function parseWhoisGeneric(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  info.registrar = matchFirst(/Registrar:\s+(.+)/, response).trim();
  if (!info.registrar) info.registrar = matchFirst(/Registrar Name:\s+(.+)/, response).trim();

  info.registrarIanaId = matchFirst(/Registrar IANA ID:\s*(.*)/, response).trim();

  const creation = matchFirst(/Creation Date:\s+(.+)/, response);
  if (creation) info.registrationDate = normalizeDate(creation, 0);

  const expiry =
    matchFirst(/Registry Expiry Date:\s+(.+)/, response) ||
    matchFirst(/Registrar Registration Expiration Date:\s+(.+)/, response) ||
    matchFirst(/Expiry Date:\s+(.+)/, response) ||
    matchFirst(/Expiration Date:\s+(.+)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, 0);

  const updated = matchFirst(/Updated Date:\s+(.+)/, response);
  if (updated) info.lastChangedDate = normalizeDate(updated, 0);

  info.nameservers = lowerAll(matchAll(/Name Server:\s+(.+)/g, response));
  if (!info.nameservers.length) {
    info.nameservers = lowerAll(matchAll(/Nameserver:\s+(.+)/g, response));
  }

  info.status = cleanStatus(matchAll(/Domain Status:\s+(.+)/g, response));
  if (!info.status.length) {
    info.status = cleanStatus(matchAll(/Status:\s+(.+)/g, response));
  }

  const dnssec = matchFirst(/DNSSEC:\s+(.+)/, response);
  if (dnssec) info.secureDNS = secureDNSFromString(dnssec);

  const dsData = matchFirst(/DNSSEC DS Data:\s+(.+)/, response);
  if (dsData) attachDSData(info, dsData);

  const lastUpdate = matchFirst(/Last update of WHOIS database:\s+(.+)/, response);
  if (lastUpdate) {
    info.lastUpdateOfRdapDb = normalizeDate(lastUpdate.replace(/ <<<$/, "").trim(), 0);
  }

  if (!info.lastUpdateOfRdapDb) info.lastUpdateOfRdapDb = nowRFC3339();

  return info;
}

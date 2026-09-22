import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, secureDNSFromString, attachDSData, lowerAll, matchFirst, matchAll, nowRFC3339 } from "./utils";

// Registry "not registered" replies, e.g. Verisign/Nominet "No match for",
// Identity Digital "The queried object does not exist", GoDaddy Registry
// "No Data Found", CIRA/InternetNZ "Not found:", AFNIC "%% NOT FOUND",
// IIS 'domain "x" not found.', SIDN "x is free", nic.at "% nothing found".
const NOT_FOUND =
  /^[\s%#]*(no match for|no data found|no entries found|nothing found|not found\b|the queried object does not exist|domain \S+ not found|\S+ is free\b|status:\s*(free|available)\s*$)/im;

// Generic WHOIS parser for standard IANA EPP-style responses.
// Used as a fallback for TLDs without a dedicated parser.
export function parseWhoisGeneric(response: string, domain: string): DomainInfo {
  if (NOT_FOUND.test(response)) throw new DomainNotFoundError();

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

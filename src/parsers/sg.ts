import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, secureDNSFromString, lowerAll, matchFirst, matchAll } from "./utils";

const SGT_OFFSET = 8;

export function parseWhoisSG(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  const creation = matchFirst(/Creation Date:\s+(.*)/, response);
  if (creation) info.registrationDate = normalizeDate(creation.replace(/\r$/, ""), SGT_OFFSET);

  const expiry = matchFirst(/Expiration Date:\s+(.*)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry.replace(/\r$/, ""), SGT_OFFSET);

  const updated = matchFirst(/Modified Date:\s+(.*)/, response);
  if (updated) info.lastChangedDate = normalizeDate(updated.replace(/\r$/, ""), SGT_OFFSET);

  info.nameservers = lowerAll(
    matchAll(/Name Servers?:\s+(.*)/g, response).map((s) => s.replace(/\r$/, ""))
  );

  const dnssec = matchFirst(/DNSSEC:\s+(.*)/, response);
  if (dnssec) info.secureDNS = secureDNSFromString(dnssec.replace(/[\r\t]+$/, ""));

  info.registrar = matchFirst(/Registrar:\s+(.*)/, response).replace(/\r$/, "");

  info.status = cleanStatus(
    matchAll(/Domain Status:\s+(.*)/g, response).map((s) => s.replace(/\r$/, ""))
  );

  if (!info.registrar || !info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

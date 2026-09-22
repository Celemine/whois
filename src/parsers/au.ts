import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, secureDNSFromString, attachDSData, lowerAll, matchFirst, matchAll } from "./utils";

export function parseWhoisAU(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  const clean = response.replace(/\r/g, "");

  const creation = matchFirst(/Creation Date: (.*)/, clean);
  if (creation) info.registrationDate = normalizeDate(creation, 0);

  const expiry = matchFirst(/Registry Expiry Date: (.*)/, clean);
  if (expiry) info.expirationDate = normalizeDate(expiry, 0);

  const updated = matchFirst(/Last Modified: (.*)/, clean);
  if (updated) info.lastChangedDate = normalizeDate(updated, 0);

  info.nameservers = lowerAll(matchAll(/Name Server: (.*)/g, clean));

  const dnssec = matchFirst(/DNSSEC: (.*)/, clean);
  if (dnssec) info.secureDNS = secureDNSFromString(dnssec);

  info.registrar = matchFirst(/Registrar Name: (.*)/, clean).trim();

  info.status = cleanStatus(
    matchAll(/Status: (.*)/g, clean).map((s) => s.trim())
  );

  info.registrarIanaId = matchFirst(/Registrar IANA ID: (.*)/, clean);

  const dsData = matchFirst(/DNSSEC DS Data: (.*)/, clean);
  if (dsData) attachDSData(info, dsData);

  const lastUpdate = clean.match(/Last update of WHOIS database: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
  if (lastUpdate) info.lastUpdateOfRdapDb = normalizeDate(lastUpdate[1], 0);

  if (!info.registrar) {
    throw new DomainNotFoundError();
  }
  return info;
}

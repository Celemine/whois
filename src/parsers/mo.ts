import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, lowerAll, matchFirst, nowRFC3339 } from "./utils";

const CST_OFFSET = 8;

export function parseWhoisMO(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  const creation = matchFirst(/Record created on (.*)/, response);
  if (creation) info.registrationDate = normalizeDate(creation, CST_OFFSET);

  const expiry = matchFirst(/Record expires on (.*)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, CST_OFFSET);

  // Name servers block: "Domain name servers:\n  ------\n  ns1.example.com\n..."
  const nsBlock = response.match(/Domain name servers:\s*\n\s*-+\n((?:.+\n)+)/);
  if (nsBlock) {
    info.nameservers = lowerAll(nsBlock[1].split("\n").filter(Boolean));
  }

  info.lastUpdateOfRdapDb = nowRFC3339();

  if (!info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

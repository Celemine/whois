import { DomainInfo, ObjectClassDomain } from "../types";
import { DomainNotFoundError } from "../errors";
import { normalizeDate, cleanStatus, attachDSData, lowerAll, matchFirst, matchAll, nowRFC3339 } from "./utils";

const JST_OFFSET = 9;

function extractSigningKey(response: string): string {
  let afterKey = "";
  const idx1 = response.indexOf("[Signing Key]");
  const idx2 = response.indexOf("s. [署名鍵]");
  if (idx1 !== -1) afterKey = response.slice(idx1 + "[Signing Key]".length);
  else if (idx2 !== -1) afterKey = response.slice(idx2 + "s. [署名鍵]".length);
  else return "";

  let endIdx = afterKey.length;
  const nl2 = afterKey.indexOf("\n\n");
  if (nl2 !== -1) endIdx = Math.min(endIdx, nl2);
  const nlBracket = afterKey.indexOf("\n[");
  if (nlBracket !== -1) endIdx = Math.min(endIdx, nlBracket);

  let raw = afterKey.slice(0, endIdx);
  raw = raw.replace(/[()]/g, "").replace(/[\n\t]/g, " ").replace(/\s+/g, " ").trim();
  return raw;
}

export function parseWhoisJP(response: string, domain: string): DomainInfo {
  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: domain.toLowerCase(),
    status: [],
    nameservers: [],
  };

  // Domain name - try both formats
  const domainName =
    matchFirst(/\[Domain Name\]\s+(.*)/, response) ||
    matchFirst(/a\.\s*\[ドメイン名\]\s+(.*)/, response);
  if (domainName) info.ldhName = domainName.toLowerCase();

  // Registrar/Registrant/Organization
  info.registrar =
    matchFirst(/\[Registrant\]\s+(.*)/, response) ||
    matchFirst(/g\.\s*\[Organization\]\s+(.*)/, response);

  // Name servers
  info.nameservers = lowerAll(matchAll(/\[Name Server\]\s+(\S+)/g, response));
  if (!info.nameservers.length) {
    info.nameservers = lowerAll(matchAll(/p\.\s*\[ネームサーバ\]\s+(\S+)/g, response));
  }

  // DNSSEC
  info.secureDNS = { delegationSigned: false };
  const sigKey = extractSigningKey(response);
  if (sigKey) attachDSData(info, sigKey);

  // Registration date (YYYY/MM/DD)
  const creation = matchFirst(/\[登録年月日\]\s+(.*)/, response);
  if (creation) info.registrationDate = normalizeDate(creation, JST_OFFSET);

  // Expiry date
  const expiry = matchFirst(/\[有効期限\]\s+(.*)/, response);
  if (expiry) info.expirationDate = normalizeDate(expiry, JST_OFFSET);

  // Status - may contain embedded expiry date like "Connected (2026/10/31)"
  const statusStr = matchFirst(/\[状態\]\s+(.*)/, response);
  if (statusStr) {
    if (!info.expirationDate) {
      const inStatus = statusStr.match(/\((\d{4}\/\d{2}\/\d{2})\)/);
      if (inStatus) info.expirationDate = normalizeDate(inStatus[1], JST_OFFSET);
    }
    const statusClean = statusStr.replace(/\(\d{4}\/\d{2}\/\d{2}\)/, "").trim();
    if (statusClean) info.status.push(statusClean);
  }

  // Lock statuses
  const lockStatuses = matchAll(/\[ロック状態\]\s+(.*)/g, response);
  info.status = cleanStatus([...info.status, ...lockStatuses]);

  // Last update
  const updated = matchFirst(/\[最終更新\]\s+(.*)/, response);
  if (updated) info.lastChangedDate = normalizeDate(updated, JST_OFFSET);

  info.lastUpdateOfRdapDb = nowRFC3339();

  if (!info.registrationDate || !info.expirationDate) {
    throw new DomainNotFoundError();
  }
  return info;
}

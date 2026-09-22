import { DomainInfo } from "../types";
import { parseWhoisCN } from "./cn";
import { parseWhoisHK } from "./hk";
import { parseWhoisTW } from "./tw";
import { parseWhoisSO } from "./so";
import { parseWhoisRU } from "./ru";
import { parseWhoisSB } from "./sb";
import { parseWhoisMO } from "./mo";
import { parseWhoisAU } from "./au";
import { parseWhoisSG } from "./sg";
import { parseWhoisLA } from "./la";
import { parseWhoisJP } from "./jp";
import { parseWhoisEU } from "./eu";
import { parseWhoisKR } from "./kr";
import { parseWhoisGeneric } from "./generic";

type Parser = (response: string, domain: string) => DomainInfo;

const PARSERS: Record<string, Parser> = {
  // .cn and Chinese IDN TLDs
  cn: parseWhoisCN,
  "xn--fiqs8s": parseWhoisCN,  // .中国
  "xn--fiqz9s": parseWhoisCN,  // .中國
  // .hk and HK IDN
  hk: parseWhoisHK,
  "xn--j6w193g": parseWhoisHK, // .香港
  // .tw
  tw: parseWhoisTW,
  // .so
  so: parseWhoisSO,
  // .ru / .su
  ru: parseWhoisRU,
  su: parseWhoisRU,
  // .sb
  sb: parseWhoisSB,
  // .mo
  mo: parseWhoisMO,
  // .au
  au: parseWhoisAU,
  // .sg
  sg: parseWhoisSG,
  // .la
  la: parseWhoisLA,
  // .jp
  jp: parseWhoisJP,
  // .eu
  eu: parseWhoisEU,
  // .kr and Korean IDN
  kr: parseWhoisKR,
  "xn--3e0b707e": parseWhoisKR, // .한국
};

// parseWhoisResponse dispatches to a TLD-specific parser or the generic fallback.
// Returns a DomainInfo; throws DomainNotFoundError or other errors on failure.
export function parseWhoisResponse(
  response: string,
  domain: string,
  tld: string
): DomainInfo {
  const parser = PARSERS[tld] ?? parseWhoisGeneric;
  return parser(response, domain);
}

export { parseRDAPDomain, parseRDAPIP, parseRDAPASN } from "./rdap";

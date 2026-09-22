import { DomainInfo, IPInfo, ASNInfo, ObjectClassDomain, ObjectClassIPNetwork, ObjectClassAutnum, DSData, KeyData, Remark } from "../types";
import { normalizeDate, cleanStatus } from "./utils";

// Internal RDAP JSON shapes
interface RdapEvent { eventAction: string; eventDate: string; }
interface RdapPublicId { type: string; identifier: string; }
interface RdapVcardProp { [0]: string; [1]: unknown; [2]: unknown; [3]: unknown; }
interface RdapEntity {
  roles: string[];
  vcardArray: [string, RdapVcardProp[]] | null;
  publicIds?: RdapPublicId[];
  entities?: RdapEntity[];
}
interface RdapNameserver { ldhName: string; }
interface RdapDsData { keyTag: number; algorithm: number; digestType: number; digest: string; }
interface RdapKeyData { flags: number; protocol: number; algorithm: number; publicKey: string; }
interface RdapSecureDNS {
  delegationSigned?: boolean;
  dsData?: RdapDsData[];
  keyData?: RdapKeyData[];
}
interface RdapDomainResponse {
  ldhName: string;
  unicodeName?: string;
  status?: string[];
  entities?: RdapEntity[];
  events?: RdapEvent[];
  nameservers?: RdapNameserver[];
  secureDNS?: RdapSecureDNS;
}
interface RdapCidr { v4prefix?: string; v6prefix?: string; length?: number; }
interface RdapRemark { title: string; description: string[]; }
interface RdapIPResponse {
  handle: string;
  startAddress?: string;
  endAddress?: string;
  name?: string;
  cidr0_cidrs?: RdapCidr[];
  type?: string;
  country?: string;
  status?: string[];
  events?: RdapEvent[];
  remarks?: RdapRemark[];
}
interface RdapASNResponse {
  handle: string;
  name?: string;
  status?: string[];
  events?: RdapEvent[];
  remarks?: RdapRemark[];
}

function extractRegistrarName(vcardArray: RdapEntity["vcardArray"]): string {
  if (!vcardArray || vcardArray.length < 2) return "";
  const props = vcardArray[1];
  for (const prop of props) {
    if (prop[0] === "fn" && typeof prop[3] === "string") return prop[3];
  }
  return "";
}

function findRegistrarEntity(entities?: RdapEntity[]): RdapEntity | null {
  if (!entities) return null;
  for (const e of entities) {
    if (e.roles?.includes("registrar")) return e;
    const nested = findRegistrarEntity(e.entities);
    if (nested) return nested;
  }
  return null;
}

export function parseRDAPDomain(response: string): DomainInfo {
  const rdap: RdapDomainResponse = JSON.parse(response);

  const info: DomainInfo = {
    objectClassName: ObjectClassDomain,
    ldhName: (rdap.ldhName ?? "").toLowerCase(),
    unicodeName: rdap.unicodeName,
    status: cleanStatus(rdap.status ?? []),
    nameservers: [],
  };

  const registrar = findRegistrarEntity(rdap.entities);
  if (registrar) {
    info.registrar = extractRegistrarName(registrar.vcardArray);
    for (const id of registrar.publicIds ?? []) {
      if (id.type.toLowerCase() === "iana registrar id") {
        info.registrarIanaId = id.identifier;
        break;
      }
    }
  }

  for (const event of rdap.events ?? []) {
    const date = normalizeDate(event.eventDate, 0);
    switch (event.eventAction) {
      case "registration": info.registrationDate = date; break;
      case "expiration": info.expirationDate = date; break;
      case "last changed": info.lastChangedDate = date; break;
      case "last update of RDAP database": info.lastUpdateOfRdapDb = date; break;
    }
  }

  info.nameservers = (rdap.nameservers ?? [])
    .map((ns) => ns.ldhName?.replace(/\.$/, "").toLowerCase() ?? "")
    .filter(Boolean);

  info.secureDNS = { delegationSigned: false };
  if (rdap.secureDNS) {
    const s = rdap.secureDNS;
    info.secureDNS.delegationSigned =
      !!s.delegationSigned || (s.dsData?.length ?? 0) > 0 || (s.keyData?.length ?? 0) > 0;
    if (s.dsData?.length) {
      info.secureDNS.dsData = s.dsData.map((d): DSData => ({
        keyTag: d.keyTag, algorithm: d.algorithm, digestType: d.digestType, digest: d.digest,
      }));
    }
    if (s.keyData?.length) {
      info.secureDNS.keyData = s.keyData.map((k): KeyData => ({
        flags: k.flags, protocol: k.protocol, algorithm: k.algorithm, publicKey: k.publicKey,
      }));
    }
  }

  return info;
}

export function parseRDAPIP(response: string): IPInfo {
  const rdap: RdapIPResponse = JSON.parse(response);

  const info: IPInfo = {
    objectClassName: ObjectClassIPNetwork,
    handle: rdap.handle ?? "",
    startAddress: rdap.startAddress,
    endAddress: rdap.endAddress,
    name: rdap.name,
    type: rdap.type,
    country: rdap.country,
    status: cleanStatus(rdap.status ?? []),
  };

  for (const cidr of rdap.cidr0_cidrs ?? []) {
    if (cidr.v4prefix) { info.cidr = `${cidr.v4prefix}/${cidr.length}`; break; }
    if (cidr.v6prefix) { info.cidr = `${cidr.v6prefix}/${cidr.length}`; break; }
  }

  for (const event of rdap.events ?? []) {
    const date = normalizeDate(event.eventDate, 0);
    if (event.eventAction === "registration") info.registrationDate = date;
    else if (event.eventAction === "last changed") info.lastChangedDate = date;
  }

  if (rdap.remarks?.length) {
    info.remarks = rdap.remarks.map((r): Remark => ({ title: r.title, description: r.description }));
  }

  return info;
}

export function parseRDAPASN(response: string): ASNInfo {
  const rdap: RdapASNResponse = JSON.parse(response);

  const info: ASNInfo = {
    objectClassName: ObjectClassAutnum,
    handle: rdap.handle ?? "",
    name: rdap.name,
    status: cleanStatus(rdap.status ?? []),
  };

  for (const event of rdap.events ?? []) {
    const date = normalizeDate(event.eventDate, 0);
    if (event.eventAction === "registration") info.registrationDate = date;
    else if (event.eventAction === "last changed") info.lastChangedDate = date;
  }

  if (rdap.remarks?.length) {
    info.remarks = rdap.remarks.map((r): Remark => ({ title: r.title, description: r.description }));
  }

  return info;
}

export const ObjectClassDomain = "domain";
export const ObjectClassIPNetwork = "ip network";
export const ObjectClassAutnum = "autnum";

export interface DSData {
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
}

export interface KeyData {
  flags: number;
  protocol: number;
  algorithm: number;
  publicKey: string;
}

export interface SecureDNS {
  delegationSigned: boolean;
  dsData?: DSData[];
  keyData?: KeyData[];
}

export interface DomainInfo {
  objectClassName: string;
  ldhName: string;
  unicodeName?: string;
  registrar?: string;
  registrarIanaId?: string;
  status: string[];
  registrationDate?: string;
  expirationDate?: string;
  lastChangedDate?: string;
  nameservers: string[];
  secureDNS?: SecureDNS;
  lastUpdateOfRdapDb?: string;
  unparsed?: boolean;
  rawText?: string;
}

export interface Remark {
  title: string;
  description: string[];
}

export interface IPInfo {
  objectClassName: string;
  handle: string;
  startAddress?: string;
  endAddress?: string;
  cidr?: string;
  name?: string;
  type?: string;
  country?: string;
  status: string[];
  registrationDate?: string;
  lastChangedDate?: string;
  remarks?: Remark[];
}

export interface ASNInfo {
  objectClassName: string;
  handle: string;
  name?: string;
  status: string[];
  registrationDate?: string;
  lastChangedDate?: string;
  remarks?: Remark[];
}

export interface Env {
  WHOIS_CACHE: KVNamespace;
  WHOIS_TIMEOUT: string;
  CACHE_TTL: string;
  NEGATIVE_CACHE_TTL: string;
}

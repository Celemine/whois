import { DomainInfo, DSData, SecureDNS } from "../types";

// Datetime layouts that include a time component (used for branch detection)
const DATE_TIME_RE =
  /^(\d{4}[-/]\d{2}[-/]\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

const MONTH_NAMES: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const TZ_SUFFIX = /\s*\([A-Z]+\)\s*$/;

export function normalizeDate(s: string, offsetHours = 0): string {
  s = s.trim().replace(TZ_SUFFIX, "");
  if (!s) return s;

  // Try datetime parse (contains time component)
  if (DATE_TIME_RE.test(s)) {
    try {
      const d = new Date(s.replace(/\//g, "-"));
      if (!isNaN(d.getTime())) {
        if (!s.includes("Z") && !s.match(/[+-]\d{2}:?\d{2}$/)) {
          d.setTime(d.getTime() - offsetHours * 3600 * 1000);
        }
        return d.toISOString().replace(/\.\d{3}Z$/, "Z");
      }
    } catch {
      // fall through
    }
  }

  // Try date-only layouts
  // ISO date
  const isoDate = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) return s;

  // DD-MM-YYYY (.hk)
  const hkDate = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (hkDate) return `${hkDate[3]}-${hkDate[2]}-${hkDate[1]}`;

  // YYYY/MM/DD
  const slashDate = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashDate) return `${slashDate[1]}-${slashDate[2]}-${slashDate[3]}`;

  // DD-Mon-YYYY
  const monDate = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (monDate) {
    const mon = MONTH_NAMES[monDate[2].toLowerCase()];
    if (mon) return `${monDate[3]}-${mon}-${monDate[1]}`;
  }

  // YYYY. MM. DD. (.kr)
  const krDate = s.match(/^(\d{4})\. (\d{2})\. (\d{2})\.$/);
  if (krDate) return `${krDate[1]}-${krDate[2]}-${krDate[3]}`;

  // Generic ISO parse attempt
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return s;
}

export function cleanStatus(statuses: string[]): string[] {
  if (!statuses.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (let s of statuses) {
    s = s.trim();
    // Strip trailing ICANN EPP URL
    const spaceIdx = s.indexOf(" ");
    if (spaceIdx > 0) {
      const rest = s.slice(spaceIdx + 1);
      if (rest.startsWith("http") || rest.startsWith("(http")) {
        s = s.slice(0, spaceIdx);
      }
    }
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function secureDNSFromString(s: string): SecureDNS {
  const v = s.toLowerCase().trim();
  const signed =
    v.startsWith("signed") || v === "yes" || v === "active" || v === "valid";
  return { delegationSigned: signed };
}

export function parseDSRecord(raw: string): DSData | null {
  const fields = raw.trim().split(/\s+/);
  if (fields.length < 4) return null;
  const keyTag = parseInt(fields[0], 10);
  const algorithm = parseInt(fields[1], 10);
  const digestType = parseInt(fields[2], 10);
  if (isNaN(keyTag) || isNaN(algorithm) || isNaN(digestType)) return null;
  return {
    keyTag,
    algorithm,
    digestType,
    digest: fields.slice(3).join(""),
  };
}

export function attachDSData(info: DomainInfo, raw: string): void {
  if (!info.secureDNS) info.secureDNS = { delegationSigned: false };
  info.secureDNS.delegationSigned = true;
  const ds = parseDSRecord(raw);
  if (ds) {
    if (!info.secureDNS.dsData) info.secureDNS.dsData = [];
    info.secureDNS.dsData.push(ds);
  }
}

export function lowerAll(arr: string[]): string[] {
  return arr.map((s) => s.toLowerCase().trim()).filter(Boolean);
}

export function matchFirst(re: RegExp, s: string): string {
  const m = s.match(re);
  return m ? m[1].trim() : "";
}

export function matchAll(re: RegExp, s: string): string[] {
  const results: string[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = g.exec(s)) !== null) {
    const v = m[1].trim();
    if (v) results.push(v);
  }
  return results;
}

export function nowRFC3339(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

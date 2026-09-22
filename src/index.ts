import { Hono, Context } from "hono";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Env, DomainInfo } from "./types";
import { isDomain, isIP, isCIDR, isASN, toASCII, extractTLDs, asnNumber } from "./validate";
import { queryWhois } from "./whois";
import { rdapQueryDomain, rdapQueryIP, rdapQueryASN } from "./rdap";
import { cacheGet, cacheSet } from "./cache";
import { lookupWhoisServer, lookupRdapServer, lookupIPRdapServer, lookupASNRdapServer } from "./lookup";
import { parseWhoisResponse, parseRDAPDomain, parseRDAPIP, parseRDAPASN } from "./parsers/index";
import { DomainNotFoundError, ResourceNotFoundError, QueryDeniedError } from "./errors";

type AppEnv = { Bindings: Env };
const app = new Hono<AppEnv>();

const CACHE_TTL_DEFAULT = 3600;
const NEG_TTL_DEFAULT = 60;

function getCacheTTL(env: Env): number {
  return parseInt(env.CACHE_TTL, 10) || CACHE_TTL_DEFAULT;
}

function getNegTTL(env: Env): number {
  return parseInt(env.NEGATIVE_CACHE_TTL, 10) || NEG_TTL_DEFAULT;
}

function getTimeout(env: Env): number {
  return parseInt(env.WHOIS_TIMEOUT, 10) || 10000;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type C = Context<AppEnv, any>;

function errResponse(c: C, status: number, msg: string) {
  return c.json({ error: msg }, status as 400 | 404 | 403 | 429 | 500 | 502 | 503);
}

async function etag(body: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex.slice(0, 32)}"`;
}

async function conditionalJson(c: C, data: unknown, maxAge: number): Promise<Response> {
  const body = JSON.stringify(data);
  const tag = await etag(body);
  const cc = `public, max-age=${maxAge}`;
  if (c.req.header("If-None-Match") === tag) {
    return new Response(null, { status: 304, headers: { ETag: tag, "Cache-Control": cc } });
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: tag, "Cache-Control": cc },
  });
}

async function conditionalText(c: C, body: string, maxAge: number): Promise<Response> {
  const tag = await etag(body);
  const cc = `public, max-age=${maxAge}`;
  if (c.req.header("If-None-Match") === tag) {
    return new Response(null, { status: 304, headers: { ETag: tag, "Cache-Control": cc } });
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain;charset=UTF-8", ETag: tag, "Cache-Control": cc },
  });
}

// CORS middleware
app.use("*", async (c, next) => {
  c.res.headers.set("Access-Control-Allow-Origin", "*");
  c.res.headers.set("Access-Control-Expose-Headers", "X-Cache");
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  return next();
});

async function handleDomain(c: C, input: string) {
  const ascii = toASCII(input);
  if (!isDomain(ascii || input)) return errResponse(c, 400, "Invalid domain name");

  const domain = ascii || input;
  const env = c.env;

  // ?raw — return raw WHOIS text as text/plain (skip RDAP)
  const rawParam = c.req.query("raw");
  const wantRaw = rawParam !== undefined && rawParam !== "0" && rawParam !== "false";

  if (wantRaw) {
    const rawCacheKey = `raw:domain:${domain}`;
    const cached = await cacheGet(rawCacheKey, env.WHOIS_CACHE);
    if (cached) {
      c.header("X-Cache", "HIT");
      if (cached.negative) {
        c.header("Cache-Control", `public, max-age=${getNegTTL(env)}`);
        return errResponse(c, 404, "Domain not found");
      }
      return conditionalText(c, cached.data as string, getCacheTTL(env));
    }

    const tlds = extractTLDs(domain);
    for (const tld of tlds) {
      const whoisServer = lookupWhoisServer(tld);
      if (!whoisServer) continue;
      try {
        const rawText = await queryWhois(whoisServer, domain, getTimeout(env));
        await cacheSet(rawCacheKey, { data: rawText }, env.WHOIS_CACHE, getCacheTTL(env));
        return conditionalText(c, rawText, getCacheTTL(env));
      } catch (err) {
        if (err instanceof DomainNotFoundError) {
          await cacheSet(rawCacheKey, { data: null, negative: true }, env.WHOIS_CACHE, getNegTTL(env));
          return errResponse(c, 404, "Domain not found");
        }
        const msg = err instanceof Error ? err.message : String(err);
        return errResponse(c, 502, `WHOIS query failed: ${msg}`);
      }
    }
    return errResponse(c, 404, "No WHOIS server found for this domain");
  }

  let lookup: DomainLookup;
  try {
    lookup = await lookupDomain(domain, env);
  } catch (err) {
    if (err instanceof QueryDeniedError) return errResponse(c, 403, "Registry denied the query");
    const msg = err instanceof Error ? err.message : String(err);
    return errResponse(c, 502, `WHOIS query failed: ${msg}`);
  }

  if (lookup.cached) c.header("X-Cache", "HIT");
  if (!lookup.data) {
    if (lookup.cached) c.header("Cache-Control", `public, max-age=${getNegTTL(env)}`);
    return errResponse(c, 404, "Domain not found");
  }
  return conditionalJson(c, lookup.data, getCacheTTL(env));
}

type DomainLookup = { data: DomainInfo | null; cached: boolean };

// lookupDomain resolves an ASCII domain via RDAP, falling back to WHOIS.
// data is null when the domain is not registered. Throws QueryDeniedError when
// the registry refuses, or any other error when the upstream query fails.
async function lookupDomain(domain: string, env: Env): Promise<DomainLookup> {
  const cacheKey = `domain:${domain}`;

  const cached = await cacheGet(cacheKey, env.WHOIS_CACHE);
  if (cached) {
    return { data: cached.negative ? null : (cached.data as DomainInfo), cached: true };
  }

  const tlds = extractTLDs(domain);
  let result: DomainInfo | null = null;

  // RDAP first — fall through to WHOIS on any failure (including 404) because
  // RDAP coverage can be incomplete even when WHOIS has full data.
  for (const tld of tlds) {
    const rdapServer = lookupRdapServer(tld);
    if (rdapServer) {
      try {
        const resp = await rdapQueryDomain(domain, rdapServer);
        result = parseRDAPDomain(resp);
        break;
      } catch (err) {
        if (err instanceof QueryDeniedError) throw err;
        // ResourceNotFoundError or any other error: fall through to WHOIS
      }
    }
  }

  // WHOIS fallback
  if (!result) {
    for (const tld of tlds) {
      const whoisServer = lookupWhoisServer(tld);
      if (!whoisServer) continue;
      try {
        const rawText = await queryWhois(whoisServer, domain, getTimeout(env));
        result = parseWhoisResponse(rawText, domain, tld);
        break;
      } catch (err) {
        if (err instanceof DomainNotFoundError) break;
        throw err;
      }
    }
  }

  // Not found by RDAP and WHOIS said not-found (or there's no WHOIS server)
  if (!result) {
    await cacheSet(cacheKey, { data: null, negative: true }, env.WHOIS_CACHE, getNegTTL(env));
    return { data: null, cached: false };
  }

  await cacheSet(cacheKey, { data: result }, env.WHOIS_CACHE, getCacheTTL(env));
  return { data: result, cached: false };
}

async function handleIP(c: C, resource: string) {
  if (!isIP(resource) && !isCIDR(resource)) {
    return errResponse(c, 400, "Invalid IP address or CIDR prefix");
  }

  const cacheKey = `ip:${resource}`;
  const env = c.env;

  const cached = await cacheGet(cacheKey, env.WHOIS_CACHE);
  if (cached) {
    c.header("X-Cache", "HIT");
    if (cached.negative) {
      c.header("Cache-Control", `public, max-age=${getNegTTL(env)}`);
      return errResponse(c, 404, "IP not found");
    }
    return conditionalJson(c, cached.data, getCacheTTL(env));
  }

  const lookupIP = resource.includes("/") ? resource.split("/")[0] : resource;
  const rdapServer = lookupIPRdapServer(lookupIP);
  if (!rdapServer) return errResponse(c, 404, "No RDAP server found for this IP");

  try {
    const resp = await rdapQueryIP(resource, rdapServer);
    const info = parseRDAPIP(resp);
    await cacheSet(cacheKey, { data: info }, env.WHOIS_CACHE, getCacheTTL(env));
    return conditionalJson(c, info, getCacheTTL(env));
  } catch (err) {
    if (err instanceof ResourceNotFoundError) {
      await cacheSet(cacheKey, { data: null, negative: true }, env.WHOIS_CACHE, getNegTTL(env));
      return errResponse(c, 404, "IP not found");
    }
    if (err instanceof QueryDeniedError) return errResponse(c, 403, "Registry denied the query");
    const msg = err instanceof Error ? err.message : String(err);
    return errResponse(c, 502, `RDAP query failed: ${msg}`);
  }
}

async function handleASN(c: C, resource: string) {
  const upper = resource.toUpperCase();
  if (!isASN(upper)) return errResponse(c, 400, "Invalid ASN");

  const asn = asnNumber(upper);
  const cacheKey = `asn:${asn}`;
  const env = c.env;

  const cached = await cacheGet(cacheKey, env.WHOIS_CACHE);
  if (cached) {
    c.header("X-Cache", "HIT");
    if (cached.negative) {
      c.header("Cache-Control", `public, max-age=${getNegTTL(env)}`);
      return errResponse(c, 404, "ASN not found");
    }
    return conditionalJson(c, cached.data, getCacheTTL(env));
  }

  const rdapServer = lookupASNRdapServer(asn);
  if (!rdapServer) return errResponse(c, 404, "No RDAP server found for this ASN");

  try {
    const resp = await rdapQueryASN(String(asn), rdapServer);
    const info = parseRDAPASN(resp);
    await cacheSet(cacheKey, { data: info }, env.WHOIS_CACHE, getCacheTTL(env));
    return conditionalJson(c, info, getCacheTTL(env));
  } catch (err) {
    if (err instanceof ResourceNotFoundError) {
      await cacheSet(cacheKey, { data: null, negative: true }, env.WHOIS_CACHE, getNegTTL(env));
      return errResponse(c, 404, "ASN not found");
    }
    if (err instanceof QueryDeniedError) return errResponse(c, 403, "Registry denied the query");
    const msg = err instanceof Error ? err.message : String(err);
    return errResponse(c, 502, `RDAP query failed: ${msg}`);
  }
}

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Typed paths
app.get("/domain/:resource", (c) => handleDomain(c, c.req.param("resource").toLowerCase()));
app.get("/ip/:resource{.+}", (c) => handleIP(c, c.req.param("resource").toLowerCase()));
app.get("/autnum/:resource", (c) => handleASN(c, c.req.param("resource")));

// Root auto-detect: /example.com  /1.1.1.1  /AS13335
app.get("/:resource{.+}", async (c) => {
  const resource = c.req.param("resource").toLowerCase();
  if (isIP(resource) || isCIDR(resource)) return handleIP(c, resource);
  if (isASN(resource)) return handleASN(c, resource);
  if (isDomain(toASCII(resource) || resource)) return handleDomain(c, resource);
  return errResponse(c, 400, "Invalid input. Please provide a valid domain, IP, or ASN.");
});

// RPC entrypoint for service bindings. HTTP requests are served by the Hono app.
//   [[services]] binding = "WHOIS", service = "whois"
//   const info = await env.WHOIS.lookup("example.com");
export default class WhoisService extends WorkerEntrypoint<Env> {
  fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  // lookup returns parsed domain data, or null if the domain is not registered.
  // Accepts a bare domain, "@example.com", or an email address; IDNs are
  // converted to punycode. Throws on invalid input or upstream failure.
  async lookup(input: string): Promise<DomainInfo | null> {
    const name = input.trim().toLowerCase().split("@").pop() ?? "";
    const domain = toASCII(name) || name;
    if (!isDomain(domain)) throw new Error(`Invalid domain name: ${input}`);
    const { data } = await lookupDomain(domain, this.env);
    return data;
  }
}

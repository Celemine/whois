import { Hono, Context } from "hono";
import { Env } from "./types";
import { isDomain, isIP, isCIDR, isASN, toASCII, extractTLDs, asnNumber } from "./validate";
import { queryWhois } from "./whois";
import { rdapQueryDomain, rdapQueryIP, rdapQueryASN } from "./rdap";
import { cacheGet, cacheSet } from "./cache";
import { handleScheduled } from "./bootstrap";
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
      const whoisServer = await lookupWhoisServer(tld, env.WHOIS_CACHE);
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

  const cacheKey = `domain:${domain}`;

  const cached = await cacheGet(cacheKey, env.WHOIS_CACHE);
  if (cached) {
    c.header("X-Cache", "HIT");
    if (cached.negative) {
      c.header("Cache-Control", `public, max-age=${getNegTTL(env)}`);
      return errResponse(c, 404, "Domain not found");
    }
    return conditionalJson(c, cached.data, getCacheTTL(env));
  }

  const tlds = extractTLDs(domain);
  let result = null;

  // RDAP first — fall through to WHOIS on any failure (including 404) because
  // RDAP coverage can be incomplete even when WHOIS has full data.
  for (const tld of tlds) {
    const rdapServer = await lookupRdapServer(tld, env.WHOIS_CACHE);
    if (rdapServer) {
      try {
        const resp = await rdapQueryDomain(domain, rdapServer);
        result = parseRDAPDomain(resp);
        break;
      } catch (err) {
        if (err instanceof QueryDeniedError) return errResponse(c, 403, "Registry denied the query");
        // ResourceNotFoundError or any other error: fall through to WHOIS
      }
    }
  }

  // WHOIS fallback
  if (!result) {
    let hadWhoisServer = false;
    for (const tld of tlds) {
      const whoisServer = await lookupWhoisServer(tld, env.WHOIS_CACHE);
      if (!whoisServer) continue;
      hadWhoisServer = true;
      try {
        const rawText = await queryWhois(whoisServer, domain, getTimeout(env));
        result = parseWhoisResponse(rawText, domain, tld);
        break;
      } catch (err) {
        if (err instanceof DomainNotFoundError) {
          await cacheSet(cacheKey, { data: null, negative: true }, env.WHOIS_CACHE, getNegTTL(env));
          return errResponse(c, 404, "Domain not found");
        }
        const msg = err instanceof Error ? err.message : String(err);
        return errResponse(c, 502, `WHOIS query failed: ${msg}`);
      }
    }
    // No WHOIS server either — if RDAP had a server but said not-found, report 404
    if (!result && !hadWhoisServer) {
      await cacheSet(cacheKey, { data: null, negative: true }, env.WHOIS_CACHE, getNegTTL(env));
      return errResponse(c, 404, "Domain not found");
    }
  }

  if (!result) return errResponse(c, 404, "No WHOIS or RDAP server found for this domain");

  await cacheSet(cacheKey, { data: result }, env.WHOIS_CACHE, getCacheTTL(env));
  return conditionalJson(c, result, getCacheTTL(env));
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
  const rdapServer = await lookupIPRdapServer(lookupIP, env.WHOIS_CACHE);
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

  const rdapServer = await lookupASNRdapServer(asn, env.WHOIS_CACHE);
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

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleScheduled(env);
  },
};

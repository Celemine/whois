# whois-workers

[![中文文档](https://img.shields.io/badge/文档-中文版-blue)](README_ZH.md)
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/KincaidYang/whois-workers)

A WHOIS / RDAP lookup service running on Cloudflare Workers, built with TypeScript and [Hono](https://hono.dev). A Cloudflare Workers rewrite of [KincaidYang/whois](https://github.com/KincaidYang/whois).

Supports domain, IP address, and ASN queries. Results are returned as structured JSON.

## API

```
GET /domain/:name     # domain name (IDN supported, auto-converted to punycode)
GET /ip/:address      # IPv4, IPv6, or CIDR prefix (e.g. 1.1.1.0/24)
GET /autnum/:asn      # ASN in AS13335 or plain numeric form
GET /health           # health check
```

### Response examples

**Domain**

```jsonc
// GET /domain/example.com
{
  "objectClassName": "domain",
  "ldhName": "example.com",
  "registrar": "RESERVED-Internet Assigned Numbers Authority",
  "registrarIanaId": "376",
  "status": [
    "client delete prohibited",
    "client transfer prohibited",
    "client update prohibited"
  ],
  "registrationDate": "1995-08-14T04:00:00Z",
  "expirationDate": "2026-08-13T04:00:00Z",
  "lastChangedDate": "2026-01-16T18:26:50Z",
  "lastUpdateOfRdapDb": "2026-06-13T14:14:56Z",
  "nameservers": ["elliott.ns.cloudflare.com", "hera.ns.cloudflare.com"],
  "secureDNS": {
    "delegationSigned": true,
    "dsData": [
      {
        "keyTag": 2371,
        "algorithm": 13,
        "digestType": 2,
        "digest": "C988EC423E3880EB8DD8A46FE06CA230EE23F35B578D64E78B29C3E1C83D245A"
      }
    ]
  }
}
```

**IP**

```jsonc
// GET /ip/1.1.1.1
{
  "objectClassName": "ip network",
  "handle": "1.1.1.0 - 1.1.1.255",
  "startAddress": "1.1.1.0",
  "endAddress": "1.1.1.255",
  "cidr": "1.1.1.0/24",
  "name": "APNIC-LABS",
  "type": "ASSIGNED PORTABLE",
  "country": "AU",
  "status": ["active"],
  "registrationDate": "2011-08-10T23:12:35Z",
  "lastChangedDate": "2023-04-26T22:57:58Z",
  "remarks": [
    {
      "title": "description",
      "description": [
        "APNIC and Cloudflare DNS Resolver project",
        "Routed globally by AS13335/Cloudflare",
        "Research prefix for APNIC Labs"
      ]
    }
  ]
}
```

**ASN**

```jsonc
// GET /autnum/13335
{
  "objectClassName": "autnum",
  "handle": "AS13335",
  "name": "CLOUDFLARENET",
  "status": ["active"],
  "registrationDate": "2010-07-14T22:35:57Z",
  "lastChangedDate": "2017-02-17T23:04:32Z",
  "remarks": [
    {
      "title": "Registration Comments",
      "description": [
        "All Cloudflare abuse reporting can be done via https://www.cloudflare.com/abuse"
      ]
    }
  ]
}
```

## Caching

Query results are cached in Workers KV. Cache status is indicated by the `X-Cache` response header (`HIT` / `MISS`).

| Result | TTL |
|---|---|
| Found | 1 hour (configurable via `CACHE_TTL`) |
| Not found / error | 60 seconds (configurable via `NEGATIVE_CACHE_TTL`) |

## RDAP bootstrap

A Cron Trigger runs daily to fetch the latest IANA RDAP bootstrap data and write it to KV. This keeps the server registry up to date without redeployment.

## Supported WHOIS parsers

Dedicated parsers exist for the following TLDs; all others use a generic EPP-style parser.

`.cn` `.hk` `.tw` `.so` `.ru` `.su` `.sb` `.mo` `.au` `.sg` `.la` `.jp` `.eu` `.kr`
and their IDN equivalents (`.中国` `.香港` `.한국` etc.)

## Deployment

### One-click (recommended)

Click the **Deploy to Cloudflare Workers** button above. Cloudflare will fork this repository, create the required KV namespace automatically, and deploy the worker — no manual configuration needed.

### CLI

```bash
npm install

# Create a KV namespace
npx wrangler kv namespace create WHOIS_CACHE
# Paste the returned id into wrangler.toml [[kv_namespaces]] → id / preview_id

# Local development
npm run dev

# Deploy
npm run deploy
```

### Configuration (`wrangler.toml` vars)

| Variable | Default | Description |
|---|---|---|
| `WHOIS_TIMEOUT` | `10000` | WHOIS TCP timeout in milliseconds |
| `CACHE_TTL` | `3600` | Positive cache TTL in seconds |
| `NEGATIVE_CACHE_TTL` | `60` | Negative cache TTL in seconds |

## License

MIT

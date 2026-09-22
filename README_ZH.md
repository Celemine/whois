# whois-workers

[![English](https://img.shields.io/badge/Docs-English-blue)](README.md)
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/KincaidYang/whois-workers)

基于 Cloudflare Workers 的 WHOIS / RDAP 查询服务，使用 TypeScript 和 [Hono](https://hono.dev) 构建。[KincaidYang/whois](https://github.com/KincaidYang/whois) 的 Cloudflare Workers 重写版本。

支持域名、IP 地址、ASN 三类查询，结果以结构化 JSON 返回。

## 接口

```
GET /domain/:name     # 域名（支持 IDN，自动转换为 punycode）
GET /ip/:address      # IPv4、IPv6 或 CIDR 前缀（如 1.1.1.0/24）
GET /autnum/:asn      # ASN，支持 AS13335 或纯数字格式
GET /health           # 健康检查
```

### 响应示例

**域名**

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

## 缓存

查询结果缓存于 Workers KV，响应头 `X-Cache` 标识命中状态（`HIT` / `MISS`）。

| 结果 | TTL |
|---|---|
| 查询成功 | 1 小时（可通过 `CACHE_TTL` 配置） |
| 未找到 / 出错 | 60 秒（可通过 `NEGATIVE_CACHE_TTL` 配置） |

## RDAP Bootstrap

Cron Trigger 每日拉取 IANA 最新 RDAP bootstrap 数据并写入 KV，无需重新部署即可更新注册局映射。

## WHOIS 解析器

以下 TLD 有专用解析器，其余使用通用 EPP 格式解析器兜底。

`.cn` `.hk` `.tw` `.so` `.ru` `.su` `.sb` `.mo` `.au` `.sg` `.la` `.jp` `.eu` `.kr`
及其 IDN 对应（`.中国` `.香港` `.한국` 等）

## 部署

### 一键部署（推荐）

点击上方 **Deploy to Cloudflare Workers** 按钮，Cloudflare 会自动 fork 仓库、创建所需的 KV namespace 并完成部署，无需任何手动配置。

### CLI 部署

```bash
npm install

# 创建 KV namespace
npx wrangler kv namespace create WHOIS_CACHE
# 将返回的 id 填入 wrangler.toml [[kv_namespaces]] 的 id / preview_id

# 本地开发
npm run dev

# 部署
npm run deploy
```

### 配置项（`wrangler.toml` vars）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WHOIS_TIMEOUT` | `10000` | WHOIS TCP 超时（毫秒） |
| `CACHE_TTL` | `3600` | 正缓存 TTL（秒） |
| `NEGATIVE_CACHE_TTL` | `60` | 负缓存 TTL（秒） |

## License

MIT

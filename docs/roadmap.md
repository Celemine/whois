# MVP Roadmap — whois on Cloudflare Workers

路径 A（Workers TypeScript 重写），范围：**核心查询 MVP**。
背景与可行性结论见 [feasibility.md](./feasibility.md)。

## 范围

**做：** domain / ip / asn 三种单条查询 + KV 缓存（正/负缓存 TTL）+ IANA bootstrap（Cron 写 KV）+ 基础错误处理 / 超时 / 2MiB 上限。
**砍（后续里程碑再议）：** batch 批量、MCP、Prometheus、Redis、内存 LRU、API Key 鉴权、限流、优雅关闭。

## 目标项目结构

```
whois-workers/
  wrangler.toml          # KV namespace 绑定、Cron Trigger、vars
  package.json
  tsconfig.json
  src/index.ts           # Hono app + 路由 + scheduled() 入口
  src/whois.ts           # connect() TCP:43 查询（端口43、超时、2MiB cap）
  src/rdap.ts            # fetch RDAP（2MiB cap、404/403 处理）
  src/servers.ts         # TLD→server 映射常量（移植自 serverlist/*.go）
  src/validate.ts        # 域名/ASN 校验 + IDN→punycode + 复合 TLD 回退
  src/parsers/           # 逐 TLD 移植 whois_parsers.go + RDAP 解析
  src/cache.ts           # KV 读写 + TTL
  src/bootstrap.ts       # scheduled handler：拉 IANA → 写 KV
  docs/                  # 本目录（调研 + roadmap）
```

## 里程碑

### M0 — 脚手架
- `npm create cloudflare` 或手建：`wrangler.toml`、`package.json`、`tsconfig.json`、Hono 依赖。
- 绑定：KV namespace（缓存）、Cron Trigger（bootstrap）、vars（超时 / TTL / bootstrap 间隔）。

### M1 — 查询核心（跑通单条）
- `src/whois.ts`：`connect()` TCP:43，写 `domain\r\n`，读到 EOF，10s 超时，2MiB 截断（对照 `whois_query.go`）。
- `src/rdap.ts`：`fetch` RDAP，处理 200/404/403，2MiB 截断（对照 `rdap_query.go`）。
- `src/servers.ts`：移植 `serverlist/*.go` 的 TLD→server 映射常量。
- `src/validate.ts`：域名/ASN 校验 + IDN→punycode + 复合 TLD 回退（对照 `main.go` 的 isDomain/isASN）。
- `src/index.ts`：Hono 路由 `/domain/:r`、`/ip/:r`、`/autnum/:r`，接 whois/rdap。

### M2 — 解析器移植（价值与工作量大头）
- `src/parsers/`：逐 TLD 移植 `whois_parsers.go`（CN/HK/TW/SO/RU/SB/MO/AU/SG/LA/JP…）+ RDAP 解析。
- 对照 Go 版做字段级 diff 测试。

### M3 — 缓存
- `src/cache.ts`：KV 读写，正缓存 TTL（默认 3600s）/负缓存 TTL（默认 60s），命中标记 header。

### M4 — bootstrap
- `src/bootstrap.ts`：`scheduled()` 拉 IANA `data.iana.org/rdap/{dns,ipv4,ipv6,asn}.json` → 写 KV（对照 `bootstrap.go`）。
- 查询时优先读 KV 覆盖层，回退内置常量。

### M5 — 风险验证 & 部署
- `wrangler dev` 实测 `connect()` 对线上 WHOIS 服务器连通性 / 延迟。
- 确认打包体积不超脚本上限（超则把 servers 映射移到 KV）。
- 部署 workers.dev 预览，三类查询与 Go 版对拍。

## 关键移植参照（保持行为一致）

| TS 文件 | 对照 Go 源（在源仓库 `whois/`） |
|---|---|
| `src/whois.ts` | `internal/whois/whois_query.go` |
| `src/parsers/` | `internal/whois/whois_parsers.go` + `internal/rdap/` 解析 |
| `src/rdap.ts` | `internal/rdap/rdap_query.go` |
| `src/bootstrap.ts` | `internal/serverlist/bootstrap.go` |
| `src/servers.ts` | `internal/serverlist/whois_servers.go` / `rdap_servers.go` |
| `src/validate.ts` | `main.go`（isDomain / isASN / 复合 TLD 回退） |

## Verification（端到端）

1. `wrangler dev` 本地起 Worker，`curl localhost:8787/domain/example.com`、`/ip/1.1.1.1`、`/autnum/13335` 验证三类查询。
2. 对照 Go 服务输出做 diff，重点核对各 TLD WHOIS 解析字段。
3. `wrangler dev --test-scheduled` 触发 `scheduled()` 验证 IANA bootstrap 写入 KV。
4. 二次查询验证 KV 命中（X-Cache 类似标记）与负缓存 TTL。
5. 部署 workers.dev 预览，验证 `connect()` 在真实边缘对线上 WHOIS 服务器连通。

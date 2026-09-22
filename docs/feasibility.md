# 调研报告：把 whois 服务搬到 Cloudflare Workers 的可行性

> 源项目：`github.com/KincaidYang/whois`（Go HTTP 服务，本目录是其 Workers 重写的新家）
> 结论日期：2026-06-13

## Context

源项目是一个 **Go HTTP 服务**：域名 / IP / ASN 的 WHOIS + RDAP 查询 API，带 Redis + 内存两级缓存、IANA bootstrap 定时刷新、Prometheus 指标、MCP endpoint、API Key 鉴权与限流。本报告评估把它搬到 Cloudflare Workers 的可行性并给出实施路径。

---

## 核心结论（一句话）

**Workers 不能跑 Go。** 把项目“放到 Workers”不是镜像迁移，而是**用 TypeScript 从零重写**。技术上可行（最大阻塞点 WHOIS:43 可用 `connect()` 解决），但工作量等同重写一份。若只想最小改动上 Cloudflare 边缘，应选 **Cloudflare Containers** 而非 Workers。

---

## 为什么不能直接搬 Go

- Workers 运行时是 V8 isolate，只跑 **JS/TS 或 WASM**，没有 OS 线程、没有文件系统、没有常驻进程。
- 标准 `GOOS=js GOARCH=wasm`：**`net` 包不可用** → 没有 TCP、没有 `net/http` 出站；且拿不到 Workers 的绑定 API。
- TinyGo → WASM/WASI：网络同样缺失，goroutine 调度受限。
- 结论：`net.Dial`(WHOIS)、`http.Client`(RDAP)、go-redis、后台 goroutine 全部落地不了 → **不存在“编译一下就上”的路径**。

---

## 逐组件可移植性（Workers 重写视角）

| 组件 | 现状(Go) | Workers 可行性 | 替代方案 |
|---|---|---|---|
| WHOIS 查询 | `net.Dialer` TCP:43，10s 超时，2MiB 上限 (`internal/whois/whois_query.go`) | ✅ 可行 | `connect()`（`cloudflare:sockets`），**全计划可用，非企业专属**；端口 43 允许出站 |
| RDAP 查询 | `net/http` GET，2MiB 上限 (`internal/rdap/rdap_query.go`) | ✅ 直接 | `fetch()` |
| TLD→server 映射 | 编译进二进制的大 map（whois_servers.go 881 行 / rdap_servers.go 1623 行，约 60KB）(`internal/serverlist/`) | ✅ 直接 | 作为 TS 常量打包；超脚本大小上限就移到 KV |
| IANA bootstrap 刷新 | 常驻 goroutine + Ticker，默认 86400s (`internal/serverlist/bootstrap.go`) | 🔴 重设计 | **Cron Trigger** 定时拉 IANA → 写 KV |
| Redis 缓存 | go-redis TCP + 30s 健康检查 goroutine (`internal/utils/redis_cache.go`) | 🔴 替换 | **Workers KV**（读多写少，最贴合 WHOIS 缓存）；强一致/限流用 Durable Object；要 Redis 则换 Upstash(HTTP) |
| 内存 LRU 缓存 | 进程内 map+链表 + 清理 goroutine (`internal/utils/cache_interface.go`) | ❌ 失效 | isolate 临时、跨请求不保留 → 用 KV 取代 |
| 鉴权 / CORS / RequestID | 中间件装饰器链 (`main.go`) | ✅ 直接 | Hono 中间件 |
| 限流 | 每 key `rate.Limiter` | ⚠️ 重设计 | Cloudflare 原生 Rate Limiting 或 Durable Object（MVP 不做） |
| 路由 | `http.ServeMux` 路径参数 | ✅ 直接 | Hono 路由 |
| Prometheus 指标 | 进程内累加 `/metrics` (`internal/metrics/`) | ⚠️ 不适用 | Workers Analytics Engine（MVP 不做） |
| MCP endpoint | go-sdk Streamable HTTP/SSE (`internal/mcp/`) | ⚠️ 可行但复杂 | Workers 支持流式响应；MVP 不做 |
| 优雅关闭 / 信号 | SIGTERM + WaitGroup (`main.go`) | ❌ 不适用 | Workers 无信号，请求级 context 即可 |
| 配置 | 启动读 config.yaml/json (`internal/config/`) | ✅ 已支持 env | `wrangler.toml` vars + Secrets（源项目已有 `WHOIS_*` 覆盖逻辑） |

---

## 两条候选路径

### 路径 A — Workers TypeScript 重写（贴合“Workers”，但等于重写）★本项目选定
栈：**Hono**（路由/中间件）+ `cloudflare:sockets` connect()（WHOIS）+ fetch（RDAP）+ **Workers KV**（缓存）+ **Cron Trigger**（IANA bootstrap）。
- 最有价值且最费时的是**各 TLD 的 WHOIS 文本解析器**（`internal/whois/whois_parsers.go`，CN/HK/TW/SO/RU/SB/MO/AU/SG/LA/JP 等）和 RDAP 解析——必须逐个用 TS 重写并重新测。
- 估算（MVP 范围）：**约 1.5–2.5k 行新 TS** + 端到端联调。

### 路径 B — Cloudflare Containers 跑现有 Go（最小改动）
2025 年 GA 的 Cloudflare Containers 可几乎原样跑现有 Docker 镜像（已有 `Dockerfile`），Redis/后台 goroutine/MCP/Prometheus **全部保留**，前面挂一个 Worker 做路由/绑定。
- 代价：不是传统 Workers（有冷启动、计费模型不同、并非纯边缘 isolate），但**代码几乎不改**。
- 若真实诉求是“上 Cloudflare、少改代码”，这是更优解。

---

## 选定方案

- **路径 A（Workers TS 重写）**，范围 **核心查询 MVP**。
- 独立目录 `/root/dev/whois-workers/`（非分支、非源仓库子目录）：TS/Workers 与 Go 主线两套栈永不 merge；独立目录也让记忆/CI 隔离，不污染源仓库。
- 详细里程碑见 [roadmap.md](./roadmap.md)。

---

## 需提前验证的风险

1. `connect()` 对常见 WHOIS 服务器（如 `whois.verisign-grs.com:43`、各注册局）的实际连通性与延迟。
2. 脚本体积：servers 映射若使打包超出 Workers 脚本大小上限，则改放 KV。

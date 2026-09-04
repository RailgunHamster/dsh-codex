# dsh-codex（中文说明）

[DSH（DeepSeek Harness）](https://www.npmjs.com/package/@deepseek-ai/dsh) 的 Codex 分流插件。

在 DSH 进程内包装 `globalThis.fetch`，按主机名分流：

- 白名单域名（默认 `chatgpt.com`、`auth.openai.com`）的请求经 **上游代理** 隧道转发（例如本地 Clash 混合端口）——OpenAI/ChatGPT 端点有地区限制时必需；
- **其余所有请求走原始 fetch，完全不受影响**——其他模型供应商、软件源等保持原有网络路径；
- 回环地址永不转发。

**零启动要求**：不需要环境变量、不需要启动脚本、不改系统代理。随便怎么启动 `dsh web`，分流都在进程内自动完成。

## 安装

```sh
dsh plugin --profile web add github:RailgunHamster/dsh-codex
```

（或本地目录：`dsh plugin --profile web add file:D:/git/dsh-codex`）

装完重启 `dsh web`。bundle patch 会挂载一个宿主插件行（`codex`）并带一个设置页。

## 路由要求：`transport: sse`

pi-ai 的 Codex 后端默认（`auto`）优先用 **WebSocket**，而 WebSocket 不经过 fetch。需在 `$DSH_HOME/settings.yaml` 的 `openai-codex` 路由上强制走基于 fetch 的 SSE 通道：

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      displayName: ChatGPT Codex
      transport: sse
```

SSE 端点就是官方客户端的退路（含 zstd 请求压缩），OAuth 换 token（`auth.openai.com`）和模型调用（`chatgpt.com/backend-api`）都会遵循分流规则。

## 配置

DSH 网页界面 设置 → **Codex**：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| 启用 | 开 | 是否启用分流 |
| 上游代理 | `http://127.0.0.1:7890` | **仅**白名单域名使用的上游代理 |
| 走代理的域名 | `chatgpt.com`、`auth.openai.com` | 走上游的域名后缀（子域自动匹配） |

配置保存在 `$DSH_HOME/settings.yaml` 的 `codex:` 命名空间下，**保存即生效**（包装器每次请求都读当前配置），无需重启。

## 原理

`dsh-llm-pi-ai`（pi-ai）把 OAuth 端点 `https://auth.openai.com` 和 API 端点 `https://chatgpt.com/backend-api` 写死在代码里，两者都会拒绝受限地区的流量；而 Node 全局 fetch 没有按请求挂钩子的能力，把 `HTTP(S)_PROXY` 直接指向 VPN 客户端又会让 harness 的**全部**流量出国。本插件在进程内包装 fetch（与 `dsh-grok-adaptation` 同一技术）：白名单域名的 https 请求使用一个连接为 `CONNECT` 隧道的 `https.Agent` 走上游代理，其余请求原样放行。支持流式响应（SSE）、请求/响应压缩处理和 abort 信号。

## 安全范围

- 不涉及任何密钥、凭据——插件只路由字节。
- 不会触碰或配置你的 VPN 客户端；上游地址由你自己填写。
- 上游代理没开时，仅白名单域名不可用，其余流量不受影响。

## 许可证

MIT

# dsh-codex（中文说明）

[DSH（DeepSeek Harness）](https://www.npmjs.com/package/@deepseek-ai/dsh) 的 Codex 分流代理插件。

在 DSH 进程内运行一个极小的本地 HTTP 转发代理，按主机名分流：

- 白名单域名（默认 `chatgpt.com`、`auth.openai.com`）链到**上游代理**（例如本地 Clash 混合端口）——OpenAI/ChatGPT 端点有地区限制时必需；
- **其余所有目标一律直连**——其他模型供应商、软件源等保持原有网络路径；
- 回环地址永不走代理。

启动时让 Node 的全局 fetch 指向它，整套 harness（模型调用、OAuth 换 token、token 刷新）就都遵循这个分流规则，完全不碰系统代理。

## 安装

```sh
dsh plugin --profile web add github:RailgunHamster/dsh-codex
```

（或本地目录：`dsh plugin --profile web add file:D:/git/dsh-codex`）

装完重启 `dsh web`。bundle patch 会挂载一个宿主插件行（`codex`）并带一个设置页。

## 启动环境变量

Node 24+ 的内置 env-proxy 让全局 fetch 遵循代理变量：

```powershell
$env:NODE_USE_ENV_PROXY = '1'
$env:HTTP_PROXY  = 'http://127.0.0.1:17890'
$env:HTTPS_PROXY = 'http://127.0.0.1:17890'
$env:NO_PROXY    = 'localhost,127.0.0.1,::1'
dsh web
```

- `17890` 是插件默认监听端口，需与设置页的「监听端口」一致。
- 回环必须留在 `NO_PROXY`：浏览器 GUI 的 websocket 和 OAuth 回调监听（`localhost:1455`）不能经过任何代理。
- 国内外低延迟供应商也可加进 `NO_PROXY` 完全绕过转发器（可选——不在白名单的流量本来就直连）。

## 配置

DSH 网页界面 设置 → **Codex**：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| 启用 | 开 | 是否运行监听 |
| 监听地址 / 监听端口 | `127.0.0.1:17890` | 转发代理监听位置 |
| 上游代理 | `http://127.0.0.1:7890` | **仅**白名单域名使用的上游代理 |
| 走代理的域名 | `chatgpt.com`、`auth.openai.com` | 走上游的域名后缀（子域自动匹配） |

配置保存在 `$DSH_HOME/settings.yaml` 的 `codex:` 命名空间下，保存后**热生效**（监听器自动重启），无需重启 DSH。

## 为什么需要按主机名分流？

`dsh-llm-pi-ai`（pi-ai）的 OpenAI Codex 供应商把 OAuth 端点 `https://auth.openai.com` 和 API 端点 `https://chatgpt.com/backend-api` 写死在代码里，两者都会拒绝受限地区的流量；而 Node 全局 fetch 没有按请求挂钩子的能力，把 `HTTP(S)_PROXY` 直接指向 VPN 客户端又会让 harness 的**全部**流量出国。本插件就是中间层：一个只做「这两个域名走上游、其它都直连」的代理。

## 安全范围

- 不涉及任何密钥、凭据——插件只转发字节。
- 不会触碰或配置你的 VPN 客户端；上游地址由你自己填写。
- 上游代理没开时，仅白名单域名不可用，其余流量不受影响。

## 许可证

MIT

# 多机器部署说明

## 目标

把 `chrome-bridge-mcp` 推广到同一网络中的其它 Mac，让每台机器上的 Codex、Claude Code、pi/raft pi 都可以通过本机真实 Chrome 使用 Google 搜索和 Google AI。

## 核心原则

1. 项目代码可以复制或同步到多台机器。
2. Chrome profile、Google 登录态、会话状态和报告属于本机运行态，不能共享。
3. 每台机器默认使用自己的 `~/runtime/.chrome-bridge-mcp`。
4. Chrome CDP 默认只监听 `127.0.0.1:9222`，不要直接暴露到局域网或公网。
5. 人工登录、验证码和授权在各机器自己的 Chrome profile 中完成。
6. 同一件事尽量复用一个 Google task tab；结束时由用户明确使用 `#g end` 或对应工具关闭。

## 目录约定

每台 Mac 建议保持一致目录：

```text
~/ai/chrome-bridge-mcp
~/runtime/.chrome-bridge-mcp
~/runtime/.chrome-bridge-mcp/ChromeProfile
~/runtime/.chrome-bridge-mcp/logs
```

pi/raft pi 的本地运行态：

```text
~/runtime/.pi/agent
~/.pi -> ~/runtime/.pi
```

## 已验证事实

当前本机已验证：

- Claude Code user-scope MCP：`chrome-bridge` Connected。
- Claude Code 实际调用 `chrome_status` 成功。
- Codex 已配置 `chrome_bridge` MCP。
- pi extension 已能调用 Google 搜索和 Google AI 工具。
- 单元测试：32/32 通过。
- 默认 E2E：13/13 通过。
- Google 可选 E2E 和真实 Google/Google AI 验收曾通过。

其它机器部署后必须各自验证，不能因为本机通过就宣称全网机器可用。

## 前置条件

每台 Mac 需要：

- Google Chrome 安装在 `/Applications/Google Chrome.app`。
- Node.js 22+，或存在 Codex bundled Node：

```text
~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
```

- 需要接入的客户端：
  - Claude Code：`claude`
  - Codex：按本机 Codex 配置方式
  - pi/raft pi：`~/runtime/.pi/agent`

## 部署项目代码

推荐先把项目目录同步到目标机器：

```bash
mkdir -p ~/ai
# 使用你当前的同步方式，把项目放到：
# ~/ai/chrome-bridge-mcp
```

不要把 `~/runtime/.chrome-bridge-mcp` 从一台机器复制到另一台机器。每台机器应该自己登录 Google，自己维护 Chrome profile。

## 启动本机 Chrome profile

手工启动：

```bash
~/ai/chrome-bridge-mcp/scripts/start-chrome-bridge-profile.sh
```

可选：安装用户级 LaunchAgent，让登录系统时自动启动托管 Chrome profile：

```bash
~/ai/chrome-bridge-mcp/scripts/install-launch-agent.sh
```

该脚本会按当前机器的 `$HOME` 动态生成：

```text
~/Library/LaunchAgents/com.chrome-bridge.mcp.plist
```

## Claude Code 接入

在每台机器上运行：

```bash
~/ai/chrome-bridge-mcp/scripts/install-claude-mcp.sh
```

验证：

```bash
claude mcp get chrome-bridge
```

应看到：

```text
Scope: User config
Status: Connected
```

本项目还提供 Claude Code 自定义命令源文件：

```text
~/.claude/commands/google.md
```

如果目标机器没有该命令，可以复制当前机器的命令文件，或在后续补充统一安装脚本。

## Codex 接入

先生成当前机器适用的配置片段：

```bash
~/ai/chrome-bridge-mcp/scripts/print-codex-mcp-config.sh
```

把输出合并到：

```text
~/.codex/config.toml
```

然后重启 Codex 或新开 Codex 会话。

## pi / raft pi 接入

安装 extension：

```bash
~/ai/chrome-bridge-mcp/scripts/install-pi-extension.sh
```

如果目标机器尚未建立 `~/.pi` 兼容软链接，可执行：

```bash
mkdir -p ~/runtime/.pi
ln -sfn ~/runtime/.pi ~/.pi
```

已有 pi/raft pi session 需要重启，才能加载新 extension。

## 验证

基础检查：

```bash
~/ai/chrome-bridge-mcp/scripts/detect-node-bin.sh
```

MCP 直接测试：

```bash
NODE="$(~/ai/chrome-bridge-mcp/scripts/detect-node-bin.sh)"
"$NODE" ~/ai/chrome-bridge-mcp/bin/chrome-bridge-cli.js status
```

单元测试：

```bash
NODE="$(~/ai/chrome-bridge-mcp/scripts/detect-node-bin.sh)"
cd ~/ai/chrome-bridge-mcp
"$NODE" --test ./test/unit.test.js
```

默认 E2E：

```bash
NODE="$(~/ai/chrome-bridge-mcp/scripts/detect-node-bin.sh)"
cd ~/ai/chrome-bridge-mcp
"$NODE" ./test/run-e2e.js
```

真实 Google 搜索验收：

```bash
NODE="$(~/ai/chrome-bridge-mcp/scripts/detect-node-bin.sh)"
cd ~/ai/chrome-bridge-mcp
"$NODE" ./scripts/manual-google-flow.js "Chrome DevTools Protocol"
```

真实 Google AI 验收：

```bash
NODE="$(~/ai/chrome-bridge-mcp/scripts/detect-node-bin.sh)"
cd ~/ai/chrome-bridge-mcp
"$NODE" ./scripts/manual-google-ai-chat.js "用中文解释 Chrome DevTools Protocol，并给出三个适合自动化测试的应用场景"
```

## 网络边界

默认不建议让别的机器直接连接某台 Mac 的 `9222` 端口。正确模型是：

```text
每台 Mac 本机 agent -> 本机 chrome-bridge MCP -> 本机 127.0.0.1:9222 -> 本机 Chrome
```

如果未来要做跨机器浏览器代理，必须另行设计认证、授权、审计和 Tailscale/IP 访问边界，不能直接把 CDP 端口暴露出去。

## 边界声明

- 本说明适用于 macOS。
- 目标机器是否安装 Claude Code、Codex、pi/raft pi，需要逐台确认。
- 目标机器 Google 登录态需要本机人工完成。
- `install-claude-mcp.sh` 会修改 Claude Code user config。
- `install-pi-extension.sh` 会写入 `~/runtime/.pi/agent/extensions/chrome-bridge-google.ts`。
- `print-codex-mcp-config.sh` 只打印配置片段，不直接修改 Codex 配置。

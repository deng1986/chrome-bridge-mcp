# 部署说明

本项目将开发产物保留在项目目录中，运行态统一放在本机 AI runtime 根目录下。

## 目录布局

开发工作区：

```text
/Users/deng/ai/chrome-bridge-mcp
```

运行态数据：

```text
~/runtime/.chrome-bridge-mcp
~/runtime/.chrome-bridge-mcp/ChromeProfile
~/runtime/.chrome-bridge-mcp/logs
```

可选的用户级 LaunchAgent：

```text
~/Library/LaunchAgents/com.deng.chrome-bridge-mcp.plist
```

## 清理策略

不要直接删除过期运行态或垃圾文件。先移动到：

```text
~/tmp/trash
```

移动时使用带时间戳的目录名，方便人类之后统一检查和手动删除。

## 启动交互用 Chrome

使用项目脚本：

```bash
/Users/deng/ai/chrome-bridge-mcp/scripts/start-chrome-bridge-profile.sh
```

该脚本会启动 Chrome，并使用：

- CDP 端点：`127.0.0.1:9222`
- Profile：`~/runtime/.chrome-bridge-mcp/ChromeProfile`

登录、验证码、授权确认和其他人工验证都应该在这个 Chrome 窗口里完成。

## MCP Server

MCP Server 通常由 Claude Code 或 Codex 通过 stdio 启动，不需要作为常驻 daemon 独立运行。

命令：

```bash
/Users/deng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /Users/deng/ai/chrome-bridge-mcp/src/server.js
```

环境变量：

```text
CHROME_BRIDGE_PORT=9222
CHROME_BRIDGE_AUTO_START=1
CHROME_BRIDGE_RUNTIME=/Users/deng/runtime/.chrome-bridge-mcp
```

启用 `CHROME_BRIDGE_AUTO_START=1` 后，如果 Claude Code 或 Codex 调用工具时 Chrome CDP 尚未启动，MCP Server 会自动启动托管 Chrome。运行态仍然使用：

```text
~/runtime/.chrome-bridge-mcp/ChromeProfile
```

## AI 客户端接入状态

- Claude Code：已通过 `claude mcp add -s user ... chrome-bridge` 接入用户级配置，`claude mcp list` 显示 Connected；`~/.claude/commands/google.md` 提供 `/google` 命令，记录 `#g` 和 Google task tab 复用规则。
- Codex：已写入 `~/.codex/config.toml` 的 `[mcp_servers.chrome_bridge]`。Codex 需要新开会话或重启后加载这个 MCP server。
- pi / raft pi：已在 `~/runtime/.pi/agent/extensions/chrome-bridge-google.ts` 部署 extension；`~/.pi` 是指向 `~/runtime/.pi` 的兼容软链接。

加载后可以在 Codex 或 Claude Code 中直接说：

```text
用 Google AI 多轮讨论“……”，先问第一轮，然后根据回答继续追问。
```

助理应使用会话层工具 `start_google_ai_session`、`continue_google_ai_session`、`read_google_ai_session` 和 `end_google_ai_session`，而不是要求你手工复制粘贴 Chrome 内容。

pi extension 暴露的工具名是：

```text
google_search
google_ai_start
google_ai_continue
google_ai_read
google_ai_end
google_ai_export
```

如果 raft/pi 中已经存在配置前启动的 session，需要重开 session 才会加载新 extension。

## 多机器部署

多台 Mac 推广部署见：

```text
docs/MULTI_MACHINE_DEPLOYMENT.md
```

当前项目提供的可复制安装脚本：

- `scripts/install-claude-mcp.sh`
- `scripts/install-pi-extension.sh`
- `scripts/print-codex-mcp-config.sh`
- `scripts/install-launch-agent.sh`

## 可选 LaunchAgent

如果希望登录系统时自动启动 bridge 专用 Chrome profile，可以安装 LaunchAgent 模板：

```bash
/Users/deng/ai/chrome-bridge-mcp/scripts/install-launch-agent.sh
```

脚本会将项目模板复制到：

```text
~/Library/LaunchAgents/com.deng.chrome-bridge-mcp.plist
```

然后通过 `launchctl bootstrap` 加载。

LaunchAgent 描述文件必须位于 `~/Library/LaunchAgents`，这是 launchd 查找用户级 agent 的系统约定。它只负责启动 Chrome；所有 Chrome 运行态仍然保存在 `~/runtime/.chrome-bridge-mcp`。MCP Server 仍应由 AI 客户端通过 stdio 启动。

## 卸载 LaunchAgent

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.deng.chrome-bridge-mcp.plist"
rm "$HOME/Library/LaunchAgents/com.deng.chrome-bridge-mcp.plist"
```

过期运行态目录不要直接删除，移动到 trash：

```bash
mkdir -p "$HOME/tmp/trash"
mv "$HOME/runtime/.chrome-bridge-mcp" "$HOME/tmp/trash/chrome-bridge-mcp.$(date +%Y%m%d-%H%M%S)"
```

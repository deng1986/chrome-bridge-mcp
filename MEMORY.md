## Active Context
<!-- CHECKPOINT START -->
{"last_channel":"codex-desktop","active_channels":["codex-desktop"],"claimed_tasks":[],"pending_action":"awaiting:user next request; 多机器推广准备完成：新增 MULTI_MACHINE_DEPLOYMENT.md、Claude/pi/Codex 安装辅助脚本、项目内 Claude/pi integration 源文件；尚未实际 SSH 修改其它机器","last_seq":{"codex-desktop":0},"ts":"2026-06-23T11:38:00+08:00"}
<!-- CHECKPOINT END -->

## 项目备注

- 开发工作区：`/Users/deng/ai/chrome-bridge-mcp`
- 运行态根目录：`~/runtime/.chrome-bridge-mcp`
- Chrome 运行时 profile：`~/runtime/.chrome-bridge-mcp/ChromeProfile`
- 日志：`~/runtime/.chrome-bridge-mcp/logs`
- 可选 LaunchAgent 安装目标：`~/Library/LaunchAgents/com.deng.chrome-bridge-mcp.plist`
- 避免将项目运行态直接放在 `~` 下。
- 清理策略：废弃产物先移动到 `~/tmp/trash`，默认不直接删除。
- 自动化测试：`test/unit.test.js`、`test/run-e2e.js`
- 覆盖率门槛：行 80%，函数 80%，分支 70%
- 最近测试结果：shell 脚本语法检查通过；Node 语法检查通过；单元 32/32，通过率 100%；默认 E2E 13/13。Google task tab 支持当前活跃标签页复用；新增单元测试验证连续搜索第二次走 `Page.navigate` 而不是 `/json/new`。
- 最新报告：`reports/e2e-2026-06-23T11-37-19-518Z.md`、`reports/e2e-2026-06-23T02-16-07-689Z.md`、`reports/manual-google-2026-06-23T02-06-22-428Z.md`、`reports/manual-google-ai-chat-2026-06-23T02-06-26-067Z.md`
- AI 客户端接入：Claude Code `chrome-bridge` 已写入 user-scope MCP 配置，`claude mcp get chrome-bridge` 显示 Connected，并通过 `claude -p` 实际调用 `chrome_status`；`~/.claude/commands/google.md` 提供 `/google` 命令。Codex 已写入 `~/.codex/config.toml`，需要新开会话或重启 Codex 后加载。
- 对话前缀试行规则：使用 `#g` 而不是 `@g`，因为 Codex 输入框中 `@` 会触发文件/插件选择器。`#g new <话题>` 新开会话，`#g <内容>` 继续当前会话，`#g read` 读取状态，`#g export` 导出当前记录，`#g end` 导出并关闭对应 Chrome 标签页。
- pi / raft pi 接入：`~/runtime/.pi/agent/extensions/chrome-bridge-google.ts` 已部署，暴露 `google_search`、`google_ai_start`、`google_ai_continue`、`google_ai_read`、`google_ai_end`、`google_ai_export`；`~/.pi -> ~/runtime/.pi` 用作 pi 默认目录兼容。
- 多机器部署：`docs/MULTI_MACHINE_DEPLOYMENT.md` 已新增；`scripts/install-claude-mcp.sh`、`scripts/install-pi-extension.sh`、`scripts/print-codex-mcp-config.sh`、`scripts/detect-node-bin.sh` 已新增；pi extension 源文件在 `integrations/pi/chrome-bridge-google.ts`；Claude `/google` 源文件在 `integrations/claude/commands/google.md`。

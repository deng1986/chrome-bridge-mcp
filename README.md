# chrome-bridge-mcp

连接 Codex / Claude Code 和真实 Chrome 会话的本地 MCP 桥接服务。

它通过 `127.0.0.1:9222` 上的 Chrome DevTools Protocol 连接 Chrome。登录、验证码、授权确认等动作仍然在真实 Chrome 里完成；AI 助理负责打开或复用任务标签页、执行 Google 搜索、读取当前页面、读取选中文本，以及运行少量页面内 JavaScript。

## 启动 Chrome

使用独立 Chrome profile，让调试端口和日常浏览器配置隔离：

```bash
$HOME/ai/chrome-bridge-mcp/scripts/start-chrome-bridge-profile.sh
```

可以在这个 Chrome 窗口里正常登录、验证和授权。

profile 路径：

```text
~/runtime/.chrome-bridge-mcp/ChromeProfile
```

## 运行 MCP Server

本项目没有 npm 依赖。使用 Node.js 22+ 运行：

```bash
node $HOME/ai/chrome-bridge-mcp/src/server.js
```

在当前 Codex 环境里，即使 Homebrew Node 损坏，也可以使用 Codex bundled Node：

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/src/server.js
```

## Claude Code

添加到 Claude Code 用户级配置，让所有 Claude Code 工作目录都可用：

```bash
claude mcp add -s user --transport stdio chrome-bridge \
  --env CHROME_BRIDGE_PORT=9222 \
  --env CHROME_BRIDGE_AUTO_START=1 \
  --env CHROME_BRIDGE_RUNTIME=$HOME/runtime/.chrome-bridge-mcp \
  -- $HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/src/server.js
```

然后检查 MCP 连接：

```text
/mcp
```

本机还提供了 Claude Code 自定义命令：

```text
/google
```

命令文件位于 `~/.claude/commands/google.md`，用于提醒 Claude 使用 `chrome-bridge` 工具执行 Google 搜索、Google AI 多轮讨论、`#g` 前缀、当前 Google task tab 复用和 `#g end` 关闭规则。

## Codex

已在本机 Codex 配置中加入：

```toml
[mcp_servers.chrome_bridge]
command = "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
args = ["$HOME/ai/chrome-bridge-mcp/src/server.js"]
startup_timeout_sec = 30

[mcp_servers.chrome_bridge.env]
CHROME_BRIDGE_PORT = "9222"
CHROME_BRIDGE_AUTO_START = "1"
CHROME_BRIDGE_RUNTIME = "$HOME/runtime/.chrome-bridge-mcp"
```

Codex 需要新开会话或重启后才会加载新 MCP server。加载后可以直接在对话里说：

```text
用 Google AI 多轮讨论“……”，先问第一轮，然后根据回答继续追问。
```

助理应优先使用会话层工具 `start_google_ai_session`、`continue_google_ai_session`、`read_google_ai_session` 和 `end_google_ai_session`，而不是让你手工复制粘贴浏览器内容。

## pi / raft pi

本机 pi 使用全局 extension 接入 Google 能力。真实配置目录放在：

```text
~/runtime/.pi/agent
```

为了兼容 pi 默认读取 `~/.pi/agent` 的行为，本机建立了软链接：

```text
~/.pi -> ~/runtime/.pi
```

extension 文件：

```text
~/runtime/.pi/agent/extensions/chrome-bridge-google.ts
```

它把本项目 CLI 包装成 pi 工具：

- `google_search`：真实 Chrome 中搜索 Google，并返回结构化结果；同一件事优先复用当前 Google task tab
- `google_ai_start`：新开 Google AI Mode 会话，返回 `sessionId`
- `google_ai_continue`：继续追问；可省略 `sessionId`，默认使用当前活跃会话
- `google_ai_read`：读取已有 Google AI 会话；可省略 `sessionId`
- `google_ai_end`：结束当前或指定会话，导出 Markdown，并默认关闭对应 Chrome 标签页
- `google_ai_export`：导出 Google AI 会话 Markdown

底层 CLI 可直接测试：

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/bin/chrome-bridge-cli.js \
  search "Chrome DevTools Protocol" --max-results 3
```

raft 的 pi runtime 通过 pi SDK 创建 session，会读取同一个 pi agent 目录。新启动的 raft pi session 应能看到这些工具；如果已有 pi session 在配置前已经启动，需要重开该 session。

## 部署约定

开发文件留在项目目录下。运行态统一使用本机 AI runtime 约定：

- 应用运行态根目录：`~/runtime/.chrome-bridge-mcp`
- Chrome profile：`~/runtime/.chrome-bridge-mcp/ChromeProfile`
- 日志：`~/runtime/.chrome-bridge-mcp/logs`
- 可选 LaunchAgent 描述文件：`~/Library/LaunchAgents/com.chrome-bridge.mcp.plist`

详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

多台 Mac 推广部署见 [docs/MULTI_MACHINE_DEPLOYMENT.md](docs/MULTI_MACHINE_DEPLOYMENT.md)。常用安装脚本：

- `scripts/install-claude-mcp.sh`：安装 Claude Code user-scope MCP 和 `/google` 命令。
- `scripts/install-pi-extension.sh`：安装 pi/raft pi extension。
- `scripts/print-codex-mcp-config.sh`：打印当前机器适用的 Codex MCP 配置片段。
- `scripts/install-launch-agent.sh`：安装当前用户的 Chrome profile LaunchAgent。

## 工具

- `chrome_status`：检查 Chrome CDP 是否可连接
- `list_tabs`：列出 Chrome 标签页
- `open_url`：在新标签页打开 URL
- `google_search`：在当前 Google task tab 中打开 Google 搜索；没有可复用 tab 时才新开
- `search_google_and_extract`：从 AI 助理输入搜索词，打开或复用 Google task tab，并返回结构化结果；遇到登录/验证码时返回 `needsUser=true` 和 `tabId`
- `open_google_ai`：打开 Google AI Mode，提交第一轮问题，并读取可见对话文本
- `google_ai_ask`：在已有 Google AI Mode 标签页中提交追问，并读取更新后的对话文本
- `google_ai_read`：读取 Google AI Mode 当前可见对话状态
- `start_google_ai_session`：从 Codex/Claude 对话入口开始一个持久化 Google AI 会话
- `continue_google_ai_session`：向已有 Google AI 会话继续追问；未传 `sessionId` 时使用当前活跃会话
- `read_google_ai_session`：读取已有 Google AI 会话状态；未传 `sessionId` 时使用当前活跃会话
- `end_google_ai_session`：结束会话，导出 Markdown，并默认关闭 bridge 创建的 Google AI 标签页
- `export_google_ai_session`：导出 Google AI 会话记录到 Markdown
- `get_current_page`：提取页面标题、URL、选中文本和可见正文
- `get_selection`：提取当前选中文本
- `extract_google_results`：从 Google 搜索结果页结构化抽取标题、链接和摘要
- `detect_human_intervention`：检测页面是否需要登录、验证码、授权或人工处理
- `fill_text`：向输入框、textarea 或 contenteditable 元素填入文本
- `click_selector`：点击指定 CSS selector 对应的元素
- `ask_ai_page`：向通用 AI 网页提交问题并读取回答；遇到登录/验证码时返回 `needsUser=true`
- `run_js`：在页面中运行 JavaScript 表达式
- `wait_for_user`：让 AI 暂停，等待人类在 Chrome 中完成登录、验证码或授权

## 自动化测试

测试计划见 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)。

单元测试：

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test $HOME/ai/chrome-bridge-mcp/test/unit.test.js
```

白盒覆盖率测试：

```bash
cd $HOME/ai/chrome-bridge-mcp
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test \
  --experimental-test-coverage \
  --test-coverage-include=src/server.js \
  --test-coverage-lines=80 \
  --test-coverage-functions=80 \
  --test-coverage-branches=70 \
  ./test/unit.test.js
```

E2E 测试框架位于 [test/run-e2e.js](test/run-e2e.js)。默认测试使用本地 `data:` 页面，不依赖外网，不需要登录。

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/test/run-e2e.js
```

测试会自动启动独立 Chrome，运行 MCP 协议和 CDP 集成用例，然后输出报告到：

```text
$HOME/ai/chrome-bridge-mcp/reports
```

可选 Google 外网测试：

```bash
RUN_GOOGLE_TEST=1 $HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/test/run-e2e.js
```

真实 Google 人工验收：

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/scripts/manual-google-flow.js \
  "Chrome DevTools Protocol"
```

这个验收脚本会使用真实运行态：

```text
~/runtime/.chrome-bridge-mcp/ChromeProfile
```

流程是：脚本从命令行接收搜索词，调用 MCP 工具打开 Google 并抽取结果。如果 Google 要求登录、验证码、同意条款或人工确认，脚本会停住；你在打开的 Chrome 窗口里处理完成后，回到终端按 Enter，脚本继续读取同一个标签页。报告会写入：

```text
$HOME/ai/chrome-bridge-mcp/reports/manual-google-*.json
$HOME/ai/chrome-bridge-mcp/reports/manual-google-*.md
```

真实 Google AI 多轮讨论：

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/scripts/manual-google-ai-chat.js \
  "用中文解释 Chrome DevTools Protocol，并给出三个适合自动化测试的应用场景"
```

脚本会打开真实 `google.com` 的 AI Mode。之后你可以在终端继续输入追问；如果页面要求登录、验证码、同意条款，或者需要你手动点进输入框，脚本会停住，等你在 Chrome 里处理后继续。报告会写入：

```text
$HOME/ai/chrome-bridge-mcp/reports/manual-google-ai-chat-*.json
$HOME/ai/chrome-bridge-mcp/reports/manual-google-ai-chat-*.md
```

## 通过 Codex/Claude 界面和 Google AI 对话

面向日常使用时，不需要你记住标签页 ID。助理应该使用会话层工具：

```text
start_google_ai_session -> continue_google_ai_session -> read_google_ai_session -> end_google_ai_session
```

你可以直接在 Codex 或 Claude Code 里说：

```text
开一个 Google AI 会话，我们讨论“如何设计个人 AI 助理和 Chrome 的协作工作流”。我会逐轮追问，你负责把我的话转给 Google AI，再把它的回答带回来。
```

在 Codex 中不要使用 `@` 作为前缀，因为它会触发 Codex 的文件/插件选择器。试行前缀改为 `#g`：

```text
#g new <话题>   新开 Google AI 会话
#g <内容>       继续当前 Google AI 会话；没有会话则自动新开
#g              查看当前 Google AI 会话提示
#g read         读取当前会话状态
#g export       导出当前会话记录
#g end          导出当前会话记录并关闭对应 Chrome 标签页
```

示例：

```text
#g new 我们讨论一下 Chrome bridge 的交互层设计
#g 第一版先不要做 UI，只做 CLI/MCP，会少哪些能力？
#g 把方案分成本周能做和以后再做
```

如果页面要求登录、验证码或同意条款，助理会告诉你去真实 Chrome 里处理。处理完后，你在 Codex/Claude 里说“继续”，助理继续同一个 Google AI 会话。

## 示例提示词

```text
使用 chrome_status 和 list_tabs，然后总结当前 Chrome 页面。
```

```text
用 search_google_and_extract 搜索“Claude Code MCP docs”；如果出现登录或验证码就等我处理，然后继续读取结果页。
```

```text
读取我在 Chrome 中选中的文字，并整理成简洁的问题摘要。
```

## Development

### Directory Structure

- Runtime root: `~/runtime/.chrome-bridge-mcp`
- Chrome profile: `~/runtime/.chrome-bridge-mcp/ChromeProfile`
- Logs: `~/runtime/.chrome-bridge-mcp/logs`
- Reports: `reports/`

### Testing

```bash
# Unit tests
node --test test/unit.test.js

# E2E tests (default)
node test/run-e2e.js

# E2E tests with live Google search
RUN_GOOGLE_TEST=1 node test/run-e2e.js

# Manual Google flow
node scripts/manual-google-flow.js

# Manual Google AI chat
node scripts/manual-google-ai-chat.js
```

Coverage targets: line 80%, function 80%, branch 70%.

Latest test results: unit 32/32 (100%), E2E 13/13 (100%).

### Multi-Machine Deployment

See `docs/MULTI_MACHINE_DEPLOYMENT.md` for deploying across multiple machines.

### AI Client Integration

- **Claude Code**: `scripts/install-claude-mcp.sh` — registers MCP at user scope
- **Codex**: `scripts/print-codex-mcp-config.sh` — prints config for `~/.codex/config.toml`
- **Pi**: `scripts/install-pi-extension.sh` — deploys extension to Pi runtime

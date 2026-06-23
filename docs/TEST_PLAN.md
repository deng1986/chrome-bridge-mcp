# 测试计划

## 设计目标

本项目的核心目标不是“爬网页”，而是让 AI 助理和真实 Chrome 工作现场互通：

- AI 可以打开 URL 和 Google 搜索。
- AI 可以读取当前页面、选中文本和标签页列表。
- AI 可以执行小段页面内 JavaScript。
- 登录、验证码、授权等动作留给人类在 Chrome 里处理。
- 运行态目录、测试目录和清理策略可控。

## 覆盖矩阵

| 目标 | 测试层 | 当前用例 | 状态 |
| --- | --- | --- | --- |
| MCP 协议可用 | 单元 + E2E | `initialize`、`tools/list` | 已覆盖 |
| 工具清单完整 | 单元 + E2E | 检查全部 MCP 工具名 | 已覆盖 |
| Chrome CDP 可连接 | E2E | `chrome_status` | 已覆盖 |
| 打开 URL | E2E | `open_url` 打开 `data:` fixture | 已覆盖 |
| Google 搜索入口 | 单元 + 可选 E2E + 真实验收 | `search_google_and_extract` 从搜索词直达结构化结果；同一 Google task tab 内连续搜索优先复用标签页 | 已覆盖 |
| 读取页面正文 | E2E | `get_current_page` 读取中文 fixture | 已覆盖 |
| 读取选中文本 | E2E | `get_selection` 读取自动选区 | 已覆盖 |
| 执行 JS | E2E | `run_js` 读取 DOM 节点 | 已覆盖 |
| 参数校验 | 单元 | `requiredString`、未知工具 | 已覆盖 |
| URL scheme 边界 | 单元 + E2E | `https:`、`http:`、`data:`、`chrome:`、裸域名 | 已覆盖 |
| 错误路径 | 单元 | 未知 method、未知 tool、非 JSON-RPC 消息 | 部分覆盖 |
| Chrome 不可用 | 单元 | `httpJson` 连接失败/非 2xx 错误路径 | 已覆盖 |
| 页面 JS 异常 | 单元 | `cdpCall`/`evaluate` 错误路径 | 部分覆盖 |
| 无标签页/错误 tabId | 单元 | `getTab`、页面读取类工具在无标签页时的错误 | 已覆盖 |
| Google 结果抽取 | E2E | 本地 Google fixture 抽取标题/链接/摘要；Google 可选 E2E 打开真实搜索页并尝试抽取 | 已覆盖 |
| AI 页面问答往返 | E2E | 本地 AI fixture 自动填问、点击发送、读取回答 | 已覆盖 |
| 人工接管恢复 | E2E | 登录阻塞 fixture 检测 `needsUser`，模拟人工完成后继续问答 | 已覆盖 |
| Google AI 多轮讨论 | E2E + 真实验收 | 本地 Google AI fixture 完成两轮追问；真实脚本 `manual-google-ai-chat.js` 支持 Google AI Mode 多轮讨论和人工接管 | 已覆盖 |
| Codex/Claude 代理 Google AI 会话 | 单元 | `start_google_ai_session`、`continue_google_ai_session`、`read_google_ai_session`、`export_google_ai_session` 维护同一个 sessionId 和标签页；`end_google_ai_session` 导出并关闭对应标签页 | 已覆盖 |
| 真实登录/验证码协作 | 真实验收 | `scripts/manual-google-flow.js` 使用真实 Chrome profile；遇到人工步骤暂停，用户处理后继续抽取同一标签页 | 已覆盖 |

## 运行方式

### 单元测试

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test $HOME/ai/chrome-bridge-mcp/test/unit.test.js
```

### 白盒覆盖率

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

### 默认 E2E

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/test/run-e2e.js
```

### Google 可选 E2E

```bash
RUN_GOOGLE_TEST=1 $HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/test/run-e2e.js
```

### 真实 Google 人工验收

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/scripts/manual-google-flow.js \
  "Chrome DevTools Protocol"
```

这个验收用例使用真实 Chrome、真实 Google 和真实运行态 `~/runtime/.chrome-bridge-mcp/ChromeProfile`。如果 Google 触发登录、验证码、同意条款或人工验证，脚本会停住并等待用户在 Chrome 中处理；用户完成后回到终端按 Enter，脚本继续通过 MCP 从同一个标签页抽取搜索结果。

### 真实 Google AI 多轮讨论验收

```bash
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  $HOME/ai/chrome-bridge-mcp/scripts/manual-google-ai-chat.js \
  "用中文解释 Chrome DevTools Protocol，并给出三个适合自动化测试的应用场景"
```

该脚本打开 `google.com` 的 AI Mode，并把每一轮问题、页面状态和可见对话文本写入 `reports/manual-google-ai-chat-*.md`。遇到登录、验证码、同意条款或输入框需要人工点击时，脚本暂停，用户处理后继续。

## 通过标准

- 单元测试全部通过。
- 白盒覆盖率达到最低阈值：行 80%，函数 80%，分支 70%。
- 默认 E2E 全部通过。
- Google E2E 作为环境相关测试，失败时需要区分网络/验证码/地区策略和代码问题。
- 真实 Google 人工验收至少能完成一次“输入搜索词 -> 打开真实 Google -> 返回结构化结果”的闭环；如果遇到验证码或登录，必须验证人工处理后能继续。
- Google AI 多轮讨论至少要证明两轮以上问答可以保留上下文，并且报告中有每轮实际可见对话文本。
- MCP 客户端接入至少要证明 Claude Code 能连接 `chrome-bridge`，Codex 配置包含 `mcp_servers.chrome_bridge`，且 MCP `tools/list` 能列出 Google AI 工具。

## 最近一次结果

- 时间：2026-06-22T03:35:24Z
- 单元测试：31/31 通过。
- 白盒覆盖率：行 90.05%，分支 74.85%，函数 87.50%。
- 默认 E2E：13/13 通过。
- Google 可选 E2E：14/14 通过，报告已包含实际证据数据，包括页面正文、选中文本、AI 回答、人工接管状态、Google AI 多轮 fixture 和 Google 搜索结果。
- 真实 Google 人工验收：通过，搜索 `Chrome DevTools Protocol` 返回 8 条结构化结果，`needsUser=false`。
- 真实 Google AI 多轮讨论：通过，初始问题加一轮追问均返回实际可见对话文本。
- MCP 客户端接入：Claude Code `chrome-bridge` Connected；Codex 已写入 `~/.codex/config.toml`，需新开会话或重启后生效；stdio 自检包含 `open_google_ai`、`google_ai_ask`、`google_ai_read` 和会话层工具。
- 最新默认 E2E 报告：`reports/e2e-2026-06-22T03-35-12-007Z.md`
- 最新 Google E2E 报告：`reports/e2e-2026-06-22T03-35-17-470Z.md`
- 最新真实 Google 验收报告：`reports/manual-google-2026-06-22T03-16-16-946Z.md`
- 最新真实 Google AI 多轮报告：`reports/manual-google-ai-chat-2026-06-22T03-31-51-496Z.md`

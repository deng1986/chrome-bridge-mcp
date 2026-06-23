# 测试说明

## 测试思路

测试分四层：

1. MCP 协议层：验证 `initialize`、`tools/list` 和工具调用响应格式。
2. Chrome/CDP 集成层：自动启动隔离 Chrome profile，通过 CDP 打开页面、列标签页、执行 JavaScript、读取页面正文和选中文本。
3. 真实工作流层：覆盖 Google 结果结构化抽取、通用 AI 页面问答往返、登录/验证码类人工接管检测与恢复。
4. 外网搜索层：可选运行 Google 搜索测试，覆盖从搜索词输入到结构化结果返回的闭环，默认关闭，避免网络、验证码、地区策略影响常规测试结果。
5. 真实人工验收层：使用真实 Chrome profile，遇到登录/验证码时等待用户处理，然后继续读取同一个标签页。
6. 白盒单元层：直接 import `src/server.js`，覆盖 URL 规范化、参数校验、返回格式、工具清单、`handle` 成功/失败分支。

## 测试数据

默认数据是脚本内置的 `data:text/html` 页面，包含：

- 页面标题：`Chrome Bridge Fixture`
- 中文正文：`这是一段用于自动化测试的中文页面内容。`
- 稳定 needle：`needle-alpha-20260622`
- 一个按钮，用于自动选中文本并测试 `get_selection`
- Google 搜索结果 fixture，用于测试结构化抽取
- AI 页面 fixture，用于测试自动填问、点击发送、读取回答
- 人工接管 fixture，用于测试登录阻塞检测、人工恢复后继续问答

## 运行命令

单元测试：

```bash
/Users/deng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test /Users/deng/ai/chrome-bridge-mcp/test/unit.test.js
```

白盒覆盖率测试：

```bash
/Users/deng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test \
  --experimental-test-coverage \
  --test-coverage-include=src/server.js \
  --test-coverage-lines=80 \
  --test-coverage-functions=80 \
  --test-coverage-branches=70 \
  /Users/deng/ai/chrome-bridge-mcp/test/unit.test.js
```

E2E 测试：

```bash
/Users/deng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /Users/deng/ai/chrome-bridge-mcp/test/run-e2e.js
```

启用 Google 外网测试：

```bash
RUN_GOOGLE_TEST=1 /Users/deng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /Users/deng/ai/chrome-bridge-mcp/test/run-e2e.js
```

真实 Google 人工验收：

```bash
/Users/deng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /Users/deng/ai/chrome-bridge-mcp/scripts/manual-google-flow.js \
  "Chrome DevTools Protocol"
```

## 报告

每次运行会在 `reports/` 下生成：

- `e2e-*.json`：机器可读结果
- `e2e-*.md`：人类可读报告
- `manual-google-*.json`：真实 Google 人工验收机器可读结果
- `manual-google-*.md`：真实 Google 人工验收人类可读报告

`reports/` 下的测试报告默认不纳入 git。

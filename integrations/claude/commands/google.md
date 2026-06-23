---
name: "google"
description: "通过 chrome-bridge 使用真实 Chrome 调用 Google 搜索和 Google AI"
user-invocable: true
---

## 目标

通过 `chrome-bridge` MCP 工具使用真实 Chrome 完成 Google 搜索和 Google AI 多轮讨论，不要求用户手工复制粘贴浏览器内容。

## 使用规则

用户可能用自然语言，也可能用 `#g` 前缀表达需求：

```text
#g new <话题>   新开 Google AI 会话
#g <内容>       继续当前 Google AI 会话；没有当前会话时先新开
#g read         读取当前 Google AI 会话
#g export       导出当前 Google AI 会话
#g end          导出当前 Google AI 会话并关闭对应 Chrome 标签页
```

Google 搜索可以用自然语言表达，例如：

```text
用 Google 搜索 <查询>
```

## 工具映射

- 搜索：优先调用 `mcp__chrome-bridge__search_google_and_extract`。
- Google AI 新会话：调用 `mcp__chrome-bridge__start_google_ai_session`。
- Google AI 追问：调用 `mcp__chrome-bridge__continue_google_ai_session`，通常省略 `sessionId`，让 bridge 使用当前活跃会话。
- 读取当前会话：调用 `mcp__chrome-bridge__read_google_ai_session`，通常省略 `sessionId`。
- 导出当前会话：调用 `mcp__chrome-bridge__export_google_ai_session`，通常省略 `sessionId`。
- 结束当前会话：调用 `mcp__chrome-bridge__end_google_ai_session`，通常省略 `sessionId`，默认关闭对应 Chrome 标签页。

## 标签页原则

同一件事尽量使用一个 Chrome 标签页完成。`chrome-bridge` 会维护当前 Google task tab；搜索和 Google AI 新入口会优先复用该标签页，只有标签页不存在或被用户手动关闭时才新开。

不要主动关闭用户手工打开的非 bridge 标签页。只有用户明确要求结束，或使用 `#g end` 时，才关闭 bridge 为当前会话登记的标签页。

## 人工接管

如果工具返回 `needsUser=true`、验证码、登录、同意条款、输入框不可用等状态：

1. 告诉用户去 Chrome 中处理当前标签页。
2. 说明处理完成后让用户回来继续。
3. 用户回来后继续读取或追问同一个标签页，不要重新开页。

## 输出要求

- 只基于工具返回的 Google/页面内容回答。
- 不伪造搜索结果或 Google AI 回答。
- 回答中保留关键来源链接或报告路径。

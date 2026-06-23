import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  callTool,
  cdpCall,
  evaluate,
  getTab,
  httpJson,
  handle,
  listPageTabs,
  normalizeUrl,
  requiredString,
  textContent,
  tools,
} from "../src/server.js";

async function withMockCdp(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previousHost = process.env.CHROME_BRIDGE_HOST;
  const previousPort = process.env.CHROME_BRIDGE_PORT;
  const address = server.address();
  process.env.CHROME_BRIDGE_HOST = "127.0.0.1";
  process.env.CHROME_BRIDGE_PORT = String(address.port);
  try {
    return await fn();
  } finally {
    if (previousHost === undefined) delete process.env.CHROME_BRIDGE_HOST;
    else process.env.CHROME_BRIDGE_HOST = previousHost;
    if (previousPort === undefined) delete process.env.CHROME_BRIDGE_PORT;
    else process.env.CHROME_BRIDGE_PORT = previousPort;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withTempRuntime(fn) {
  const previousRuntime = process.env.CHROME_BRIDGE_RUNTIME;
  const dir = await mkdtemp(join(tmpdir(), "chrome-bridge-runtime-"));
  process.env.CHROME_BRIDGE_RUNTIME = dir;
  try {
    return await fn(dir);
  } finally {
    if (previousRuntime === undefined) delete process.env.CHROME_BRIDGE_RUNTIME;
    else process.env.CHROME_BRIDGE_RUNTIME = previousRuntime;
    await rm(dir, { recursive: true, force: true });
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  const writes = [];
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  return Promise.resolve()
    .then(fn)
    .then(
      () => writes.join(""),
      (error) => {
        throw error;
      },
    )
    .finally(() => {
      process.stdout.write = originalWrite;
    });
}

function parseJsonLines(output) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("normalizeUrl 保留已有 scheme", () => {
  assert.equal(normalizeUrl("https://example.com"), "https://example.com");
  assert.equal(normalizeUrl("http://example.com"), "http://example.com");
  assert.equal(normalizeUrl("data:text/plain,hello"), "data:text/plain,hello");
  assert.equal(normalizeUrl("chrome://version"), "chrome://version");
});

test("normalizeUrl 为裸域名补 https", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com");
});

test("requiredString 接受非空字符串", () => {
  assert.equal(requiredString("abc", "value"), "abc");
});

test("requiredString 拒绝空值", () => {
  assert.throws(() => requiredString("", "value"), /value must be a non-empty string/);
  assert.throws(() => requiredString(42, "value"), /value must be a non-empty string/);
});

test("textContent 将对象序列化为 MCP 文本内容", () => {
  const result = textContent({ ok: true });
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), { ok: true });
});

test("工具清单包含设计目标中的工具", () => {
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "ask_ai_page",
    "chrome_status",
    "click_selector",
    "continue_google_ai_session",
    "detect_human_intervention",
    "end_google_ai_session",
    "export_google_ai_session",
    "extract_google_results",
    "fill_text",
    "get_current_page",
    "get_selection",
    "google_ai_ask",
    "google_ai_read",
    "google_search",
    "list_tabs",
    "open_google_ai",
    "open_url",
    "read_google_ai_session",
    "run_js",
    "search_google_and_extract",
    "start_google_ai_session",
    "wait_for_user",
  ]);
});

test("handle initialize 返回服务信息", async () => {
  const output = await captureStdout(() =>
    handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }),
  );
  const [message] = parseJsonLines(output);
  assert.equal(message.id, 1);
  assert.equal(message.result.serverInfo.name, "chrome-bridge-mcp");
});

test("handle tools/list 返回工具清单", async () => {
  const output = await captureStdout(() => handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  const [message] = parseJsonLines(output);
  assert.equal(message.id, 2);
  assert.equal(message.result.tools.length, tools.length);
});

test("handle 未知 method 返回 -32601", async () => {
  const output = await captureStdout(() => handle({ jsonrpc: "2.0", id: 3, method: "missing/method" }));
  const [message] = parseJsonLines(output);
  assert.equal(message.id, 3);
  assert.equal(message.error.code, -32601);
});

test("handle 未知工具返回 -32000", async () => {
  const output = await captureStdout(() =>
    handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "missing_tool", arguments: {} } }),
  );
  const [message] = parseJsonLines(output);
  assert.equal(message.id, 4);
  assert.equal(message.error.code, -32000);
  assert.match(message.error.message, /Unknown tool/);
});

test("handle tools/call 成功路径返回工具结果", async () => {
  const output = await captureStdout(() =>
    handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "wait_for_user", arguments: { message: "请登录" } } }),
  );
  const [message] = parseJsonLines(output);
  assert.equal(message.id, 5);
  assert.equal(JSON.parse(message.result.content[0].text).message, "请登录");
});

test("handle initialized 通知不输出响应", async () => {
  const output = await captureStdout(() => handle({ jsonrpc: "2.0", method: "notifications/initialized" }));
  assert.equal(output, "");
});

test("handle 忽略非 JSON-RPC 2.0 消息", async () => {
  const output = await captureStdout(() => handle({ id: 7, method: "initialize" }));
  assert.equal(output, "");
});

test("httpJson 处理成功响应和非 2xx 响应", async () => {
  await withMockCdp((request, response) => {
    if (request.url === "/ok") return sendJson(response, 200, { ok: true });
    return sendJson(response, 404, { ok: false });
  }, async () => {
    assert.deepEqual(await httpJson("/ok"), { ok: true });
    await assert.rejects(() => httpJson("/missing"), /Chrome DevTools request failed: 404/);
  });
});

test("listPageTabs 和 getTab 过滤 page tab", async () => {
  await withMockCdp((request, response) => {
    if (request.url === "/json/list") {
      return sendJson(response, 200, [
        { id: "ignored", type: "other" },
        { id: "tab-1", type: "page", title: "fixture", url: "https://example.com", webSocketDebuggerUrl: "ws://127.0.0.1/mock" },
      ]);
    }
    return sendJson(response, 404, {});
  }, async () => {
    const tabs = await listPageTabs();
    assert.equal(tabs.length, 1);
    const first = await getTab();
    assert.equal(first.id, "tab-1");
    const explicit = await getTab("tab-1");
    assert.equal(explicit.url, "https://example.com");
    await assert.rejects(() => getTab("__missing_tab__"), /No Chrome tab found/);
  });
});

test("getTab 在没有 page tab 时报错", async () => {
  await withMockCdp((request, response) => {
    if (request.url === "/json/list") return sendJson(response, 200, []);
    return sendJson(response, 404, {});
  }, async () => {
    await assert.rejects(() => getTab(), /No Chrome page tabs/);
  });
});

test("callTool chrome_status/list_tabs/open_url/google_search 覆盖 HTTP 工具路径", async () => {
  await withTempRuntime(async () => {
  const seenNewUrls = [];
  await withMockCdp((request, response) => {
    if (request.url === "/json/version") {
      return sendJson(response, 200, { Browser: "MockChrome/1.0", "Protocol-Version": "1.3" });
    }
    if (request.url === "/json/list") {
      return sendJson(response, 200, [
        { id: "tab-1", type: "page", title: "fixture", url: "https://example.com", webSocketDebuggerUrl: "ws://127.0.0.1/mock" },
      ]);
    }
    if (request.url.startsWith("/json/new?")) {
      seenNewUrls.push(decodeURIComponent(request.url.slice("/json/new?".length)));
      return sendJson(response, 200, { id: `new-${seenNewUrls.length}`, title: "new", url: seenNewUrls.at(-1) });
    }
    return sendJson(response, 404, {});
  }, async () => {
    const status = JSON.parse((await callTool("chrome_status")).content[0].text);
    assert.equal(status.browser, "MockChrome/1.0");

    const tabs = JSON.parse((await callTool("list_tabs")).content[0].text);
    assert.equal(tabs[0].id, "tab-1");

    const opened = JSON.parse((await callTool("open_url", { url: "example.com/path" })).content[0].text);
    assert.equal(opened.url, "https://example.com/path");

    const searched = JSON.parse((await callTool("google_search", { query: "中文 query" })).content[0].text);
    assert.equal(searched.query, "中文 query");
    assert.ok(searched.url.includes("google.com/search"));
  });
  });
});

test("callTool search_google_and_extract 会打开 Google 并抽取结构化结果", async () => {
  await withTempRuntime(async () => {
  const seenNewUrls = [];
  await withMockCdp((request, response) => {
    if (request.url === "/json/list") {
      return sendJson(response, 200, [
        {
          id: "tab-search",
          type: "page",
          title: "Google",
          url: "https://www.google.com/search?q=mock",
          webSocketDebuggerUrl: "ws://127.0.0.1/mock",
        },
      ]);
    }
    if (request.url.startsWith("/json/new?")) {
      seenNewUrls.push(decodeURIComponent(request.url.slice("/json/new?".length)));
      return sendJson(response, 200, { id: "tab-search", title: "Google", url: seenNewUrls.at(-1) });
    }
    return sendJson(response, 404, {});
  }, async () => {
    const originalCdpCall = globalThis.WebSocket;
    class MockWebSocket extends EventTarget {
      constructor() {
        super();
        setTimeout(() => this.dispatchEvent(new Event("open")), 0);
      }
      send(message) {
        const id = JSON.parse(message).id;
        const result = {
          result: {
            value: {
              title: "Google Fixture",
              url: "https://www.google.com/search?q=中文%20query",
              needsUser: false,
              count: 1,
              results: [{ title: "Alpha", url: "https://example.com/alpha", snippet: "Alpha snippet" }],
            },
          },
        };
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, result }) }));
        }, 0);
      }
      close() {}
    }
    globalThis.WebSocket = MockWebSocket;
    try {
      const searched = JSON.parse((await callTool("search_google_and_extract", {
        query: "中文 query",
        maxResults: 3,
        waitMs: 1,
      })).content[0].text);
      assert.equal(searched.query, "中文 query");
      assert.equal(searched.tabId, "tab-search");
      assert.equal(searched.opened, true);
      assert.equal(searched.count, 1);
      assert.equal(searched.results[0].title, "Alpha");
      assert.ok(seenNewUrls[0].includes("google.com/search"));
    } finally {
      globalThis.WebSocket = originalCdpCall;
    }
  });
  });
});

test("callTool search_google_and_extract 在同一 Google task tab 中复用页面", async () => {
  await withTempRuntime(async () => {
    const seenNewUrls = [];
    const sentMethods = [];
    await withMockCdp((request, response) => {
      if (request.url === "/json/list") {
        return sendJson(response, 200, [
          {
            id: "tab-search",
            type: "page",
            title: "Google",
            url: "https://www.google.com/search?q=first",
            webSocketDebuggerUrl: "ws://127.0.0.1/mock",
          },
        ]);
      }
      if (request.url.startsWith("/json/new?")) {
        seenNewUrls.push(decodeURIComponent(request.url.slice("/json/new?".length)));
        return sendJson(response, 200, { id: "tab-search", title: "Google", url: seenNewUrls.at(-1) });
      }
      return sendJson(response, 404, {});
    }, async () => {
      const originalCdpCall = globalThis.WebSocket;
      class MockWebSocket extends EventTarget {
        constructor() {
          super();
          setTimeout(() => this.dispatchEvent(new Event("open")), 0);
        }
        send(message) {
          const payload = JSON.parse(message);
          sentMethods.push(payload.method);
          const value = payload.method === "Runtime.evaluate"
            ? {
                title: "Google Fixture",
                url: "https://www.google.com/search",
                needsUser: false,
                count: 1,
                results: [{ title: "Result", url: "https://example.com", snippet: "Snippet" }],
              }
            : {};
          setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: payload.id, result: { result: { value } } }) }));
          }, 0);
        }
        close() {}
      }
      globalThis.WebSocket = MockWebSocket;
      try {
        const first = JSON.parse((await callTool("search_google_and_extract", {
          query: "first",
          maxResults: 1,
          waitMs: 1,
        })).content[0].text);
        const second = JSON.parse((await callTool("search_google_and_extract", {
          query: "second",
          maxResults: 1,
          waitMs: 1,
        })).content[0].text);
        assert.equal(first.opened, true);
        assert.equal(second.opened, false);
        assert.equal(second.reused, true);
        assert.equal(seenNewUrls.length, 1);
        assert(sentMethods.includes("Page.navigate"), "第二次搜索未复用已有标签页导航");
      } finally {
        globalThis.WebSocket = originalCdpCall;
      }
    });
  });
});

test("callTool open_google_ai/google_ai_read/google_ai_ask 覆盖 Google AI 工具路径", async () => {
  await withTempRuntime(async () => {
  const seenNewUrls = [];
  await withMockCdp((request, response) => {
    if (request.url === "/json/list") {
      return sendJson(response, 200, [
        {
          id: "tab-ai",
          type: "page",
          title: "Google AI",
          url: "https://www.google.com/search?udm=50&q=mock",
          webSocketDebuggerUrl: "ws://127.0.0.1/mock-ai",
        },
      ]);
    }
    if (request.url.startsWith("/json/new?")) {
      seenNewUrls.push(decodeURIComponent(request.url.slice("/json/new?".length)));
      return sendJson(response, 200, { id: "tab-ai", title: "Google AI", url: seenNewUrls.at(-1) });
    }
    return sendJson(response, 404, {});
  }, async () => {
    const originalWebSocket = globalThis.WebSocket;
    const sentMethods = [];
    let runtimeCallCount = 0;
    class MockWebSocket extends EventTarget {
      constructor() {
        super();
        setTimeout(() => this.dispatchEvent(new Event("open")), 0);
      }
      send(message) {
        const payload = JSON.parse(message);
        sentMethods.push(payload.method);
        let value = {};
        if (payload.method === "Runtime.evaluate") {
          const expression = payload.params?.expression || "";
          if (expression.includes("promptLength")) {
            value = { focused: true, tag: "textarea", placeholder: "尽情提问", promptLength: 4 };
          } else {
            runtimeCallCount += 1;
            value = {
              title: "Google AI Fixture",
              url: "https://www.google.com/search?udm=50&q=mock",
              needsUser: false,
              reasons: [],
              inputReady: true,
              inputCandidates: [{ tag: "textarea", placeholder: "尽情提问" }],
              text: runtimeCallCount >= 4 ? "before\nUser: 追问\nGoogle AI: 回答追问" : "before",
              truncated: false,
            };
          }
        }
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: payload.id, result: { result: { value } } }) }));
        }, 0);
      }
      close() {}
    }
    globalThis.WebSocket = MockWebSocket;
    try {
      const opened = JSON.parse((await callTool("open_google_ai", { prompt: "初问", waitMs: 1, maxChars: 1000 })).content[0].text);
      assert.equal(opened.opened, true);
      assert.equal(opened.tabId, "tab-ai");
      assert.ok(seenNewUrls[0].includes("google.com/search"));
      assert.ok(seenNewUrls[0].includes("udm=50"));

      const read = JSON.parse((await callTool("google_ai_read", { tabId: "tab-ai", maxChars: 1000 })).content[0].text);
      assert.equal(read.inputReady, true);

      const asked = JSON.parse((await callTool("google_ai_ask", {
        tabId: "tab-ai",
        prompt: "追问",
        timeoutMs: 1000,
        maxChars: 1000,
      })).content[0].text);
      assert.equal(asked.sent, true);
      assert.match(asked.text, /Google AI: 回答追问/);
      assert(sentMethods.includes("Input.insertText"), "未通过 CDP 插入追问文本");
      assert.equal(sentMethods.filter((method) => method === "Input.dispatchKeyEvent").length, 2);
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });
  });
});

test("callTool google_ai_ask 覆盖人工接管和输入框缺失分支", async () => {
  await withMockCdp((request, response) => {
    if (request.url === "/json/list") {
      return sendJson(response, 200, [
        { id: "tab-ai", type: "page", title: "Google AI", url: "https://www.google.com/search?udm=50", webSocketDebuggerUrl: "ws://127.0.0.1/mock-ai" },
      ]);
    }
    return sendJson(response, 404, {});
  }, async () => {
    const originalWebSocket = globalThis.WebSocket;
    let mode = "blocked";
    class MockWebSocket extends EventTarget {
      constructor() {
        super();
        setTimeout(() => this.dispatchEvent(new Event("open")), 0);
      }
      send(message) {
        const payload = JSON.parse(message);
        const expression = payload.params?.expression || "";
        let value;
        if (mode === "blocked") {
          value = { title: "blocked", url: "https://www.google.com/sorry", needsUser: true, reasons: ["captcha_or_bot_check"], text: "blocked" };
        } else if (expression.includes("promptLength")) {
          value = { focused: false, reason: "no_visible_input" };
        } else {
          value = { title: "no input", url: "https://www.google.com/search?udm=50", needsUser: false, inputReady: false, inputCandidates: [], text: "no input" };
        }
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: payload.id, result: { result: { value } } }) }));
        }, 0);
      }
      close() {}
    }
    globalThis.WebSocket = MockWebSocket;
    try {
      const blocked = JSON.parse((await callTool("google_ai_ask", { tabId: "tab-ai", prompt: "追问" })).content[0].text);
      assert.equal(blocked.sent, false);
      assert.equal(blocked.needsUser, true);
      assert.deepEqual(blocked.reasons, ["captcha_or_bot_check"]);

      mode = "no-input";
      const noInput = JSON.parse((await callTool("google_ai_ask", { tabId: "tab-ai", prompt: "追问" })).content[0].text);
      assert.equal(noInput.sent, false);
      assert.equal(noInput.needsUser, true);
      assert.deepEqual(noInput.reasons, ["no_visible_input"]);
      assert.deepEqual(noInput.inputCandidates, []);
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });
});

test("callTool 页面读取和页面操作工具覆盖成功路径", async () => {
  await withMockCdp((request, response) => {
    if (request.url === "/json/list") {
      return sendJson(response, 200, [
        { id: "tab-1", type: "page", title: "fixture", url: "https://example.com", webSocketDebuggerUrl: "ws://127.0.0.1/mock-page" },
      ]);
    }
    return sendJson(response, 404, {});
  }, async () => {
    const originalWebSocket = globalThis.WebSocket;
    const values = [
      { title: "Long Page", url: "https://example.com", selectedText: "", text: "x".repeat(50) },
      "selected text",
      { title: "Google", url: "https://www.google.com/search?q=x", needsUser: false, count: 1, results: [{ title: "A", url: "https://a.example", snippet: "S" }] },
      { title: "Ready", url: "https://example.com", ready: true, needsUser: false, reasons: [] },
      { filled: true, selector: "#input" },
      { clicked: true, selector: "#button" },
      42,
    ];
    class MockWebSocket extends EventTarget {
      constructor() {
        super();
        setTimeout(() => this.dispatchEvent(new Event("open")), 0);
      }
      send(message) {
        const payload = JSON.parse(message);
        const value = values.shift();
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: payload.id, result: { result: { value } } }) }));
        }, 0);
      }
      close() {}
    }
    globalThis.WebSocket = MockWebSocket;
    try {
      const page = JSON.parse((await callTool("get_current_page", { tabId: "tab-1", maxChars: 10 })).content[0].text);
      assert.equal(page.truncated, true);
      assert.equal(page.text.length, 10);

      const selection = JSON.parse((await callTool("get_selection", { tabId: "tab-1" })).content[0].text);
      assert.equal(selection.selectedText, "selected text");

      const extracted = JSON.parse((await callTool("extract_google_results", { tabId: "tab-1", maxResults: 1 })).content[0].text);
      assert.equal(extracted.count, 1);

      const handoff = JSON.parse((await callTool("detect_human_intervention", {
        tabId: "tab-1",
        readySelector: "#ready",
        blockedSelectors: ["#blocked"],
      })).content[0].text);
      assert.equal(handoff.ready, true);

      const filled = JSON.parse((await callTool("fill_text", { tabId: "tab-1", selector: "#input", text: "hello" })).content[0].text);
      assert.equal(filled.filled, true);

      const clicked = JSON.parse((await callTool("click_selector", { tabId: "tab-1", selector: "#button" })).content[0].text);
      assert.equal(clicked.clicked, true);

      const value = JSON.parse((await callTool("run_js", { tabId: "tab-1", expression: "21 * 2" })).content[0].text);
      assert.equal(value, 42);
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });
});

test("callTool Google AI 会话层覆盖 start/continue/read/export", async () => {
  await withTempRuntime(async () => {
    const closedTabs = [];
    await withMockCdp((request, response) => {
      if (request.url === "/json/list") {
        return sendJson(response, 200, [
          { id: "tab-session", type: "page", title: "Google AI", url: "https://www.google.com/search?udm=50", webSocketDebuggerUrl: "ws://127.0.0.1/mock-session" },
        ]);
      }
      if (request.url.startsWith("/json/new?")) {
        return sendJson(response, 200, { id: "tab-session", title: "Google AI", url: decodeURIComponent(request.url.slice("/json/new?".length)) });
      }
      if (request.url.startsWith("/json/close/")) {
        closedTabs.push(decodeURIComponent(request.url.slice("/json/close/".length)));
        return sendJson(response, 200, { ok: true });
      }
      return sendJson(response, 404, {});
    }, async () => {
      const originalWebSocket = globalThis.WebSocket;
      let callCount = 0;
      class MockWebSocket extends EventTarget {
        constructor() {
          super();
          setTimeout(() => this.dispatchEvent(new Event("open")), 0);
        }
        send(message) {
          const payload = JSON.parse(message);
          const expression = payload.params?.expression || "";
          let value = {};
          if (payload.method === "Runtime.evaluate") {
            if (expression.includes("promptLength")) {
              value = { focused: true, tag: "textarea", placeholder: "尽情提问", promptLength: 2 };
            } else {
              callCount += 1;
              value = {
                title: "Google AI Session",
                url: "https://www.google.com/search?udm=50&q=session",
                needsUser: false,
                reasons: [],
                inputReady: true,
                inputCandidates: [{ tag: "textarea", placeholder: "尽情提问" }],
                text: callCount > 2 ? "User: 初问\nGoogle AI: 初答\nUser: 追问\nGoogle AI: 追答" : "User: 初问\nGoogle AI: 初答",
                truncated: false,
              };
            }
          }
          setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: payload.id, result: { result: { value } } }) }));
          }, 0);
        }
        close() {}
      }
      globalThis.WebSocket = MockWebSocket;
      try {
        const started = JSON.parse((await callTool("start_google_ai_session", { message: "初问", title: "会话测试", waitMs: 1 })).content[0].text);
        assert.match(started.sessionId, /^google-ai-/);
        assert.equal(started.tabId, "tab-session");
        assert.equal(started.turns.length, 2);

        const continued = JSON.parse((await callTool("continue_google_ai_session", {
          message: "追问",
          timeoutMs: 1000,
        })).content[0].text);
        assert.equal(continued.turns.length, 4);
        assert.match(continued.state.text, /追答/);

        const read = JSON.parse((await callTool("read_google_ai_session", {})).content[0].text);
        assert.equal(read.title, "会话测试");

        const exported = JSON.parse((await callTool("export_google_ai_session", {})).content[0].text);
        assert.equal(exported.exported, true);
        const markdown = await readFile(exported.path, "utf8");
        assert.match(markdown, /Google AI 会话记录/);
        assert.match(markdown, /追答/);

        const ended = JSON.parse((await callTool("end_google_ai_session", {})).content[0].text);
        assert.equal(ended.ended, true);
        assert.equal(ended.closed, true);
        assert.deepEqual(closedTabs, ["tab-session"]);
      } finally {
        globalThis.WebSocket = originalWebSocket;
      }
    });
  });
});

test("callTool wait_for_user 使用默认消息和自定义消息", async () => {
  const defaultResult = JSON.parse((await callTool("wait_for_user")).content[0].text);
  assert.equal(defaultResult.waiting, true);
  assert.match(defaultResult.message, /complete the browser action/);

  const customResult = JSON.parse((await callTool("wait_for_user", { message: "请登录" })).content[0].text);
  assert.equal(customResult.message, "请登录");
});

test("callTool open_url 校验 url 参数", async () => {
  await assert.rejects(() => callTool("open_url", { url: "" }), /url must be a non-empty string/);
});

test("callTool google_search 校验 query 参数", async () => {
  await assert.rejects(() => callTool("google_search", { query: "" }), /query must be a non-empty string/);
  await assert.rejects(() => callTool("search_google_and_extract", { query: "" }), /query must be a non-empty string/);
  await assert.rejects(() => callTool("open_google_ai", { prompt: "" }), /prompt must be a non-empty string/);
  await assert.rejects(() => callTool("google_ai_ask", { prompt: "" }), /prompt must be a non-empty string/);
});

test("callTool run_js 校验 expression 参数", async () => {
  await assert.rejects(() => callTool("run_js", { expression: "" }), /expression must be a non-empty string/);
});

test("callTool fill_text/click_selector/ask_ai_page 校验必填参数", async () => {
  await assert.rejects(() => callTool("fill_text", { selector: "", text: "x" }), /selector must be a non-empty string/);
  await assert.rejects(() => callTool("fill_text", { selector: "#x", text: "" }), /text must be a non-empty string/);
  await assert.rejects(() => callTool("click_selector", { selector: "" }), /selector must be a non-empty string/);
  await assert.rejects(() => callTool("ask_ai_page", {
    prompt: "",
    inputSelector: "#prompt",
    submitSelector: "#send",
    responseSelector: "#answer",
  }), /prompt must be a non-empty string/);
});

test("callTool get_current_page/get_selection 在无标签页时报错", async () => {
  await withMockCdp((request, response) => {
    if (request.url === "/json/list") return sendJson(response, 200, []);
    return sendJson(response, 404, {});
  }, async () => {
    await assert.rejects(() => callTool("get_current_page"), /No Chrome page tabs/);
    await assert.rejects(() => callTool("get_selection"), /No Chrome page tabs/);
    await assert.rejects(() => callTool("extract_google_results"), /No Chrome page tabs/);
    await assert.rejects(() => callTool("detect_human_intervention"), /No Chrome page tabs/);
  });
});

test("cdpCall 对无效 websocket 地址报错", async () => {
  await assert.rejects(() => cdpCall("ws://127.0.0.1:9/devtools/page/missing", "Runtime.evaluate"), /Failed to connect|Timed out/);
});

test("evaluate 对不存在 tabId 报错", async () => {
  await assert.rejects(() => evaluate("__missing_tab__", "1 + 1"), /No Chrome tab found|No Chrome page tabs|Cannot reach Chrome/);
});

test("startStdioServer 由 CLI 入口覆盖", async () => {
  const output = await captureStdout(() =>
    handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "wait_for_user", arguments: { message: "继续" } } }),
  );
  const [message] = parseJsonLines(output);
  assert.equal(JSON.parse(message.result.content[0].text).message, "继续");
});

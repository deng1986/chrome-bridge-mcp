#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PROJECT_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const NODE_BIN = process.env.NODE_BIN || process.execPath;
const SERVER_PATH = join(PROJECT_DIR, "src/server.js");
const REPORT_DIR = join(PROJECT_DIR, "reports");
const PORT = Number(process.env.CHROME_BRIDGE_TEST_PORT || String(9300 + (process.pid % 500)));
const RUNTIME_ROOT = process.env.CHROME_BRIDGE_TEST_RUNTIME || `${process.env.HOME}/runtime/.chrome-bridge-mcp-test-${PORT}`;
const PROFILE_DIR = `${RUNTIME_ROOT}/ChromeProfile`;
const LOG_DIR = `${RUNTIME_ROOT}/logs`;
const CHROME_BIN = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RUN_GOOGLE = process.env.RUN_GOOGLE_TEST === "1";
const KEEP_TEST_RUNTIME = process.env.KEEP_TEST_RUNTIME === "1";

const expectedTools = [
  "chrome_status",
  "list_tabs",
  "open_url",
  "google_search",
  "search_google_and_extract",
  "open_google_ai",
  "google_ai_ask",
  "google_ai_read",
  "extract_google_results",
  "get_current_page",
  "get_selection",
  "detect_human_intervention",
  "fill_text",
  "click_selector",
  "ask_ai_page",
  "run_js",
  "wait_for_user",
];

const tests = [];
const context = {};

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseToolText(result) {
  const text = result?.content?.[0]?.text;
  assert(typeof text === "string", "工具结果缺少 content[0].text");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function waitForChrome() {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Chrome CDP 未就绪: ${lastError?.message || "unknown"}`);
}

function startChrome() {
  const args = [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
  const chrome = spawn(CHROME_BIN, args, {
    stdio: ["ignore", "ignore", "pipe"],
    detached: false,
  });
  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  chrome.stderrText = () => stderr.slice(-4000);
  return chrome;
}

function createMcpClient() {
  const child = spawn(NODE_BIN, [SERVER_PATH], {
    env: {
      ...process.env,
      CHROME_BRIDGE_PORT: String(PORT),
      CHROME_BRIDGE_MAX_TEXT: "5000",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  let buffer = "";
  let stderr = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  function request(method, params = {}) {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP 请求超时: ${method}`));
      }, 15000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  return {
    child,
    stderr: () => stderr.slice(-4000),
    initialize: () => request("initialize", { protocolVersion: "2024-11-05" }),
    listTools: () => request("tools/list"),
    callTool: (name, args = {}) => request("tools/call", { name, arguments: args }),
    close: async () => {
      child.stdin.end();
      child.kill("SIGTERM");
      await sleep(100);
    },
  };
}

function fixtureDataUrl() {
  const html = `<!doctype html>
<html>
  <head><title>Chrome Bridge Fixture</title></head>
  <body>
    <main>
      <h1>Chrome Bridge Fixture</h1>
      <p id="summary">这是一段用于自动化测试的中文页面内容。</p>
      <p id="needle">needle-alpha-20260622</p>
      <button id="select" onclick="const r=document.createRange();r.selectNodeContents(document.getElementById('summary'));const s=getSelection();s.removeAllRanges();s.addRange(r);">select summary</button>
    </main>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function googleResultsFixtureUrl() {
  const html = `<!doctype html>
<html>
  <head><title>Google Fixture</title></head>
  <body>
    <div class="g">
      <a href="https://example.com/alpha"><h3>Alpha Result</h3></a>
      <span>Alpha snippet 中文摘要</span>
    </div>
    <div class="g">
      <a href="https://example.org/beta"><h3>Beta Result</h3></a>
      <span>Beta snippet</span>
    </div>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function aiPageFixtureUrl() {
  const html = `<!doctype html>
<html>
  <head><title>AI Page Fixture</title></head>
  <body>
    <textarea id="prompt"></textarea>
    <button id="send" onclick="document.querySelector('#answer').innerText = 'AI 回答：' + document.querySelector('#prompt').value + ' / needle-ai-20260622';">发送</button>
    <div id="answer"></div>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function handoffFixtureUrl() {
  const html = `<!doctype html>
<html>
  <head><title>Handoff Fixture</title></head>
  <body>
    <section id="login-gate">请登录后继续</section>
    <button id="unlock" onclick="document.querySelector('#login-gate').remove(); document.querySelector('#unlock').remove(); document.querySelector('#app').hidden = false;">模拟人工完成</button>
    <main id="app" hidden>
      <textarea id="prompt"></textarea>
      <button id="send" onclick="document.querySelector('#answer').innerText = '恢复后回答：' + document.querySelector('#prompt').value;">发送</button>
      <div id="answer"></div>
    </main>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function googleAiFixtureUrl() {
  const html = `<!doctype html>
<html>
  <head><title>Google AI Fixture</title></head>
  <body>
    <main>
      <section id="conversation">AI Overview ready</section>
      <div id="prompt" role="textbox" contenteditable="true" aria-label="Ask anything" style="border:1px solid #888; min-height:32px; width:480px;"></div>
      <script>
        const prompt = document.querySelector('#prompt');
        prompt.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const text = prompt.innerText.trim();
          prompt.innerText = '';
          document.querySelector('#conversation').innerText += '\\nUser: ' + text + '\\nGoogle AI: 回答 ' + text + ' / needle-google-ai-20260622';
        });
      </script>
    </main>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

test("MCP 初始化返回服务信息", async ({ mcp }) => {
  const init = await mcp.initialize();
  assert(init.serverInfo?.name === "chrome-bridge-mcp", "serverInfo.name 不正确");
  return { serverInfo: init.serverInfo };
});

test("工具列表完整", async ({ mcp }) => {
  const listed = await mcp.listTools();
  const names = listed.tools.map((tool) => tool.name);
  for (const name of expectedTools) {
    assert(names.includes(name), `缺少工具: ${name}`);
  }
  return { toolCount: names.length, tools: names };
});

test("chrome_status 能连接测试 Chrome", async ({ mcp }) => {
  const status = parseToolText(await mcp.callTool("chrome_status"));
  assert(status.ok === true, "chrome_status 未返回 ok=true");
  assert(status.endpoint.endsWith(`:${PORT}`), "chrome_status endpoint 端口不正确");
  return status;
});

test("open_url 能打开本地 fixture data URL", async ({ mcp }) => {
  const opened = parseToolText(await mcp.callTool("open_url", { url: fixtureDataUrl() }));
  assert(opened.opened === true, "open_url 未返回 opened=true");
  assert(opened.id, "open_url 未返回 tab id");
  context.fixtureTabId = opened.id;
  await sleep(500);
  return { tabId: opened.id, title: opened.title, urlPrefix: opened.url.slice(0, 60) };
});

test("list_tabs 能找到 fixture 标签页", async ({ mcp }) => {
  const tabs = parseToolText(await mcp.callTool("list_tabs"));
  assert(tabs.some((tab) => tab.id === context.fixtureTabId), "list_tabs 未找到 fixture tab");
  return { tabCount: tabs.length, sampleTabs: tabs.slice(0, 5).map(({ id, title, url }) => ({ id, title, urlPrefix: url.slice(0, 80) })) };
});

test("get_current_page 能抽取标题和正文", async ({ mcp }) => {
  const page = parseToolText(await mcp.callTool("get_current_page", { tabId: context.fixtureTabId, maxChars: 2000 }));
  assert(page.title === "Chrome Bridge Fixture", "页面标题抽取不正确");
  assert(page.text.includes("这是一段用于自动化测试的中文页面内容"), "页面正文缺少中文测试内容");
  assert(page.text.includes("needle-alpha-20260622"), "页面正文缺少 needle");
  return { title: page.title, urlPrefix: page.url.slice(0, 80), textSample: page.text.slice(0, 160) };
});

test("run_js 能执行页面表达式", async ({ mcp }) => {
  const value = parseToolText(await mcp.callTool("run_js", {
    tabId: context.fixtureTabId,
    expression: "document.querySelector('#needle').innerText",
  }));
  assert(value === "needle-alpha-20260622", "run_js 返回值不正确");
  return { expression: "document.querySelector('#needle').innerText", value };
});

test("get_selection 能读取页面选中文本", async ({ mcp }) => {
  await mcp.callTool("run_js", {
    tabId: context.fixtureTabId,
    expression: "document.querySelector('#select').click(); 'selected'",
  });
  const selected = parseToolText(await mcp.callTool("get_selection", { tabId: context.fixtureTabId }));
  assert(selected.selectedText.includes("这是一段用于自动化测试的中文页面内容"), "get_selection 未读到选中文本");
  return selected;
});

test("extract_google_results 能结构化抽取搜索结果 fixture", async ({ mcp }) => {
  const opened = parseToolText(await mcp.callTool("open_url", { url: googleResultsFixtureUrl() }));
  await sleep(300);
  const extracted = parseToolText(await mcp.callTool("extract_google_results", { tabId: opened.id, maxResults: 5 }));
  assert(extracted.count >= 2, "结构化搜索结果数量不足");
  assert(extracted.results[0].title === "Alpha Result", "第一条搜索结果标题不正确");
  assert(extracted.results[0].url === "https://example.com/alpha", "第一条搜索结果 URL 不正确");
  return { count: extracted.count, results: extracted.results };
});

test("fill_text 和 click_selector 能操作页面", async ({ mcp }) => {
  const opened = parseToolText(await mcp.callTool("open_url", { url: aiPageFixtureUrl() }));
  await sleep(300);
  await mcp.callTool("fill_text", { tabId: opened.id, selector: "#prompt", text: "手动填充测试" });
  await mcp.callTool("click_selector", { tabId: opened.id, selector: "#send" });
  const page = parseToolText(await mcp.callTool("get_current_page", { tabId: opened.id, maxChars: 1000 }));
  assert(page.text.includes("AI 回答：手动填充测试"), "fill_text/click_selector 未产生预期回答");
  return { prompt: "手动填充测试", textSample: page.text.slice(0, 160) };
});

test("ask_ai_page 能完成 AI 页面问答往返", async ({ mcp }) => {
  const opened = parseToolText(await mcp.callTool("open_url", { url: aiPageFixtureUrl() }));
  await sleep(300);
  const answer = parseToolText(await mcp.callTool("ask_ai_page", {
    tabId: opened.id,
    prompt: "解释 MCP",
    inputSelector: "#prompt",
    submitSelector: "#send",
    responseSelector: "#answer",
    timeoutMs: 5000,
  }));
  assert(answer.answered === true, "ask_ai_page 未返回 answered=true");
  assert(answer.response.includes("解释 MCP"), "ask_ai_page 回答未包含 prompt");
  assert(answer.response.includes("needle-ai-20260622"), "ask_ai_page 回答未包含 needle");
  return { prompt: "解释 MCP", response: answer.response, needsUser: answer.needsUser, answered: answer.answered };
});

test("人工接管检测和恢复后问答可继续", async ({ mcp }) => {
  const opened = parseToolText(await mcp.callTool("open_url", { url: handoffFixtureUrl() }));
  await sleep(300);
  const before = parseToolText(await mcp.callTool("detect_human_intervention", {
    tabId: opened.id,
    readySelector: "#app:not([hidden])",
    blockedSelectors: ["#login-gate"],
  }));
  assert(before.needsUser === true, "登录阻塞页未被识别为需要人工接管");

  const blockedAnswer = parseToolText(await mcp.callTool("ask_ai_page", {
    tabId: opened.id,
    prompt: "恢复测试",
    inputSelector: "#prompt",
    submitSelector: "#send",
    responseSelector: "#answer",
    blockedSelectors: ["#login-gate"],
    timeoutMs: 5000,
  }));
  assert(blockedAnswer.needsUser === true, "ask_ai_page 在阻塞页未返回 needsUser");

  await mcp.callTool("click_selector", { tabId: opened.id, selector: "#unlock" });
  const after = parseToolText(await mcp.callTool("detect_human_intervention", {
    tabId: opened.id,
    readySelector: "#app:not([hidden])",
    blockedSelectors: ["#login-gate"],
  }));
  assert(after.ready === true && after.needsUser === false, "人工恢复后页面未进入 ready 状态");

  const answer = parseToolText(await mcp.callTool("ask_ai_page", {
    tabId: opened.id,
    prompt: "恢复测试",
    inputSelector: "#prompt",
    submitSelector: "#send",
    responseSelector: "#answer",
    blockedSelectors: ["#login-gate"],
    timeoutMs: 5000,
  }));
  assert(answer.response.includes("恢复后回答：恢复测试"), "人工恢复后问答未成功");
  return {
    before: { needsUser: before.needsUser, reasons: before.reasons },
    blockedAnswer: { needsUser: blockedAnswer.needsUser, reasons: blockedAnswer.reasons },
    after: { ready: after.ready, needsUser: after.needsUser },
    finalResponse: answer.response,
  };
});

test("google_ai_ask 能在 Google AI fixture 中完成多轮问答", async ({ mcp }) => {
  const opened = parseToolText(await mcp.callTool("open_url", { url: googleAiFixtureUrl() }));
  await sleep(300);
  const first = parseToolText(await mcp.callTool("google_ai_ask", {
    tabId: opened.id,
    prompt: "第一轮问题",
    timeoutMs: 5000,
    maxChars: 2000,
  }));
  assert(first.sent === true, "第一轮未发送成功");
  assert(first.text.includes("Google AI: 回答 第一轮问题"), "第一轮回答未出现在对话文本中");

  const second = parseToolText(await mcp.callTool("google_ai_ask", {
    tabId: opened.id,
    prompt: "第二轮追问",
    timeoutMs: 5000,
    maxChars: 2000,
  }));
  assert(second.sent === true, "第二轮未发送成功");
  assert(second.text.includes("第一轮问题"), "第二轮后丢失第一轮上下文");
  assert(second.text.includes("Google AI: 回答 第二轮追问"), "第二轮回答未出现在对话文本中");

  const read = parseToolText(await mcp.callTool("google_ai_read", { tabId: opened.id, maxChars: 2000 }));
  assert(read.text.includes("needle-google-ai-20260622"), "google_ai_read 未读到 AI 对话内容");
  return {
    tabId: opened.id,
    firstPrompt: "第一轮问题",
    secondPrompt: "第二轮追问",
    textSample: read.text.slice(0, 600),
    inputReady: read.inputReady,
  };
});

if (RUN_GOOGLE) {
  test("search_google_and_extract 能从 Codex 输入搜索词并收到 Google 结果", async ({ mcp }) => {
    const result = parseToolText(await mcp.callTool("search_google_and_extract", {
      query: "Chrome DevTools Protocol",
      maxResults: 5,
      waitMs: 2500,
    }));
    assert(result.opened === true, "search_google_and_extract 未返回 opened=true");
    assert(result.url.includes("google.com/search"), "google_search URL 不正确");
    assert(result.tabId, "search_google_and_extract 未返回 tabId");
    assert(result.needsUser === false || result.count > 0, "Google 页面需要人工接管且未抽取到结果");
    if (!result.needsUser) {
      assert(result.count > 0, "Google 搜索未抽取到任何结果");
      assert(result.results[0].title && result.results[0].url, "Google 搜索结果缺少标题或 URL");
    }
    return {
      query: result.query,
      tabId: result.tabId,
      url: result.url,
      needsUser: result.needsUser,
      count: result.count,
      results: (result.results || []).slice(0, 8),
    };
  });
}

async function run() {
  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });

  const chrome = startChrome();
  const chromeVersion = await waitForChrome();
  const mcp = createMcpClient();
  const results = [];
  const startedAt = new Date();

  try {
    for (const item of tests) {
      const testStartedAt = performance.now();
      try {
        const evidence = await item.fn({ mcp });
        results.push({ name: item.name, status: "passed", durationMs: Math.round(performance.now() - testStartedAt), evidence });
      } catch (error) {
        results.push({
          name: item.name,
          status: "failed",
          durationMs: Math.round(performance.now() - testStartedAt),
          error: error.message,
        });
      }
    }
  } finally {
    await mcp.close();
    chrome.kill("SIGTERM");
    await sleep(250);
    if (!chrome.killed) chrome.kill("SIGKILL");
  }

  const finishedAt = new Date();
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    chrome: {
      port: PORT,
      runtimeRoot: RUNTIME_ROOT,
      browser: chromeVersion.Browser,
      protocolVersion: chromeVersion["Protocol-Version"],
    },
    googleTestEnabled: RUN_GOOGLE,
    total: results.length,
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
    cleanup: { testRuntimeKept: KEEP_TEST_RUNTIME, movedRuntimeTo: null },
  };

  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(REPORT_DIR, `e2e-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `e2e-${stamp}.md`);
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(mdPath, renderMarkdown(summary));

  if (!KEEP_TEST_RUNTIME) {
    summary.cleanup.movedRuntimeTo = await moveRuntimeToTrash(startedAt);
    await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
    await writeFile(mdPath, renderMarkdown(summary));
  }

  console.log(renderConsole(summary));
  console.log(`JSON 报告: ${jsonPath}`);
  console.log(`Markdown 报告: ${mdPath}`);

  if (summary.failed > 0) process.exitCode = 1;
}

async function moveRuntimeToTrash(startedAt) {
  const trashDir = `${process.env.HOME}/tmp/trash`;
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const target = `${trashDir}/chrome-bridge-mcp-test-${PORT}.${stamp}`;
  await mkdir(trashDir, { recursive: true });
  try {
    await rename(RUNTIME_ROOT, target);
    return target;
  } catch (error) {
    return `未移动: ${error.message}`;
  }
}

function renderConsole(summary) {
  const lines = [
    `chrome-bridge-mcp E2E: ${summary.passed}/${summary.total} passed, ${summary.failed} failed`,
    `Chrome: ${summary.chrome.browser}, CDP ${summary.chrome.protocolVersion}, port ${summary.chrome.port}`,
  ];
  for (const result of summary.results) {
    const mark = result.status === "passed" ? "PASS" : "FAIL";
    lines.push(`[${mark}] ${result.name} (${result.durationMs}ms)${result.error ? `: ${result.error}` : ""}`);
  }
  return lines.join("\n");
}

function renderMarkdown(summary) {
  const rows = summary.results
    .map((result) => `| ${result.status === "passed" ? "通过" : "失败"} | ${result.name} | ${result.durationMs} | ${result.error || ""} |`)
    .join("\n");
  const evidenceSections = summary.results
    .filter((result) => result.evidence !== undefined)
    .map(renderEvidence)
    .join("\n\n");
  return `# chrome-bridge-mcp E2E 测试报告

- 开始时间：${summary.startedAt}
- 结束时间：${summary.finishedAt}
- 总耗时：${summary.durationMs} ms
- Chrome：${summary.chrome.browser}
- CDP：${summary.chrome.protocolVersion}
- 测试端口：${summary.chrome.port}
- 运行态目录：${summary.chrome.runtimeRoot}
- 测试运行态清理：${summary.cleanup.testRuntimeKept ? "保留" : summary.cleanup.movedRuntimeTo || "未移动"}
- Google 外网测试：${summary.googleTestEnabled ? "启用" : "未启用"}
- 结果：${summary.passed}/${summary.total} 通过，${summary.failed} 失败

| 状态 | 用例 | 耗时 ms | 错误 |
| --- | --- | ---: | --- |
${rows}

## 证据数据

${evidenceSections || "无"}
`;
}

function renderEvidence(result) {
  const evidence = result.evidence;
  const lines = [`### ${result.name}`];
  if (Array.isArray(evidence?.results)) {
    lines.push("");
    lines.push(`- 查询：${evidence.query || ""}`);
    lines.push(`- URL：${evidence.url || ""}`);
    lines.push(`- 需要人工接管：${evidence.needsUser ? "是" : "否"}`);
    lines.push(`- 结果数量：${evidence.count ?? evidence.results.length}`);
    lines.push("");
    lines.push("| 序号 | 标题 | URL | 摘要 |");
    lines.push("| ---: | --- | --- | --- |");
    for (const [index, item] of evidence.results.entries()) {
      lines.push(`| ${index + 1} | ${escapeCell(item.title)} | ${escapeCell(item.url)} | ${escapeCell(item.snippet || "")} |`);
    }
    return lines.join("\n");
  }
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(evidence, null, 2));
  lines.push("```");
  return lines.join("\n");
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

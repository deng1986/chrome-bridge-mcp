#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const PROJECT_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const NODE_BIN = process.env.NODE_BIN || process.execPath;
const SERVER_PATH = join(PROJECT_DIR, "src/server.js");
const REPORT_DIR = join(PROJECT_DIR, "reports");
const PORT = Number(process.env.CHROME_BRIDGE_PORT || "9222");
const RUNTIME_ROOT = process.env.CHROME_BRIDGE_RUNTIME || `${process.env.HOME}/runtime/.chrome-bridge-mcp`;
const PROFILE_DIR = `${RUNTIME_ROOT}/ChromeProfile`;
const LOG_DIR = `${RUNTIME_ROOT}/logs`;
const CHROME_BIN = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });

  const rl = createInterface({ input, output });
  const query = process.argv.slice(2).join(" ").trim() || (await rl.question("请输入要搜索的内容：")).trim();
  if (!query) throw new Error("搜索内容不能为空");

  const chrome = await ensureChrome();
  const mcp = createMcpClient();
  const startedAt = new Date();
  let finalResult;

  try {
    await mcp.initialize();
    finalResult = parseToolText(await mcp.callTool("search_google_and_extract", {
      query,
      maxResults: Number(process.env.MAX_RESULTS || "8"),
      waitMs: Number(process.env.GOOGLE_WAIT_MS || "3000"),
    }));

    while (finalResult.needsUser || finalResult.count === 0) {
      console.log("\nGoogle 页面暂时没有可用结果，可能需要登录、验证码、同意条款，或者网络还没加载完成。");
      console.log(`请在已打开的 Chrome 窗口中处理当前标签页，然后回到这里按 Enter 继续。tabId=${finalResult.tabId}`);
      const answer = await rl.question("处理完成后按 Enter 重试，输入 q 退出：");
      if (answer.trim().toLowerCase() === "q") break;
      const tabId = finalResult.tabId;
      finalResult = parseToolText(await mcp.callTool("extract_google_results", {
        tabId,
        maxResults: Number(process.env.MAX_RESULTS || "8"),
      }));
      finalResult = { query, tabId, opened: true, ...finalResult };
    }

    const report = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      query,
      chrome: {
        endpoint: `http://127.0.0.1:${PORT}`,
        runtimeRoot: RUNTIME_ROOT,
        profileDir: PROFILE_DIR,
        startedByScript: chrome.startedByScript,
      },
      result: finalResult,
    };
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    const jsonPath = join(REPORT_DIR, `manual-google-${stamp}.json`);
    const mdPath = join(REPORT_DIR, `manual-google-${stamp}.md`);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(mdPath, renderMarkdown(report));

    console.log(`\n完成：${finalResult.count || 0} 条结果，needsUser=${Boolean(finalResult.needsUser)}`);
    for (const [index, item] of (finalResult.results || []).entries()) {
      console.log(`${index + 1}. ${item.title}`);
      console.log(`   ${item.url}`);
    }
    console.log(`\nJSON 报告: ${jsonPath}`);
    console.log(`Markdown 报告: ${mdPath}`);
  } finally {
    rl.close();
    await mcp.close();
  }
}

async function ensureChrome() {
  const existing = await chromeVersion().catch(() => null);
  if (existing) return { startedByScript: false, version: existing };

  const args = [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
  const child = spawn(CHROME_BIN, args, { stdio: "ignore", detached: true });
  child.unref();

  const deadline = Date.now() + 20000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const version = await chromeVersion();
      return { startedByScript: true, version };
    } catch (error) {
      lastError = error;
      await sleep(300);
    }
  }
  throw new Error(`Chrome CDP 未就绪: ${lastError?.message || "unknown"}`);
}

async function chromeVersion() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function createMcpClient() {
  const child = spawn(NODE_BIN, [SERVER_PATH], {
    env: { ...process.env, CHROME_BRIDGE_PORT: String(PORT) },
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
        reject(new Error(`MCP 请求超时: ${method}\n${stderr.slice(-2000)}`));
      }, 30000);
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
    initialize: () => request("initialize", { protocolVersion: "2024-11-05" }),
    callTool: (name, args = {}) => request("tools/call", { name, arguments: args }),
    close: async () => {
      child.stdin.end();
      child.kill("SIGTERM");
      await sleep(100);
    },
  };
}

function parseToolText(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("工具结果缺少 content[0].text");
  return JSON.parse(text);
}

function renderMarkdown(report) {
  const results = report.result?.results || [];
  const rows = results
    .map((item, index) => `| ${index + 1} | ${escapeCell(item.title)} | ${escapeCell(item.url)} | ${escapeCell(item.snippet || "")} |`)
    .join("\n");
  return `# Google 真实流程验收报告

- 开始时间：${report.startedAt}
- 结束时间：${report.finishedAt}
- 搜索词：${report.query}
- Chrome 端点：${report.chrome.endpoint}
- 运行态目录：${report.chrome.runtimeRoot}
- Chrome profile：${report.chrome.profileDir}
- 是否由脚本启动 Chrome：${report.chrome.startedByScript ? "是" : "否"}
- 需要人工接管：${report.result?.needsUser ? "是" : "否"}
- 结果数量：${report.result?.count || 0}

| 序号 | 标题 | URL | 摘要 |
| ---: | --- | --- | --- |
${rows}
`;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

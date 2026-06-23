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

  const scriptedPrompts = input.isTTY ? [] : await readScriptedPrompts();
  const rl = input.isTTY ? createInterface({ input, output }) : null;
  const initialPrompt = process.argv.slice(2).join(" ").trim()
    || scriptedPrompts.shift()
    || (rl ? (await rl.question("请输入第一轮问题：")).trim() : "");
  if (!initialPrompt) throw new Error("第一轮问题不能为空");

  const chrome = await ensureChrome();
  const mcp = createMcpClient();
  const startedAt = new Date();
  const turns = [];
  let tabId;
  let state;

  try {
    await mcp.initialize();
    state = parseToolText(await mcp.callTool("open_google_ai", {
      prompt: initialPrompt,
      waitMs: Number(process.env.GOOGLE_AI_WAIT_MS || "7000"),
      maxChars: Number(process.env.MAX_CHARS || "12000"),
    }));
    tabId = state.tabId;
    state = await waitForHumanIfNeeded({ rl, mcp, state, tabId });
    turns.push({ role: "user", prompt: initialPrompt, result: compactState(state) });
    printState(state);

    while (true) {
      const prompt = scriptedPrompts.length > 0
        ? scriptedPrompts.shift()
        : rl
          ? (await rl.question("\n继续追问，输入 /q 结束：")).trim()
          : "/q";
      if (!prompt || prompt === "/q") break;

      state = parseToolText(await mcp.callTool("google_ai_ask", {
        tabId,
        prompt,
        timeoutMs: Number(process.env.GOOGLE_AI_TIMEOUT_MS || "60000"),
        maxChars: Number(process.env.MAX_CHARS || "12000"),
      }));

      if (state.needsUser || state.sent === false) {
        state = await waitForHumanIfNeeded({ rl, mcp, state, tabId, retryPrompt: prompt });
      }

      turns.push({ role: "user", prompt, result: compactState(state) });
      printState(state);
    }

    const report = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      chrome: {
        endpoint: `http://127.0.0.1:${PORT}`,
        runtimeRoot: RUNTIME_ROOT,
        profileDir: PROFILE_DIR,
        startedByScript: chrome.startedByScript,
      },
      tabId,
      turns,
      finalState: compactState(state),
    };
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    const jsonPath = join(REPORT_DIR, `manual-google-ai-chat-${stamp}.json`);
    const mdPath = join(REPORT_DIR, `manual-google-ai-chat-${stamp}.md`);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(mdPath, renderMarkdown(report));
    console.log(`\nJSON 报告: ${jsonPath}`);
    console.log(`Markdown 报告: ${mdPath}`);
  } finally {
    rl?.close();
    await mcp.close();
  }
}

async function waitForHumanIfNeeded({ rl, mcp, state, tabId, retryPrompt }) {
  while (state?.needsUser || state?.sent === false || state?.inputReady === false) {
    if (!rl) return { ...state, nonInteractiveBlocked: true };
    console.log("\nGoogle AI 页面需要人工接管，可能是登录、验证码、同意条款，或需要你手动点进输入框。");
    console.log(`请在 Chrome 中处理当前 Google AI 标签页，然后回到这里按 Enter。tabId=${tabId}`);
    const answer = await rl.question("处理完成后按 Enter 继续，输入 /q 结束：");
    if (answer.trim() === "/q") return state;
    if (retryPrompt) {
      state = parseToolText(await mcp.callTool("google_ai_ask", {
        tabId,
        prompt: retryPrompt,
        timeoutMs: Number(process.env.GOOGLE_AI_TIMEOUT_MS || "60000"),
        maxChars: Number(process.env.MAX_CHARS || "12000"),
      }));
    } else {
      state = parseToolText(await mcp.callTool("google_ai_read", {
        tabId,
        maxChars: Number(process.env.MAX_CHARS || "12000"),
      }));
    }
    if (!state.needsUser && state.inputReady !== false) break;
  }
  return state;
}

async function readScriptedPrompts() {
  let text = "";
  input.setEncoding("utf8");
  for await (const chunk of input) {
    text += chunk;
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
      }, 70000);
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

function compactState(state) {
  return {
    title: state?.title,
    url: state?.url,
    tabId: state?.tabId,
    sent: state?.sent,
    needsUser: state?.needsUser,
    reasons: state?.reasons,
    inputReady: state?.inputReady,
    inputCandidates: state?.inputCandidates,
    text: state?.text,
    truncated: state?.truncated,
  };
}

function printState(state) {
  const text = state?.text || "";
  const sample = text.length > 1800 ? text.slice(-1800) : text;
  console.log("\n--- 当前 Google AI 可见对话文本 ---");
  console.log(sample || "(未读到文本)");
}

function renderMarkdown(report) {
  const rows = report.turns
    .map((turn, index) => `## 第 ${index + 1} 轮\n\n**问题**：${escapeText(turn.prompt)}\n\n**需要人工接管**：${turn.result?.needsUser ? "是" : "否"}\n\n**可见对话文本**：\n\n\`\`\`text\n${escapeFence(turn.result?.text || "")}\n\`\`\``)
    .join("\n\n");
  return `# Google AI 多轮讨论验收报告

- 开始时间：${report.startedAt}
- 结束时间：${report.finishedAt}
- Chrome 端点：${report.chrome.endpoint}
- 运行态目录：${report.chrome.runtimeRoot}
- Chrome profile：${report.chrome.profileDir}
- 是否由脚本启动 Chrome：${report.chrome.startedByScript ? "是" : "否"}
- 标签页 ID：${report.tabId}
- 轮数：${report.turns.length}

${rows}
`;
}

function escapeText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function escapeFence(value) {
  return String(value).replaceAll("```", "'''").trim();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

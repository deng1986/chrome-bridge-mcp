#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_TEXT = Number(process.env.CHROME_BRIDGE_MAX_TEXT || "30000");
let chromeAutoStartAttempted = false;

export function chromeHost() {
  return process.env.CHROME_BRIDGE_HOST || "127.0.0.1";
}

export function chromePort() {
  return Number(process.env.CHROME_BRIDGE_PORT || "9222");
}

export function cdpBase() {
  return `http://${chromeHost()}:${chromePort()}`;
}

function chromeRuntimeRoot() {
  return process.env.CHROME_BRIDGE_RUNTIME || `${process.env.HOME}/runtime/.chrome-bridge-mcp`;
}

function chromeProfileDir() {
  return process.env.CHROME_BRIDGE_PROFILE_DIR || `${chromeRuntimeRoot()}/ChromeProfile`;
}

function chromeBin() {
  return process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

function projectDir() {
  return new URL("..", import.meta.url).pathname.replace(/\/$/, "");
}

function sessionDir() {
  return join(chromeRuntimeRoot(), "sessions");
}

function sessionPath(sessionId) {
  return join(sessionDir(), `${sessionId}.json`);
}

function activeSessionPath() {
  return join(chromeRuntimeRoot(), "active-google-ai-session.json");
}

function activeGoogleTabPath() {
  return join(chromeRuntimeRoot(), "active-google-tab.json");
}

function reportDir() {
  return join(projectDir(), "reports");
}

function makeSessionId() {
  return `google-ai-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
}

async function saveSession(session) {
  await mkdir(sessionDir(), { recursive: true });
  await writeFile(sessionPath(session.sessionId), `${JSON.stringify(session, null, 2)}\n`);
}

async function loadSession(sessionId) {
  const text = await readFile(sessionPath(sessionId), "utf8");
  return JSON.parse(text);
}

async function saveActiveSession(sessionId) {
  await mkdir(chromeRuntimeRoot(), { recursive: true });
  await writeFile(activeSessionPath(), `${JSON.stringify({ sessionId, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

async function loadActiveSessionId() {
  const text = await readFile(activeSessionPath(), "utf8");
  const state = JSON.parse(text);
  return state.sessionId;
}

async function clearActiveSession(sessionId) {
  try {
    const activeSessionId = await loadActiveSessionId();
    if (!sessionId || activeSessionId === sessionId) await unlink(activeSessionPath());
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function saveActiveGoogleTab(tabId, purpose = "google-task") {
  await mkdir(chromeRuntimeRoot(), { recursive: true });
  await writeFile(activeGoogleTabPath(), `${JSON.stringify({ tabId, purpose, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

async function loadActiveGoogleTabId() {
  const text = await readFile(activeGoogleTabPath(), "utf8");
  const state = JSON.parse(text);
  return state.tabId;
}

async function clearActiveGoogleTab(tabId) {
  try {
    const activeTabId = await loadActiveGoogleTabId();
    if (!tabId || activeTabId === tabId) await unlink(activeGoogleTabPath());
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function compactGoogleAiState(state) {
  return {
    title: state?.title,
    url: state?.url,
    tabId: state?.tabId,
    sent: state?.sent,
    needsUser: state?.needsUser,
    reasons: state?.reasons || [],
    inputReady: state?.inputReady,
    inputCandidates: state?.inputCandidates || [],
    text: state?.text || "",
    truncated: Boolean(state?.truncated),
  };
}

function renderGoogleAiSessionMarkdown(session) {
  const turns = session.turns
    .map((turn, index) => {
      if (turn.role === "user") {
        return `## ${index + 1}. 用户\n\n${turn.message || ""}`;
      }
      const state = turn.state || {};
      return `## ${index + 1}. Google AI\n\n- 需要人工接管：${state.needsUser ? "是" : "否"}\n- URL：${state.url || ""}\n\n\`\`\`text\n${String(state.text || "").replaceAll("```", "'''")}\n\`\`\``;
    })
    .join("\n\n");
  return `# Google AI 会话记录

- 会话 ID：${session.sessionId}
- 标题：${session.title}
- 创建时间：${session.createdAt}
- 更新时间：${session.updatedAt}
- 标签页 ID：${session.tabId}

${turns}
`;
}

export const tools = [
  {
    name: "chrome_status",
    description: "Check whether a Chrome DevTools Protocol endpoint is reachable.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_tabs",
    description: "List open Chrome tabs exposed by the DevTools endpoint.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_url",
    description: "Open a URL in a new Chrome tab.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "URL to open." } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "google_search",
    description: "Open a Google search query in Chrome.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "search_google_and_extract",
    description: "Search Google in Chrome and return structured results. If login/CAPTCHA is detected, returns needsUser=true with tabId for manual continuation.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        maxResults: { type: "number", description: "Maximum number of results to return." },
        waitMs: { type: "number", description: "Milliseconds to wait after opening Google before extraction." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "open_google_ai",
    description: "Open Google AI Mode with an initial prompt and read the visible AI conversation state.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Initial prompt for Google AI Mode." },
        waitMs: { type: "number", description: "Milliseconds to wait after opening Google AI Mode." },
        maxChars: { type: "number", description: "Maximum visible conversation text characters to return." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "google_ai_ask",
    description: "Send a follow-up prompt to an existing Google AI Mode tab and read the updated conversation.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Follow-up prompt to send." },
        tabId: { type: "string", description: "Google AI Mode tab id. Defaults to the first page tab." },
        timeoutMs: { type: "number", description: "Maximum time to wait for the conversation to change." },
        maxChars: { type: "number", description: "Maximum visible conversation text characters to return." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "google_ai_read",
    description: "Read visible text and detected state from a Google AI Mode tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "Google AI Mode tab id. Defaults to the first page tab." },
        maxChars: { type: "number", description: "Maximum visible conversation text characters to return." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "start_google_ai_session",
    description: "Start a persisted Google AI Mode conversation session for chat-through-Codex/Claude workflows.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "First user message to send to Google AI." },
        title: { type: "string", description: "Optional human-readable session title." },
        waitMs: { type: "number", description: "Milliseconds to wait after opening Google AI Mode." },
        maxChars: { type: "number", description: "Maximum visible conversation text characters to return." },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "continue_google_ai_session",
    description: "Send a follow-up message to a persisted Google AI conversation session and return the updated visible conversation. Defaults to the active session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session id returned by start_google_ai_session. Defaults to the active session." },
        message: { type: "string", description: "Follow-up message to send to Google AI." },
        timeoutMs: { type: "number", description: "Maximum time to wait for the conversation to change." },
        maxChars: { type: "number", description: "Maximum visible conversation text characters to return." },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "read_google_ai_session",
    description: "Read persisted metadata and current visible text for a Google AI conversation session. Defaults to the active session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session id returned by start_google_ai_session. Defaults to the active session." },
        maxChars: { type: "number", description: "Maximum visible conversation text characters to return." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "end_google_ai_session",
    description: "End a Google AI conversation session: export it, close the Chrome tab, and clear the active session if it matches.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session id returned by start_google_ai_session. Defaults to the active session." },
        closeTab: { type: "boolean", description: "Whether to close the Chrome tab. Defaults to true." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "export_google_ai_session",
    description: "Export a persisted Google AI conversation session to Markdown in the project reports directory. Defaults to the active session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session id returned by start_google_ai_session. Defaults to the active session." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_current_page",
    description: "Extract title, URL, selected text, and visible page text from a Chrome tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "Optional Chrome tab id. Defaults to the first page tab." },
        maxChars: { type: "number", description: "Maximum body text characters to return." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_selection",
    description: "Return the selected text from a Chrome tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "Optional Chrome tab id. Defaults to the first page tab." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "extract_google_results",
    description: "Extract structured organic search results from a Google search results page.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "Optional Chrome tab id. Defaults to the first page tab." },
        maxResults: { type: "number", description: "Maximum number of results to return." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "detect_human_intervention",
    description: "Detect whether the current page appears to require login, CAPTCHA, consent, or manual verification.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "Optional Chrome tab id. Defaults to the first page tab." },
        readySelector: { type: "string", description: "Selector that means the page is ready for automation." },
        blockedSelectors: { type: "array", items: { type: "string" }, description: "Selectors that mean human intervention is needed." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "fill_text",
    description: "Fill an input, textarea, or contenteditable element.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the editable element." },
        text: { type: "string", description: "Text to fill." },
        tabId: { type: "string", description: "Optional Chrome tab id. Defaults to the first page tab." },
      },
      required: ["selector", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "click_selector",
    description: "Click an element by CSS selector.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the element to click." },
        tabId: { type: "string", description: "Optional Chrome tab id. Defaults to the first page tab." },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_ai_page",
    description: "Submit a prompt to a generic browser AI page and read the response. Login/CAPTCHA pages return needsUser=true.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt to submit." },
        inputSelector: { type: "string", description: "CSS selector for the prompt input." },
        submitSelector: { type: "string", description: "CSS selector for the submit button." },
        responseSelector: { type: "string", description: "CSS selector for the answer container." },
        tabId: { type: "string", description: "Optional Chrome tab id. Defaults to the first page tab." },
        timeoutMs: { type: "number", description: "Maximum time to wait for the response." },
        blockedSelectors: { type: "array", items: { type: "string" }, description: "Selectors that mean human intervention is needed." },
      },
      required: ["prompt", "inputSelector", "submitSelector", "responseSelector"],
      additionalProperties: false,
    },
  },
  {
    name: "run_js",
    description: "Run JavaScript in a Chrome tab and return the JSON-serializable result.",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "JavaScript expression to evaluate." },
        tabId: { type: "string", description: "Optional Chrome tab id. Defaults to the first page tab." },
      },
      required: ["expression"],
      additionalProperties: false,
    },
  },
  {
    name: "wait_for_user",
    description: "Return instructions for the human to complete login, CAPTCHA, consent, or other browser-only actions.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "What the user should do in Chrome before asking the assistant to continue." },
      },
      additionalProperties: false,
    },
  },
];

let nextMessageId = 1;

export function jsonResponse(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

export function jsonError(id, code, message, data) {
  write({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

function write(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export async function httpJson(path, init) {
  let response;
  try {
    response = await fetch(`${cdpBase()}${path}`, init);
  } catch (error) {
    if (process.env.CHROME_BRIDGE_AUTO_START !== "1" || chromeAutoStartAttempted) {
      throw new Error(`Cannot reach Chrome at ${cdpBase()}. Start Chrome with --remote-debugging-port=${chromePort()}. ${error.message}`);
    }
    chromeAutoStartAttempted = true;
    await startManagedChrome();
    response = await fetch(`${cdpBase()}${path}`, init);
  }
  if (!response.ok) {
    throw new Error(`Chrome DevTools request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function startManagedChrome() {
  const args = [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${chromePort()}`,
    `--user-data-dir=${chromeProfileDir()}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
  const child = spawn(chromeBin(), args, { stdio: "ignore", detached: true });
  child.unref();

  const deadline = Date.now() + Number(process.env.CHROME_BRIDGE_AUTO_START_TIMEOUT_MS || "20000");
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpBase()}/json/version`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(`Chrome auto-start failed for ${cdpBase()}: ${lastError?.message || "unknown"}`);
}

export async function listPageTabs() {
  const tabs = await httpJson("/json/list");
  return tabs.filter((tab) => tab.type === "page" && tab.webSocketDebuggerUrl);
}

export async function getTab(tabId) {
  const tabs = await listPageTabs();
  if (tabs.length === 0) {
    throw new Error("No Chrome page tabs are available through the DevTools endpoint.");
  }
  if (!tabId) return tabs[0];
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    throw new Error(`No Chrome tab found for id ${tabId}. Use list_tabs first.`);
  }
  return tab;
}

export function cdpCall(wsUrl, method, params = {}) {
  const id = nextMessageId++;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      tryClose(ws);
      reject(new Error(`Timed out waiting for CDP method ${method}`));
    }, 15000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id !== id) return;
      clearTimeout(timeout);
      tryClose(ws);
      if (message.error) {
        reject(new Error(`${method} failed: ${message.error.message || JSON.stringify(message.error)}`));
      } else {
        resolve(message.result);
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      tryClose(ws);
      reject(new Error(`Failed to connect to Chrome tab websocket ${wsUrl}`));
    });
  });
}

async function cdpCallForTab(tabId, method, params = {}) {
  const tab = await getTab(tabId);
  return cdpCall(tab.webSocketDebuggerUrl, method, params);
}

async function closeTab(tabId) {
  await getTab(tabId);
  return httpJson(`/json/close/${encodeURIComponent(tabId)}`);
}

async function openOrReuseGoogleTaskTab(url, purpose = "google-task") {
  try {
    const tabId = await loadActiveGoogleTabId();
    await cdpCallForTab(tabId, "Page.navigate", { url });
    await saveActiveGoogleTab(tabId, purpose);
    return { id: tabId, url, reused: true };
  } catch (error) {
    if (!["ENOENT"].includes(error.code) && !/No Chrome tab found|No Chrome page tabs/.test(error.message || "")) {
      throw error;
    }
  }
  const tab = await httpJson(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  await saveActiveGoogleTab(tab.id, purpose);
  return { ...tab, reused: false };
}

function tryClose(ws) {
  try {
    ws.close();
  } catch {
    // best-effort close
  }
}

export async function evaluate(tabId, expression) {
  const tab = await getTab(tabId);
  const result = await cdpCall(tab.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`JavaScript evaluation failed: ${result.exceptionDetails.text || "unknown error"}`);
  }
  return result.result?.value ?? result.result?.description ?? null;
}

async function waitForValue(tabId, expression, timeoutMs = 10000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() <= deadline) {
    lastValue = await evaluate(tabId, expression);
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for page condition after ${timeoutMs}ms`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function googleResultsExpression(maxResults) {
  return `(() => {
    const text = document.body?.innerText || "";
    const captchaLike = /captcha|recaptcha|unusual traffic|verify you are human|sorry|验证码|验证/i.test(text)
      || Boolean(document.querySelector('form[action*="sorry"], iframe[src*="recaptcha"], .g-recaptcha'));
    const loginLike = /请登录|登录后|log in to continue|sign in to continue/i.test(text);
    const root = document.querySelector('#search') || document.querySelector('main') || document.body;
    const anchors = Array.from(root?.querySelectorAll('a') || []);
    const results = [];
    const seen = new Set();
    for (const anchor of anchors) {
      const h3 = anchor.querySelector('h3');
      const title = (h3?.innerText || anchor.getAttribute('aria-label') || '').trim();
      const href = anchor.href || '';
      if (!title || !href || seen.has(href)) continue;
      let url = href;
      try {
        const parsed = new URL(href);
        if (parsed.hostname.endsWith('google.com') && parsed.pathname === '/url' && parsed.searchParams.get('q')) {
          url = parsed.searchParams.get('q');
        }
        const out = new URL(url);
        if (/(^|\\.)google\\.[a-z.]+$/i.test(out.hostname) && !out.pathname.startsWith('/search')) continue;
      } catch {
        continue;
      }
      const container = anchor.closest('div[data-sokoban-container], div.g, div[jscontroller], div') || anchor.parentElement;
      const snippet = (container?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500);
      seen.add(href);
      results.push({ title, url, snippet });
      if (results.length >= ${JSON.stringify(maxResults)}) break;
    }
    const needsUser = captchaLike || (loginLike && results.length === 0);
    return { title: document.title, url: location.href, needsUser, count: results.length, results };
  })()`;
}

function googleAiStateExpression(maxChars) {
  return `(() => {
    const text = (document.body?.innerText || '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
    const lowerText = text.toLowerCase();
    const reasons = [];
    const captchaElement = Boolean(document.querySelector('form[action*="sorry"], iframe[src*="recaptcha"], .g-recaptcha'));
    const captchaPage = /\\/sorry\\//.test(location.pathname) || /captcha|recaptcha|verify you are human|unusual traffic/.test(lowerText) || /请完成验证|安全验证|人机验证|验证您是真人/.test(text);
    if (captchaElement || captchaPage) reasons.push('captcha_or_bot_check');
    if (/sign in to continue|log in to continue/.test(lowerText) || /请登录后|登录后继续/.test(text)) reasons.push('login_required');
    if (/consent required|before you continue|请先同意/.test(lowerText) || /同意后继续/.test(text)) reasons.push('consent_required');
    const inputCandidates = Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none' && !el.disabled && !el.readOnly;
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        text: (el.innerText || el.value || '').slice(0, 80),
        bottom: Math.round(el.getBoundingClientRect().bottom),
      }));
    const inputReady = inputCandidates.length > 0;
    const truncated = text.length > ${JSON.stringify(maxChars)};
    return {
      title: document.title,
      url: location.href,
      needsUser: reasons.length > 0 && !inputReady,
      reasons: [...new Set(reasons)],
      inputReady,
      inputCandidates: inputCandidates.slice(-5),
      text: truncated ? text.slice(-${JSON.stringify(maxChars)}) : text,
      truncated,
    };
  })()`;
}

function googleAiFocusInputExpression(prompt) {
  return `(() => {
    const prompt = ${JSON.stringify(prompt)};
    const candidates = Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none' && !el.disabled && !el.readOnly;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const aLabel = ((a.getAttribute('aria-label') || '') + ' ' + (a.getAttribute('placeholder') || '')).toLowerCase();
        const bLabel = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('placeholder') || '')).toLowerCase();
        const aScore = (/ask|follow|search|提问|追问|搜索|输入/.test(aLabel) ? 10000 : 0) + ar.bottom;
        const bScore = (/ask|follow|search|提问|追问|搜索|输入/.test(bLabel) ? 10000 : 0) + br.bottom;
        return bScore - aScore;
      });
    const input = candidates[0];
    if (!input) {
      return { focused: false, reason: 'no_visible_input' };
    }
    input.scrollIntoView({ block: 'center', inline: 'center' });
    input.focus();
    if (input.isContentEditable) {
      input.innerText = '';
    } else {
      input.value = '';
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    return {
      focused: true,
      tag: input.tagName.toLowerCase(),
      role: input.getAttribute('role') || '',
      ariaLabel: input.getAttribute('aria-label') || '',
      placeholder: input.getAttribute('placeholder') || '',
      promptLength: prompt.length,
    };
  })()`;
}

export function textContent(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

export async function callTool(name, args = {}) {
  switch (name) {
    case "chrome_status": {
      const version = await httpJson("/json/version");
      return textContent({
        ok: true,
        endpoint: cdpBase(),
        browser: version.Browser,
        protocolVersion: version["Protocol-Version"],
      });
    }
    case "list_tabs": {
      const tabs = await listPageTabs();
      return textContent(tabs.map(({ id, title, url }) => ({ id, title, url })));
    }
    case "open_url": {
      const url = normalizeUrl(requiredString(args.url, "url"));
      const tab = await httpJson(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
      return textContent({ opened: true, id: tab.id, title: tab.title, url: tab.url });
    }
    case "google_search": {
      const query = requiredString(args.query, "query");
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const tab = await openOrReuseGoogleTaskTab(url, "google-search");
      return textContent({ opened: !tab.reused, reused: tab.reused, id: tab.id, query, url: tab.url });
    }
    case "search_google_and_extract": {
      const query = requiredString(args.query, "query");
      const maxResults = Number(args.maxResults || 8);
      const waitMs = Number(args.waitMs || 2000);
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const tab = await openOrReuseGoogleTaskTab(url, "google-search");
      await delay(waitMs);
      const extracted = await evaluate(tab.id, googleResultsExpression(maxResults));
      return textContent({ query, tabId: tab.id, opened: !tab.reused, reused: tab.reused, ...extracted });
    }
    case "open_google_ai": {
      const prompt = requiredString(args.prompt, "prompt");
      const waitMs = Number(args.waitMs || 5000);
      const maxChars = Number(args.maxChars || MAX_TEXT);
      const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(prompt)}`;
      const tab = await openOrReuseGoogleTaskTab(url, "google-ai");
      await delay(waitMs);
      const state = await evaluate(tab.id, googleAiStateExpression(maxChars));
      return textContent({ prompt, tabId: tab.id, opened: !tab.reused, reused: tab.reused, ...state });
    }
    case "google_ai_ask": {
      const prompt = requiredString(args.prompt, "prompt");
      const timeoutMs = Number(args.timeoutMs || 45000);
      const maxChars = Number(args.maxChars || MAX_TEXT);
      const before = await evaluate(args.tabId, googleAiStateExpression(maxChars));
      if (before?.needsUser) return textContent({ prompt, tabId: args.tabId || null, sent: false, ...before });
      const focus = await evaluate(args.tabId, googleAiFocusInputExpression(prompt));
      if (!focus?.focused) {
        return textContent({
          prompt,
          tabId: args.tabId || null,
          sent: false,
          needsUser: true,
          reasons: [focus?.reason || "input_not_found"],
          title: before?.title,
          url: before?.url,
          text: before?.text,
          inputCandidates: before?.inputCandidates || [],
        });
      }
      await cdpCallForTab(args.tabId, "Input.insertText", { text: prompt });
      await cdpCallForTab(args.tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await cdpCallForTab(args.tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      const beforeText = before?.text || "";
      const after = await waitForValue(args.tabId, `(() => {
        const state = ${googleAiStateExpression(maxChars)};
        if (state.needsUser) return state;
        const text = state.text || '';
        const thinking = /AI 模式正在思考|正在思考|正在生成|thinking|generating/i.test(text);
        const changed = text.length !== ${JSON.stringify(beforeText.length)} || !text.endsWith(${JSON.stringify(beforeText.slice(-1200))});
        if (changed && !thinking) return state;
        return null;
      })()`, timeoutMs, 500);
      return textContent({ prompt, tabId: args.tabId || null, sent: true, focus, ...after });
    }
    case "google_ai_read": {
      const maxChars = Number(args.maxChars || MAX_TEXT);
      return textContent(await evaluate(args.tabId, googleAiStateExpression(maxChars)));
    }
    case "start_google_ai_session": {
      const message = requiredString(args.message, "message");
      const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : message.slice(0, 80);
      const waitMs = Number(args.waitMs || 7000);
      const maxChars = Number(args.maxChars || MAX_TEXT);
      const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(message)}`;
      const tab = await openOrReuseGoogleTaskTab(url, "google-ai");
      await delay(waitMs);
      const state = await evaluate(tab.id, googleAiStateExpression(maxChars));
      const now = new Date().toISOString();
      const session = {
        sessionId: makeSessionId(),
        title,
        createdAt: now,
        updatedAt: now,
        tabId: tab.id,
        turns: [
          { at: now, role: "user", message },
          { at: now, role: "google_ai", state: compactGoogleAiState({ tabId: tab.id, ...state }) },
        ],
      };
      await saveSession(session);
      await saveActiveSession(session.sessionId);
      return textContent({ ...session, state: compactGoogleAiState({ tabId: tab.id, ...state }) });
    }
    case "continue_google_ai_session": {
      const sessionId = typeof args.sessionId === "string" && args.sessionId.trim()
        ? args.sessionId.trim()
        : await loadActiveSessionId();
      const message = requiredString(args.message, "message");
      const timeoutMs = Number(args.timeoutMs || 70000);
      const maxChars = Number(args.maxChars || MAX_TEXT);
      const session = await loadSession(sessionId);
      const asked = JSON.parse((await callTool("google_ai_ask", {
        tabId: session.tabId,
        prompt: message,
        timeoutMs,
        maxChars,
      })).content[0].text);
      const now = new Date().toISOString();
      session.updatedAt = now;
      session.turns.push({ at: now, role: "user", message });
      session.turns.push({ at: now, role: "google_ai", state: compactGoogleAiState({ tabId: session.tabId, ...asked }) });
      await saveSession(session);
      await saveActiveSession(session.sessionId);
      return textContent({ ...session, state: compactGoogleAiState({ tabId: session.tabId, ...asked }) });
    }
    case "read_google_ai_session": {
      const sessionId = typeof args.sessionId === "string" && args.sessionId.trim()
        ? args.sessionId.trim()
        : await loadActiveSessionId();
      const maxChars = Number(args.maxChars || MAX_TEXT);
      const session = await loadSession(sessionId);
      const state = await evaluate(session.tabId, googleAiStateExpression(maxChars));
      return textContent({ ...session, state: compactGoogleAiState({ tabId: session.tabId, ...state }) });
    }
    case "export_google_ai_session": {
      const sessionId = typeof args.sessionId === "string" && args.sessionId.trim()
        ? args.sessionId.trim()
        : await loadActiveSessionId();
      const session = await loadSession(sessionId);
      await mkdir(reportDir(), { recursive: true });
      const mdPath = join(reportDir(), `${sessionId}.md`);
      await writeFile(mdPath, renderGoogleAiSessionMarkdown(session));
      return textContent({ exported: true, sessionId, path: mdPath });
    }
    case "end_google_ai_session": {
      const sessionId = typeof args.sessionId === "string" && args.sessionId.trim()
        ? args.sessionId.trim()
        : await loadActiveSessionId();
      const shouldCloseTab = args.closeTab !== false;
      const session = await loadSession(sessionId);
      await mkdir(reportDir(), { recursive: true });
      const mdPath = join(reportDir(), `${sessionId}.md`);
      await writeFile(mdPath, renderGoogleAiSessionMarkdown(session));
      let closed = false;
      let closeError;
      if (shouldCloseTab) {
        try {
          await closeTab(session.tabId);
          closed = true;
          await clearActiveGoogleTab(session.tabId);
        } catch (error) {
          closeError = error.message;
        }
      }
      await clearActiveSession(sessionId);
      return textContent({ ended: true, sessionId, exported: true, path: mdPath, tabId: session.tabId, closed, closeError });
    }
    case "get_current_page": {
      const maxChars = Number(args.maxChars || MAX_TEXT);
      const page = await evaluate(args.tabId, `(() => {
        const selectedText = String(globalThis.getSelection?.() || "");
        const title = document.title;
        const url = location.href;
        const text = (document.body?.innerText || "").replace(/[ \\t]+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n");
        return { title, url, selectedText, text };
      })()`);
      if (page?.text && page.text.length > maxChars) {
        page.truncated = true;
        page.text = page.text.slice(0, maxChars);
      }
      return textContent(page);
    }
    case "get_selection": {
      const selectedText = await evaluate(args.tabId, `String(globalThis.getSelection?.() || "")`);
      return textContent({ selectedText });
    }
    case "extract_google_results": {
      const maxResults = Number(args.maxResults || 8);
      const result = await evaluate(args.tabId, googleResultsExpression(maxResults));
      return textContent(result);
    }
    case "detect_human_intervention": {
      const readySelector = typeof args.readySelector === "string" ? args.readySelector : "";
      const blockedSelectors = Array.isArray(args.blockedSelectors) ? args.blockedSelectors : [];
      const result = await evaluate(args.tabId, `(() => {
        const readySelector = ${JSON.stringify(readySelector)};
        const blockedSelectors = ${JSON.stringify(blockedSelectors)};
        const text = document.body?.innerText || "";
        const reasons = [];
        for (const selector of blockedSelectors) {
          if (document.querySelector(selector)) reasons.push('blocked selector: ' + selector);
        }
        const patterns = [
          [/captcha|recaptcha|verify you are human|unusual traffic/i, 'captcha_or_bot_check'],
          [/sign in|log in|login|登录|请登录/i, 'login_required'],
          [/consent|同意|接受/i, 'consent_required'],
        ];
        for (const [pattern, reason] of patterns) {
          if (pattern.test(text)) reasons.push(reason);
        }
        const ready = readySelector ? Boolean(document.querySelector(readySelector)) : reasons.length === 0;
        return { title: document.title, url: location.href, ready, needsUser: reasons.length > 0 && !ready, reasons: [...new Set(reasons)] };
      })()`);
      return textContent(result);
    }
    case "fill_text": {
      const selector = requiredString(args.selector, "selector");
      const text = requiredString(args.text, "text");
      return textContent(await evaluate(args.tabId, `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('No element found for selector: ${selector.replaceAll("'", "\\'")}');
        const text = ${JSON.stringify(text)};
        el.focus();
        if (el.isContentEditable) {
          el.innerText = text;
        } else {
          el.value = text;
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { filled: true, selector: ${JSON.stringify(selector)} };
      })()`));
    }
    case "click_selector": {
      const selector = requiredString(args.selector, "selector");
      return textContent(await evaluate(args.tabId, `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('No element found for selector: ${selector.replaceAll("'", "\\'")}');
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return { clicked: true, selector: ${JSON.stringify(selector)} };
      })()`));
    }
    case "ask_ai_page": {
      const prompt = requiredString(args.prompt, "prompt");
      const inputSelector = requiredString(args.inputSelector, "inputSelector");
      const submitSelector = requiredString(args.submitSelector, "submitSelector");
      const responseSelector = requiredString(args.responseSelector, "responseSelector");
      const timeoutMs = Number(args.timeoutMs || 30000);
      const blockedSelectors = Array.isArray(args.blockedSelectors) ? args.blockedSelectors : [];
      const handoff = await evaluate(args.tabId, `(() => {
        const blockedSelectors = ${JSON.stringify(blockedSelectors)};
        const reasons = [];
        for (const selector of blockedSelectors) {
          if (document.querySelector(selector)) reasons.push('blocked selector: ' + selector);
        }
        const text = document.body?.innerText || '';
        if (/captcha|recaptcha|verify you are human|unusual traffic/i.test(text)) reasons.push('captcha_or_bot_check');
        if (/sign in|log in|login|登录|请登录/i.test(text)) reasons.push('login_required');
        return { needsUser: reasons.length > 0, reasons: [...new Set(reasons)], title: document.title, url: location.href };
      })()`);
      if (handoff?.needsUser) return textContent(handoff);

      await evaluate(args.tabId, `(() => {
        const input = document.querySelector(${JSON.stringify(inputSelector)});
        if (!input) throw new Error('No input found for selector: ${inputSelector.replaceAll("'", "\\'")}');
        const prompt = ${JSON.stringify(prompt)};
        input.focus();
        if (input.isContentEditable) {
          input.innerText = prompt;
        } else {
          input.value = prompt;
        }
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const submit = document.querySelector(${JSON.stringify(submitSelector)});
        if (!submit) throw new Error('No submit button found for selector: ${submitSelector.replaceAll("'", "\\'")}');
        submit.click();
        return true;
      })()`);
      const answer = await waitForValue(args.tabId, `(() => {
        const el = document.querySelector(${JSON.stringify(responseSelector)});
        const text = (el?.innerText || el?.textContent || '').trim();
        return text ? { answered: true, response: text, title: document.title, url: location.href } : null;
      })()`, timeoutMs);
      return textContent(answer);
    }
    case "run_js": {
      const expression = requiredString(args.expression, "expression");
      return textContent(await evaluate(args.tabId, expression));
    }
    case "wait_for_user": {
      return textContent({
        waiting: true,
        message: args.message || "Please complete the browser action in Chrome, then ask the assistant to continue.",
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

export function normalizeUrl(url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return `https://${url}`;
}

export async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") return;

  try {
    if (message.method === "initialize") {
      jsonResponse(message.id, {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "chrome-bridge-mcp", version: "0.1.0" },
      });
      return;
    }

    if (message.method === "notifications/initialized") return;

    if (message.method === "tools/list") {
      jsonResponse(message.id, { tools });
      return;
    }

    if (message.method === "tools/call") {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      jsonResponse(message.id, result);
      return;
    }

    jsonError(message.id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    jsonError(message.id, -32000, error.message);
  }
}

export function startStdioServer() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        jsonError(null, -32700, `Parse error: ${error.message}`);
        continue;
      }
      void handle(message);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startStdioServer();
}

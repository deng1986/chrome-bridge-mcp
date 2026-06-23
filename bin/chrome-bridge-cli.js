#!/usr/bin/env node

process.env.CHROME_BRIDGE_AUTO_START ??= "1";
process.env.CHROME_BRIDGE_PORT ??= "9222";
process.env.CHROME_BRIDGE_RUNTIME ??= `${process.env.HOME}/runtime/.chrome-bridge-mcp`;

const { callTool, tools } = await import("../src/server.js");

function usage() {
  return `chrome-bridge-cli

用法:
  chrome-bridge-cli status
  chrome-bridge-cli list-tools
  chrome-bridge-cli tool <工具名> [JSON参数]
  chrome-bridge-cli search <查询> [--max-results N]
  chrome-bridge-cli ai new <消息> [--title 标题]
  chrome-bridge-cli ai ask [会话ID] <消息>
  chrome-bridge-cli ai read [会话ID]
  chrome-bridge-cli ai end [会话ID] [--keep-tab]
  chrome-bridge-cli ai export [会话ID]
`;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value;
}

function parseJson(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`JSON参数解析失败: ${error.message}`);
  }
}

function textFromResult(result) {
  return result?.content?.find((item) => item.type === "text")?.text || "";
}

async function run() {
  const args = process.argv.slice(2);
  const command = args.shift();

  if (!command || command === "-h" || command === "--help") {
    process.stdout.write(usage());
    return;
  }

  let toolName;
  let toolArgs = {};

  if (command === "list-tools") {
    process.stdout.write(`${JSON.stringify(tools.map(({ name, description }) => ({ name, description })), null, 2)}\n`);
    return;
  }

  if (command === "status") {
    toolName = "chrome_status";
  } else if (command === "tool") {
    toolName = args.shift();
    if (!toolName) throw new Error("缺少工具名");
    toolArgs = parseJson(args.join(" "));
  } else if (command === "search") {
    const maxResults = Number(takeFlag(args, "--max-results") || "8");
    const query = args.join(" ").trim();
    if (!query) throw new Error("缺少搜索查询");
    toolName = "search_google_and_extract";
    toolArgs = { query, maxResults };
  } else if (command === "ai") {
    const subcommand = args.shift();
    if (subcommand === "new") {
      const title = takeFlag(args, "--title");
      const message = args.join(" ").trim();
      if (!message) throw new Error("缺少 Google AI 首轮消息");
      toolName = "start_google_ai_session";
      toolArgs = { message, ...(title ? { title } : {}) };
    } else if (subcommand === "ask") {
      const sessionId = args[0]?.startsWith("google-ai-") ? args.shift() : undefined;
      const message = args.join(" ").trim();
      if (!message) throw new Error("用法: chrome-bridge-cli ai ask [会话ID] <消息>");
      toolName = "continue_google_ai_session";
      toolArgs = { ...(sessionId ? { sessionId } : {}), message };
    } else if (subcommand === "read") {
      const sessionId = args.shift();
      toolName = "read_google_ai_session";
      toolArgs = { ...(sessionId ? { sessionId } : {}) };
    } else if (subcommand === "end") {
      const keepTab = args.includes("--keep-tab");
      if (keepTab) args.splice(args.indexOf("--keep-tab"), 1);
      const sessionId = args.shift();
      toolName = "end_google_ai_session";
      toolArgs = { ...(sessionId ? { sessionId } : {}), closeTab: !keepTab };
    } else if (subcommand === "export") {
      const sessionId = args.shift();
      toolName = "export_google_ai_session";
      toolArgs = { ...(sessionId ? { sessionId } : {}) };
    } else {
      throw new Error("未知 ai 子命令");
    }
  } else {
    throw new Error(`未知命令: ${command}`);
  }

  const result = await callTool(toolName, toolArgs);
  process.stdout.write(`${textFromResult(result)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.message}\n\n${usage()}`);
  process.exitCode = 1;
});

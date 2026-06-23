import { defineTool, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

const HOME = process.env.HOME || "/Users/deng";
const BUNDLED_NODE = `${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`;
const NODE = process.env.CHROME_BRIDGE_NODE || (existsSync(BUNDLED_NODE) ? BUNDLED_NODE : "node");
const CLI = process.env.CHROME_BRIDGE_CLI || `${HOME}/ai/chrome-bridge-mcp/bin/chrome-bridge-cli.js`;

async function runBridge(args: string[]) {
	const { stdout } = await execFileAsync(NODE, [CLI, ...args], {
		env: {
			...process.env,
			CHROME_BRIDGE_AUTO_START: "1",
			CHROME_BRIDGE_PORT: process.env.CHROME_BRIDGE_PORT || "9222",
			CHROME_BRIDGE_RUNTIME: process.env.CHROME_BRIDGE_RUNTIME || `${HOME}/runtime/.chrome-bridge-mcp`,
		},
		maxBuffer: 1024 * 1024 * 4,
	});
	const output = stdout.trim();
	const truncated = truncateHead(output, { maxBytes: 50000, maxLines: 2000 });
	return {
		content: [{ type: "text" as const, text: truncated.content }],
		details: {
			truncated: truncated.truncated,
			outputBytes: truncated.outputBytes,
			totalBytes: truncated.totalBytes,
			command: [CLI, ...args],
		},
	};
}

const googleSearch = defineTool({
	name: "google_search",
	label: "Google Search",
	description: "用真实 Chrome 打开 Google 搜索并抽取结构化结果。遇到登录、验证码或人工验证时会返回 needsUser=true。",
	promptSnippet: "Use google_search when current web information, Google results, or browser-backed search evidence is needed.",
	promptGuidelines: [
		"需要联网检索、当前信息、Google 搜索证据时优先使用 google_search。",
		"如果结果里 needsUser=true，告诉用户去 Chrome 完成登录、验证码或同意页，然后再继续。",
		"不要伪造搜索结果；只基于工具返回的数据回答。",
	],
	parameters: Type.Object({
		query: Type.String({ description: "Google 搜索查询" }),
		maxResults: Type.Optional(Type.Number({ description: "最多返回多少条搜索结果，默认 8" })),
	}),
	async execute(_toolCallId, params) {
		return runBridge(["search", params.query, "--max-results", String(params.maxResults || 8)]);
	},
});

const googleAiStart = defineTool({
	name: "google_ai_start",
	label: "Google AI Start",
	description: "新开一个 Google AI Mode 会话，并返回可继续追问的 sessionId。",
	promptSnippet: "Start a Google AI Mode conversation through Chrome when the user wants Google AI's answer or a multi-turn discussion.",
	promptGuidelines: [
		"用户要求使用 Google AI、多轮 Google 讨论、或 #g new 风格任务时使用 google_ai_start。",
		"记住返回的 sessionId，后续追问用 google_ai_continue。",
	],
	parameters: Type.Object({
		message: Type.String({ description: "发给 Google AI 的首轮消息" }),
		title: Type.Optional(Type.String({ description: "可选会话标题" })),
	}),
	async execute(_toolCallId, params) {
		const args = ["ai", "new", params.message];
		if (params.title) args.push("--title", params.title);
		return runBridge(args);
	},
});

const googleAiContinue = defineTool({
	name: "google_ai_continue",
	label: "Google AI Continue",
	description: "向已有 Google AI Mode 会话继续追问。",
	promptSnippet: "Continue an existing Google AI Mode session using the sessionId returned by google_ai_start.",
	promptGuidelines: ["如果用户没有明确要求新开会话，继续追问时用 google_ai_continue；sessionId 可省略，桥会使用当前活跃 Google AI 会话。"],
	parameters: Type.Object({
		sessionId: Type.Optional(Type.String({ description: "google_ai_start 返回的 sessionId；省略时使用当前活跃会话" })),
		message: Type.String({ description: "继续发给 Google AI 的消息" }),
	}),
	async execute(_toolCallId, params) {
		return runBridge(["ai", "ask", ...(params.sessionId ? [params.sessionId] : []), params.message]);
	},
});

const googleAiRead = defineTool({
	name: "google_ai_read",
	label: "Google AI Read",
	description: "读取已有 Google AI Mode 会话当前可见内容和状态。",
	parameters: Type.Object({
		sessionId: Type.Optional(Type.String({ description: "Google AI 会话 ID；省略时使用当前活跃会话" })),
	}),
	async execute(_toolCallId, params) {
		return runBridge(["ai", "read", ...(params.sessionId ? [params.sessionId] : [])]);
	},
});

const googleAiEnd = defineTool({
	name: "google_ai_end",
	label: "Google AI End",
	description: "结束当前或指定 Google AI Mode 会话，导出 Markdown，并默认关闭对应 Chrome 标签页。",
	parameters: Type.Object({
		sessionId: Type.Optional(Type.String({ description: "Google AI 会话 ID；省略时使用当前活跃会话" })),
		keepTab: Type.Optional(Type.Boolean({ description: "为 true 时只结束会话但不关闭 Chrome 标签页" })),
	}),
	async execute(_toolCallId, params) {
		return runBridge(["ai", "end", ...(params.sessionId ? [params.sessionId] : []), ...(params.keepTab ? ["--keep-tab"] : [])]);
	},
});

const googleAiExport = defineTool({
	name: "google_ai_export",
	label: "Google AI Export",
	description: "把已有 Google AI Mode 会话导出为 Markdown 报告。",
	parameters: Type.Object({
		sessionId: Type.Optional(Type.String({ description: "Google AI 会话 ID；省略时使用当前活跃会话" })),
	}),
	async execute(_toolCallId, params) {
		return runBridge(["ai", "export", ...(params.sessionId ? [params.sessionId] : [])]);
	},
});

export default function chromeBridgeGoogle(pi: ExtensionAPI) {
	pi.registerTool(googleSearch);
	pi.registerTool(googleAiStart);
	pi.registerTool(googleAiContinue);
	pi.registerTool(googleAiRead);
	pi.registerTool(googleAiEnd);
	pi.registerTool(googleAiExport);

	pi.registerCommand("google", {
		description: "显示 Chrome Bridge Google 工具状态",
		handler: async (_args, ctx) => {
			const result = await runBridge(["status"]);
			const text = result.content[0]?.text || "";
			ctx.ui.notify(`Chrome Bridge Google 已启用\n${text}`, "info");
		},
	});
}

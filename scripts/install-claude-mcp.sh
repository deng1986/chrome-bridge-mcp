#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$("${PROJECT_DIR}/scripts/detect-node-bin.sh")"
RUNTIME_DIR="${CHROME_BRIDGE_RUNTIME:-${HOME}/runtime/.chrome-bridge-mcp}"
CLAUDE_COMMAND_DIR="${HOME}/.claude/commands"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI not found: claude" >&2
  exit 1
fi

mkdir -p "${RUNTIME_DIR}/ChromeProfile" "${RUNTIME_DIR}/logs"
mkdir -p "${CLAUDE_COMMAND_DIR}"
cp "${PROJECT_DIR}/integrations/claude/commands/google.md" "${CLAUDE_COMMAND_DIR}/google.md"

claude mcp remove chrome-bridge -s user >/dev/null 2>&1 || true
claude mcp add -s user --transport stdio chrome-bridge \
  --env CHROME_BRIDGE_PORT="${CHROME_BRIDGE_PORT:-9222}" \
  --env CHROME_BRIDGE_AUTO_START="${CHROME_BRIDGE_AUTO_START:-1}" \
  --env CHROME_BRIDGE_RUNTIME="${RUNTIME_DIR}" \
  -- "${NODE_BIN}" "${PROJECT_DIR}/src/server.js"

echo "Claude Code chrome-bridge MCP installed at user scope."
echo "Claude Code /google command installed: ${CLAUDE_COMMAND_DIR}/google.md"
claude mcp get chrome-bridge

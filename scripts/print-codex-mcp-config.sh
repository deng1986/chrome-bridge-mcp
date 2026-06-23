#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$("${PROJECT_DIR}/scripts/detect-node-bin.sh")"
RUNTIME_DIR="${CHROME_BRIDGE_RUNTIME:-${HOME}/runtime/.chrome-bridge-mcp}"

cat <<EOF
[mcp_servers.chrome_bridge]
command = "${NODE_BIN}"
args = ["${PROJECT_DIR}/src/server.js"]
startup_timeout_sec = 30

[mcp_servers.chrome_bridge.env]
CHROME_BRIDGE_PORT = "${CHROME_BRIDGE_PORT:-9222}"
CHROME_BRIDGE_AUTO_START = "${CHROME_BRIDGE_AUTO_START:-1}"
CHROME_BRIDGE_RUNTIME = "${RUNTIME_DIR}"
EOF

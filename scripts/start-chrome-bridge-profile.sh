#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="${HOME}/runtime/.chrome-bridge-mcp"
PROFILE_DIR="${RUNTIME_DIR}/ChromeProfile"
LOG_DIR="${RUNTIME_DIR}/logs"

mkdir -p "${PROFILE_DIR}" "${LOG_DIR}"

exec open -na "Google Chrome" --args \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="${CHROME_BRIDGE_PORT:-9222}" \
  --user-data-dir="${PROFILE_DIR}" \
  about:blank

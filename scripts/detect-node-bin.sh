#!/usr/bin/env bash
set -euo pipefail

BUNDLED_NODE="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [ -n "${CHROME_BRIDGE_NODE:-}" ]; then
  printf '%s\n' "${CHROME_BRIDGE_NODE}"
elif [ -x "${BUNDLED_NODE}" ]; then
  printf '%s\n' "${BUNDLED_NODE}"
elif command -v node >/dev/null 2>&1; then
  command -v node
else
  echo "Cannot find Node.js. Install Node.js 22+ or set CHROME_BRIDGE_NODE." >&2
  exit 1
fi

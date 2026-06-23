#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-${HOME}/runtime/.pi/agent}"
SOURCE="${PROJECT_DIR}/integrations/pi/chrome-bridge-google.ts"
TARGET_DIR="${PI_AGENT_DIR}/extensions"
TARGET="${TARGET_DIR}/chrome-bridge-google.ts"

mkdir -p "${TARGET_DIR}"
cp "${SOURCE}" "${TARGET}"

echo "Installed pi extension: ${TARGET}"
echo "Restart existing pi/raft sessions so they reload the extension."

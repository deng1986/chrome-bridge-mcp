#!/usr/bin/env bash
set -euo pipefail

LABEL="com.chrome-bridge.mcp"
TARGET_DIR="${HOME}/Library/LaunchAgents"
TARGET_PLIST="${TARGET_DIR}/${LABEL}.plist"
RUNTIME_DIR="${HOME}/runtime/.chrome-bridge-mcp"

mkdir -p "${TARGET_DIR}" "${RUNTIME_DIR}/logs" "${RUNTIME_DIR}/ChromeProfile"
cat > "${TARGET_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</string>
    <string>--remote-debugging-address=127.0.0.1</string>
    <string>--remote-debugging-port=9222</string>
    <string>--user-data-dir=${RUNTIME_DIR}/ChromeProfile</string>
    <string>about:blank</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <false/>

  <key>StandardOutPath</key>
  <string>${RUNTIME_DIR}/logs/chrome.out.log</string>

  <key>StandardErrorPath</key>
  <string>${RUNTIME_DIR}/logs/chrome.err.log</string>

  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "${TARGET_PLIST}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${TARGET_PLIST}"
launchctl enable "gui/$(id -u)/${LABEL}"

echo "Installed ${TARGET_PLIST}"
